from __future__ import annotations
import json, re, secrets, time
from contextlib import asynccontextmanager
from decimal import Decimal, InvalidOperation
from typing import Any
from uuid import uuid4

import httpx
from fastapi import Depends, FastAPI, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field

from . import config
from .rpc import WEI, RpcError, rpc, simulate_native_transfer, fetch_transaction_and_receipt
from .security import valid_address, recover_address, issue_token, require_wallet, app_secret_ready, TX_HASH_RE
from .store import connect, init_db, add_audit, get_proposal, parse_proposal

@asynccontextmanager
async def lifespan(_app: FastAPI):
    init_db()
    yield

app = FastAPI(title=config.APP_NAME, version="1.0.0", description="Sepolia-only, user-signed Agent Vault demo API.", lifespan=lifespan)
app.add_middleware(CORSMiddleware, allow_origins=config.CORS_ORIGINS, allow_credentials=False,
                   allow_methods=["GET", "POST", "OPTIONS"], allow_headers=["Authorization", "Content-Type"])


class ChallengeRequest(BaseModel):
    address: str = Field(min_length=42, max_length=42)

class VerifyRequest(BaseModel):
    challenge_id: str = Field(min_length=16, max_length=100)
    address: str = Field(min_length=42, max_length=42)
    signature: str = Field(min_length=20, max_length=300)

class PlanRequest(BaseModel):
    goal: str = Field(min_length=3, max_length=500)
    recipient: str = Field(min_length=42, max_length=42)
    amount_eth: str = Field(min_length=1, max_length=40)

class PrepareRequest(BaseModel):
    proposal_id: str = Field(min_length=16, max_length=100)
    chain_id: int

class ConfirmRequest(BaseModel):
    proposal_id: str = Field(min_length=16, max_length=100)
    intent_id: str = Field(min_length=16, max_length=100)
    tx_hash: str = Field(min_length=66, max_length=66)


def now() -> int:
    return int(time.time())


def amount_to_wei(raw: str) -> tuple[Decimal, int]:
    try:
        amount = Decimal(raw)
    except InvalidOperation as exc:
        raise HTTPException(422, "Amount must be a valid decimal ETH amount.") from exc
    if not amount.is_finite() or amount <= 0:
        raise HTTPException(422, "Amount must be greater than zero.")
    if amount.as_tuple().exponent < -18:
        raise HTTPException(422, "ETH amount supports at most 18 decimal places.")
    return amount, int(amount * WEI)


def active_spend_wei(db, owner: str, timestamp: int | None = None) -> int:
    timestamp = timestamp or now()
    rows = db.execute("""SELECT amount_wei FROM proposals
        WHERE owner=? AND created_at>=? AND status IN ('prepared','submitted','confirmed')""",
        (owner.lower(), timestamp - 86400)).fetchall()
    return sum(int(row["amount_wei"]) for row in rows)


def simulation_for_value(owner: str, recipient: str, amount_wei: int) -> dict[str, Any]:
    if Decimal(amount_wei) / WEI > config.MAX_TX_ETH:
        return {"ok": False, "reason": f"Trusted simulation skipped: transaction value exceeds the configured {config.MAX_TX_ETH} ETH per-transaction limit.", "checks": []}
    return simulate_native_transfer(owner, recipient, amount_wei)


def evaluate_policy(owner: str, recipient: str, amount_wei: int, simulation: dict[str, Any],
                    current_spend_wei: int) -> list[dict[str, str]]:
    checks: list[dict[str, str]] = []
    def add(name: str, passed: bool, detail: str) -> None:
        checks.append({"name": name, "status": "pass" if passed else "block", "detail": detail})
    add("network", config.CHAIN_ID == 11155111, "Transactions are restricted to Ethereum Sepolia testnet.")
    add("recipient_format", valid_address(recipient) and recipient.lower() != "0x" + "0" * 40,
        "Recipient must be a valid, non-zero 20-byte EVM address.")
    add("per_transaction_limit", Decimal(amount_wei) / WEI <= config.MAX_TX_ETH,
        f"Transaction limit is {config.MAX_TX_ETH} ETH.")
    allowlisted = recipient.lower() in config.ALLOWED_RECIPIENTS
    add("recipient_allowlist", config.ALLOW_ANY_RECIPIENT or allowlisted,
        "Recipient is allowlisted." if allowlisted else ("ALLOW_ANY_RECIPIENT is enabled." if config.ALLOW_ANY_RECIPIENT else "Recipient is not in ALLOWED_RECIPIENTS. Configure the server allowlist before approving."))
    daily_limit_wei = int(config.DAILY_LIMIT_ETH * WEI)
    add("daily_spending_limit", current_spend_wei + amount_wei <= daily_limit_wei,
        f"Rolling 24-hour limit is {config.DAILY_LIMIT_ETH} ETH; already reserved or executed: {Decimal(current_spend_wei) / WEI} ETH.")
    add("trusted_simulation", bool(simulation.get("ok")), str(simulation.get("reason", "Trusted simulation was not completed.")))
    return checks


def build_agent_plan(goal: str, amount: Decimal, recipient: str) -> tuple[dict[str, Any], bool]:
    """Use Claude for an explanatory structured plan only; deterministic fields remain authoritative."""
    fallback = {
        "summary": f"Proposed native ETH transfer of {amount} Sepolia ETH to {recipient}. The local planner describes the workflow; backend policy and the RPC simulation decide whether it may proceed.",
        "steps": [
            {"title": "Validate recipient", "detail": "Compare the exact recipient against server policy and the configured allowlist."},
            {"title": "Simulate transfer", "detail": "Run eth_call, estimate gas, check the sender balance and enforce fee bounds on a configured Sepolia RPC."},
            {"title": "Request explicit approval", "detail": "Present the exact native ETH transfer in MetaMask; never ask for or store a private key."},
            {"title": "Verify receipt", "detail": "Match the broadcast transaction against the proposal, then verify the mined receipt and write an audit record."},
        ],
    }
    if not config.ANTHROPIC_API_KEY:
        return fallback, False
    try:
        response = httpx.post("https://api.anthropic.com/v1/messages", headers={
            "x-api-key": config.ANTHROPIC_API_KEY,
            "anthropic-version": "2023-06-01",
            "content-type": "application/json",
        }, json={
            "model": config.ANTHROPIC_MODEL, "max_tokens": 450,
            "system": 'You are an AI wallet planning assistant. Return JSON only with keys "summary" (string) and "steps" (array of objects with "title" and "detail" strings). Give 3-5 concise steps explaining the secure review and execution process for an EVM native ETH transfer. Do not create, infer, alter, or output transaction fields, addresses, amount, chain, calldata, or approvals. Never claim the transaction is safe or executed. The deterministic backend, not you, decides eligibility.', 
            "messages": [{"role": "user", "content": f"User goal: {goal[:500]}\nFixed user-entered transaction: {amount} native ETH on Sepolia to {recipient}. No transaction has been signed or broadcast. Explain the workflow and checks without changing any of those fields."}]
        }, timeout=12.0)
        response.raise_for_status()
        data = response.json()
        raw = "\n".join(x.get("text", "") for x in data.get("content", []) if x.get("type") == "text").strip()
        if raw.startswith("```"):
            raw = raw.strip("`")
            if raw.lower().startswith("json"):
                raw = raw[4:].strip()
        plan = json.loads(raw)
        summary = str(plan.get("summary", "")).strip()[:800]
        raw_steps = plan.get("steps")
        steps = []
        if isinstance(raw_steps, list):
            for step in raw_steps[:5]:
                if isinstance(step, dict):
                    title = str(step.get("title", "")).strip()[:80]
                    detail = str(step.get("detail", "")).strip()[:300]
                    if title and detail:
                        steps.append({"title": title, "detail": detail})
        if summary and len(steps) >= 3:
            return {"summary": summary, "steps": steps}, True
    except (httpx.HTTPError, ValueError, TypeError, KeyError):
        pass
    return fallback, False


def public_proposal(row: dict[str, Any]) -> dict[str, Any]:
    parsed = parse_proposal(dict(row))
    parsed.pop("intent_id", None)
    parsed.pop("tx_hash", None) if parsed.get("status") not in {"submitted", "confirmed", "failed"} else None
    return parsed


@app.get("/health")
def health():
    return {"ok": True, "service": config.APP_NAME, "chain_id": config.CHAIN_ID, "chain_name": config.CHAIN_NAME,
            "rpc_configured": bool(config.RPC_URL), "llm_configured": bool(config.ANTHROPIC_API_KEY),
            "mainnet_enabled": False, "auth_secret_configured": app_secret_ready()}

@app.get("/v1/policy")
def policy():
    return {"chain_id": config.CHAIN_ID, "chain_name": config.CHAIN_NAME,
            "max_transaction_eth": str(config.MAX_TX_ETH), "daily_limit_eth": str(config.DAILY_LIMIT_ETH),
            "max_fee_eth": str(config.MAX_FEE_ETH), "max_gas_limit": config.MAX_GAS_LIMIT,
            "allow_any_recipient": config.ALLOW_ANY_RECIPIENT, "allowlist_count": len(config.ALLOWED_RECIPIENTS),
            "rpc_configured": bool(config.RPC_URL), "llm_configured": bool(config.ANTHROPIC_API_KEY),
            "mainnet_enabled": False, "auth_secret_configured": app_secret_ready(),
            "signing": "MetaMask only; server holds no private keys"}

@app.post("/v1/auth/challenge")
def create_challenge(body: ChallengeRequest):
    if not app_secret_ready():
        raise HTTPException(503, "Set APP_SECRET to a random secret of at least 32 characters before connecting a wallet.")
    if not valid_address(body.address):
        raise HTTPException(422, "Invalid EVM wallet address.")
    address = body.address.lower()
    cid = secrets.token_urlsafe(24)
    expiry = now() + 300
    message = f"Agent Vault login\nAddress: {address}\nNonce: {secrets.token_hex(16)}\nExpires: {expiry}\nChain: Sepolia (11155111)\nThis signature authenticates this app session only; it does not authorize a transaction."
    with connect() as db:
        db.execute("DELETE FROM challenges WHERE expires_at<?", (now(),))
        db.execute("INSERT INTO challenges(id,address,message,expires_at) VALUES(?,?,?,?)", (cid, address, message, expiry))
    return {"challenge_id": cid, "message": message, "expires_at": expiry}

@app.post("/v1/auth/verify")
def verify_challenge(body: VerifyRequest):
    if not app_secret_ready():
        raise HTTPException(503, "Set APP_SECRET to a random secret of at least 32 characters before connecting a wallet.")
    with connect() as db:
        row = db.execute("SELECT * FROM challenges WHERE id=?", (body.challenge_id,)).fetchone()
        if not row:
            raise HTTPException(401, "Challenge not found or already used.")
        # Challenges are single-use, including failed signature attempts.
        db.execute("DELETE FROM challenges WHERE id=?", (body.challenge_id,))
    if row["expires_at"] < now() or row["address"] != body.address.lower():
        raise HTTPException(401, "Challenge expired or wallet address did not match.")
    try:
        recovered = recover_address(row["message"], body.signature)
    except Exception as exc:
        raise HTTPException(401, "Wallet signature could not be verified.") from exc
    if recovered != body.address.lower():
        raise HTTPException(401, "Signature does not match the connected wallet.")
    return {"access_token": issue_token(recovered), "token_type": "bearer", "wallet": recovered,
            "expires_in": config.SESSION_TTL_SECONDS}

@app.post("/v1/agent/plan")
def create_plan(body: PlanRequest, owner: str = Depends(require_wallet)):
    recipient = body.recipient.lower()
    if not valid_address(recipient):
        raise HTTPException(422, "Recipient address is invalid.")
    amount, value_wei = amount_to_wei(body.amount_eth)
    # Record over-limit attempts as blocked proposals for the audit trail, without querying the RPC.
    simulation = simulation_for_value(owner, recipient, value_wei)
    with connect() as db:
        spent = active_spend_wei(db, owner)
        checks = evaluate_policy(owner, recipient, value_wei, simulation, spent)
        allowed = all(x["status"] == "pass" for x in checks)
        agent_plan, llm_used = build_agent_plan(body.goal, amount, recipient)
        explanation = agent_plan["summary"]
        pid = uuid4().hex
        created = now(); expires = created + config.PROPOSAL_TTL_SECONDS
        status = "proposed" if allowed else "blocked"
        db.execute("INSERT INTO proposals(id,owner,goal,recipient,amount_wei,amount_eth,chain_id,explanation,llm_used,agent_plan_json,simulation_json,risk_json,created_at,expires_at,status) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
                   (pid, owner, body.goal.strip(), recipient, str(value_wei), str(amount), config.CHAIN_ID, explanation,
                    int(llm_used), json.dumps(agent_plan), json.dumps(simulation), json.dumps(checks), created, expires, status))
        add_audit(db, owner, "proposal_created", "pass" if allowed else "block",
                  "Proposal created; no transaction has been signed or broadcast.", pid,
                  details={"amount_eth": str(amount), "recipient": recipient, "checks": checks, "llm_used": llm_used})
        row = dict(db.execute("SELECT * FROM proposals WHERE id=?", (pid,)).fetchone())
    return {"proposal": public_proposal(row), "eligible": allowed,
            "message": "Proposal passed current checks. You must still prepare and explicitly approve in MetaMask." if allowed else "Proposal blocked by one or more server-side checks. Review the reasons below."}

@app.post("/v1/transactions/validate")
def validate_plan(body: PrepareRequest, owner: str = Depends(require_wallet)):
    row = get_proposal(body.proposal_id)
    if not row or row["owner"] != owner:
        raise HTTPException(404, "Proposal not found for this wallet.")
    if body.chain_id != config.CHAIN_ID:
        raise HTTPException(409, "Only Sepolia is supported.")
    if row["expires_at"] < now():
        raise HTTPException(410, "Proposal expired. Create a new proposal.")
    sim = simulation_for_value(owner, row["recipient"], int(row["amount_wei"]))
    with connect() as db:
        spent = active_spend_wei(db, owner)
        checks = evaluate_policy(owner, row["recipient"], int(row["amount_wei"]), sim, spent)
        db.execute("UPDATE proposals SET simulation_json=?,risk_json=? WHERE id=?", (json.dumps(sim), json.dumps(checks), body.proposal_id))
        add_audit(db, owner, "proposal_revalidated", "pass" if all(x["status"] == "pass" for x in checks) else "block",
                  "Server independently rechecked policy and RPC simulation.", body.proposal_id, details={"checks": checks})
    return {"eligible": all(x["status"] == "pass" for x in checks), "simulation": sim, "checks": checks,
            "expires_at": row["expires_at"]}

@app.post("/v1/transactions/prepare")
def prepare_transaction(body: PrepareRequest, owner: str = Depends(require_wallet)):
    if body.chain_id != config.CHAIN_ID:
        raise HTTPException(409, "Only Sepolia (11155111) transactions are permitted.")
    row = get_proposal(body.proposal_id)
    if not row or row["owner"] != owner:
        raise HTTPException(404, "Proposal not found for this wallet.")
    if row["status"] in {"prepared", "submitted", "confirmed", "failed"}:
        raise HTTPException(409, "This proposal has already been prepared or submitted. Create a new proposal rather than replaying it.")
    if row["expires_at"] < now():
        raise HTTPException(410, "Proposal expired. Create a new proposal.")
    simulation = simulation_for_value(owner, row["recipient"], int(row["amount_wei"]))
    intent = secrets.token_urlsafe(24)
    timestamp = now()
    with connect() as db:
        db.execute("BEGIN IMMEDIATE")
        current = db.execute("SELECT * FROM proposals WHERE id=?", (body.proposal_id,)).fetchone()
        if not current or current["owner"] != owner or current["status"] in {"prepared", "submitted", "confirmed", "failed"}:
            db.rollback(); raise HTTPException(409, "Proposal state changed. Create a new proposal.")
        if current["expires_at"] < timestamp:
            db.rollback(); raise HTTPException(410, "Proposal expired. Create a new proposal.")
        spent = active_spend_wei(db, owner, timestamp)
        checks = evaluate_policy(owner, current["recipient"], int(current["amount_wei"]), simulation, spent)
        if not all(x["status"] == "pass" for x in checks):
            db.execute("UPDATE proposals SET status='blocked',simulation_json=?,risk_json=? WHERE id=?", (json.dumps(simulation), json.dumps(checks), body.proposal_id))
            add_audit(db, owner, "transaction_prepare_blocked", "block", "Server blocked preparation after a fresh policy/simulation check.", body.proposal_id, details={"checks":checks})
            db.commit()
            raise HTTPException(409, {"message":"Transaction is blocked by current policy or simulation.", "checks":checks, "simulation":simulation})
        db.execute("UPDATE proposals SET status='prepared',intent_id=?,intent_expires_at=?,simulation_json=?,risk_json=? WHERE id=?",
                   (intent, min(timestamp + 90, current["expires_at"]), json.dumps(simulation), json.dumps(checks), body.proposal_id))
        add_audit(db, owner, "transaction_prepared", "pass", "One-time, expiring approval intent issued; MetaMask confirmation is still required.", body.proposal_id,
                  details={"intent_expires_at":min(timestamp + 90, current["expires_at"]), "checks":checks})
        db.commit()
    return {"intent_id":intent, "intent_expires_at":min(timestamp+90,row["expires_at"]), "chain_id":config.CHAIN_ID,
            "transaction":{"from":owner,"to":row["recipient"],"value_wei":row["amount_wei"],"data":"0x",
                           "gas_limit":simulation["max_gas_limit"], "max_fee_per_gas_wei":simulation["max_fee_per_gas_wei"]},
            "simulation":simulation, "message":"Review the exact transaction details in MetaMask before confirming."}

@app.post("/v1/transactions/confirm")
def confirm_transaction(body: ConfirmRequest, owner: str = Depends(require_wallet)):
    if not TX_HASH_RE.fullmatch(body.tx_hash):
        raise HTTPException(422, "Invalid transaction hash.")
    tx_hash = body.tx_hash.lower()
    row = get_proposal(body.proposal_id)
    if not row or row["owner"] != owner:
        raise HTTPException(404, "Proposal not found for this wallet.")
    if row["status"] == "confirmed" and (row["tx_hash"] or "").lower() == tx_hash:
        return {"confirmed":True,"status":"confirmed","tx_hash":tx_hash,"receipt":json.loads(row["receipt_json"] or "{}"),"idempotent":True}
    if row["status"] not in {"prepared", "submitted"} or row["intent_id"] != body.intent_id:
        raise HTTPException(409, "Approval intent is invalid, expired, or already consumed.")
    if row["status"] == "prepared" and (row["intent_expires_at"] is None or row["intent_expires_at"] < now()):
        raise HTTPException(410, "Approval intent expired. Do not retry signing; create a new proposal.")
    if row["tx_hash"] and row["tx_hash"].lower() != tx_hash:
        raise HTTPException(409, "A different transaction hash is already bound to this proposal.")
    with connect() as db:
        existing_hash = db.execute("SELECT id FROM proposals WHERE tx_hash=? AND id<>?", (tx_hash, body.proposal_id)).fetchone()
    if existing_hash:
        raise HTTPException(409, "This transaction hash is already associated with another proposal.")
    # Hash ownership can only be verified against the configured Sepolia RPC.
    try:
        tx, receipt = fetch_transaction_and_receipt(tx_hash)
    except RpcError as exc:
        raise HTTPException(503, str(exc)) from exc
    if tx is None:
        with connect() as db:
            current = db.execute("SELECT tx_hash,status FROM proposals WHERE id=?", (body.proposal_id,)).fetchone()
            if current["tx_hash"] and current["tx_hash"].lower() != tx_hash:
                raise HTTPException(409, "A different transaction hash is already bound to this proposal.")
            db.execute("UPDATE proposals SET status='submitted',tx_hash=? WHERE id=?", (tx_hash, body.proposal_id))
            add_audit(db, owner, "transaction_hash_submitted", "pending", "Hash received; waiting for it to become visible on the configured Sepolia RPC.", body.proposal_id, tx_hash)
        raise HTTPException(202, {"status":"pending","message":"Transaction is not visible on the configured Sepolia RPC yet. Retry this same hash."})
    # Refuse incomplete or internally inconsistent RPC data. The configured endpoint is
    # trusted for simulation and verification, but the fields are still cross-checked.
    observed_hash = str(tx.get("hash", "")).lower()
    if not observed_hash or observed_hash != tx_hash:
        raise HTTPException(409, "Configured RPC returned a transaction with a missing or different hash.")
    tx_chain_id = tx.get("chainId")
    if tx_chain_id is not None and int(str(tx_chain_id), 16) != config.CHAIN_ID:
        raise HTTPException(409, "RPC transaction is not on Sepolia.")
    try:
        tx_from = str(tx["from"]).lower()
        tx_to = str(tx["to"]).lower()
        tx_value = int(str(tx["value"]), 16)
        raw_data = tx.get("input", tx.get("data"))
        if not isinstance(raw_data, str):
            raise ValueError("missing calldata")
        tx_data = raw_data.lower()
        gas_limit = int(str(tx["gas"]), 16)
        fee_field = tx.get("maxFeePerGas") or tx.get("gasPrice")
        if fee_field is None:
            raise ValueError("missing fee field")
        max_fee = int(str(fee_field), 16)
        if gas_limit <= 0 or max_fee <= 0:
            raise ValueError("non-positive gas or fee")
    except (KeyError, TypeError, ValueError) as exc:
        raise HTTPException(502, "Configured RPC returned incomplete or invalid transaction data.") from exc
    simulation = json.loads(row["simulation_json"] or "{}")
    if tx_from != owner or tx_to != row["recipient"].lower() or tx_value != int(row["amount_wei"]) or tx_data != "0x":
        with connect() as db:
            add_audit(db, owner, "transaction_mismatch", "block", "Mined transaction did not match the approved proposal fields.", body.proposal_id, tx_hash,
                      {"from":tx_from,"to":tx_to,"value_wei":str(tx_value),"data":tx_data})
        raise HTTPException(409, "Transaction hash does not match the approved sender, recipient, amount, or empty calldata.")
    if gas_limit > int(simulation.get("max_gas_limit", 0)) or max_fee > int(simulation.get("max_fee_per_gas_wei", 0)):
        with connect() as db:
            add_audit(db, owner, "transaction_fee_mismatch", "block", "Mined transaction exceeded the approved gas bounds.", body.proposal_id, tx_hash,
                      {"gas_limit":gas_limit,"max_fee_per_gas_wei":str(max_fee)})
        raise HTTPException(409, "Transaction gas or fee cap exceeds the approved simulation bounds.")
    if receipt is None:
        with connect() as db:
            current = db.execute("SELECT status,tx_hash FROM proposals WHERE id=?", (body.proposal_id,)).fetchone()
            if current["tx_hash"] and current["tx_hash"].lower() != tx_hash:
                raise HTTPException(409,"A different transaction hash is already bound to this proposal.")
            db.execute("UPDATE proposals SET status='submitted',tx_hash=? WHERE id=?", (tx_hash,body.proposal_id))
            add_audit(db,owner,"transaction_submitted","pending","Hash verified against the signed transaction; waiting for a mined receipt.",body.proposal_id,tx_hash)
        raise HTTPException(202, {"status":"pending","tx_hash":tx_hash,"message":"Transaction was found; waiting for a mined receipt."})
    receipt_hash = str(receipt.get("transactionHash", "")).lower()
    if not receipt_hash or receipt_hash != tx_hash:
        raise HTTPException(409, "RPC receipt hash does not match the submitted transaction hash.")
    try:
        receipt_status = int(str(receipt["status"]), 16)
        block_number = int(str(receipt["blockNumber"]), 16)
        gas_used = int(str(receipt["gasUsed"]), 16)
        effective_gas_price = int(str(receipt.get("effectiveGasPrice", tx.get("gasPrice", tx.get("maxFeePerGas", "0x0")))), 16)
        if receipt_status not in (0, 1) or block_number <= 0 or gas_used <= 0 or effective_gas_price <= 0:
            raise ValueError("receipt fields outside expected bounds")
    except (KeyError, TypeError, ValueError) as exc:
        raise HTTPException(502, "Configured RPC returned incomplete or invalid receipt data.") from exc
    receipt_public = {"transaction_hash":receipt_hash, "block_number":block_number,
                      "status":"success" if receipt_status == 1 else "reverted", "gas_used":gas_used,
                      "effective_gas_price_wei":str(effective_gas_price),
                      "to":tx_to,"from":tx_from,"value_wei":str(tx_value),"chain_id":config.CHAIN_ID}
    final_status = "confirmed" if receipt_status == 1 else "failed"
    with connect() as db:
        db.execute("BEGIN IMMEDIATE")
        db.execute("UPDATE proposals SET status=?,tx_hash=?,receipt_json=? WHERE id=?", (final_status,tx_hash,json.dumps(receipt_public),body.proposal_id))
        add_audit(db,owner,"transaction_confirmed" if receipt_status == 1 else "transaction_reverted",
                  "pass" if receipt_status == 1 else "block", "Receipt verified against the approved proposal." if receipt_status == 1 else "On-chain transaction reverted; it was not marked successful.",
                  body.proposal_id,tx_hash,receipt_public)
        db.commit()
    return {"confirmed":receipt_status == 1,"status":final_status,"tx_hash":tx_hash,"receipt":receipt_public}

@app.get("/v1/audit")
def audit_log(q: str = Query(default="", max_length=160), limit: int = Query(default=100, ge=1, le=250), owner: str = Depends(require_wallet)):
    with connect() as db:
        if q.strip():
            pattern = f"%{q.strip()}%"
            rows = db.execute("""SELECT * FROM audit WHERE wallet=? AND (action LIKE ? OR status LIKE ? OR message LIKE ? OR proposal_id LIKE ? OR tx_hash LIKE ? OR details_json LIKE ?) ORDER BY created_at DESC LIMIT ?""",
                              (owner,pattern,pattern,pattern,pattern,pattern,pattern,limit)).fetchall()
        else:
            rows = db.execute("SELECT * FROM audit WHERE wallet=? ORDER BY created_at DESC LIMIT ?", (owner,limit)).fetchall()
    return {"items":[{"id":r["id"],"created_at":r["created_at"],"action":r["action"],"proposal_id":r["proposal_id"],
                       "status":r["status"],"message":r["message"],"tx_hash":r["tx_hash"],"details":json.loads(r["details_json"] or "{}")}
                      for r in rows],"count":len(rows)}

@app.get("/v1/proposals/{proposal_id}")
def read_proposal(proposal_id: str, owner: str = Depends(require_wallet)):
    row = get_proposal(proposal_id)
    if not row or row["owner"] != owner:
        raise HTTPException(404, "Proposal not found for this wallet.")
    return {"proposal":public_proposal(row)}
