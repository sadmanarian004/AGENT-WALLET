from decimal import Decimal
import time
from fastapi.testclient import TestClient
from cryptography.hazmat.primitives import hashes
from cryptography.hazmat.primitives.asymmetric import ec, utils

from app import config, main, rpc
from app.main import amount_to_wei, evaluate_policy
from app.security import issue_token, recover_address, address_from_public_key, personal_sign_hash
from app.store import init_db


def test_eth_conversion_is_exact_and_rejects_overprecision():
    amount, wei = amount_to_wei("0.000000000000000001")
    assert amount == Decimal("0.000000000000000001")
    assert wei == 1
    assert amount_to_wei("1.000000000000000001")[1] == 1000000000000000001
    try:
        amount_to_wei("0.0000000000000000001")
    except Exception as exc:
        assert "18 decimal places" in str(exc)
    else:
        assert False, "Must reject more than 18 decimal places"


def test_policy_blocks_when_rpc_simulation_fails(monkeypatch):
    recipient = "0x1111111111111111111111111111111111111111"
    monkeypatch.setattr(config, "ALLOW_ANY_RECIPIENT", False)
    monkeypatch.setattr(config, "ALLOWED_RECIPIENTS", {recipient})
    checks = evaluate_policy("0x2222222222222222222222222222222222222222", recipient, 10**15,
                             {"ok": False, "reason": "RPC down"}, 0)
    assert any(c["name"] == "trusted_simulation" and c["status"] == "block" for c in checks)
    assert all(c["status"] == "pass" for c in checks if c["name"] != "trusted_simulation")


def test_trusted_simulation_checks_network_fee_balance_and_gas(monkeypatch):
    monkeypatch.setattr(config, "RPC_URL", "https://mock.invalid")
    monkeypatch.setattr(config, "MAX_GAS_LIMIT", 50000)
    def fake_rpc(method, params):
        return {
            "eth_chainId": "0xaa36a7", "eth_call": "0x", "eth_estimateGas": "0x5208",
            "eth_gasPrice": "0x3b9aca00", "eth_getBalance": hex(10**18),
        }[method]
    monkeypatch.setattr(rpc, "rpc", fake_rpc)
    result = rpc.simulate_native_transfer("0x2222222222222222222222222222222222222222",
                                         "0x1111111111111111111111111111111111111111", 10**15)
    assert result["ok"] is True
    assert result["gas_estimate"] == 21000
    assert result["max_gas_limit"] == 25200
    assert int(result["max_fee_wei"]) > 0


def make_signer():
    private_key = ec.generate_private_key(ec.SECP256K1())
    pub = private_key.public_key().public_numbers()
    address = address_from_public_key(pub.x, pub.y)
    return private_key, address


def sign_personal(private_key, address: str, message: str) -> str:
    digest = personal_sign_hash(message)
    der = private_key.sign(digest, ec.ECDSA(utils.Prehashed(hashes.SHA256())))
    r, s = utils.decode_dss_signature(der)
    n = 0xFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFEBAAEDCE6AF48A03BBFD25E8CD0364141
    if s > n // 2: s = n - s
    for v in (27, 28):
        sig = "0x" + r.to_bytes(32, "big").hex() + s.to_bytes(32, "big").hex() + bytes([v]).hex()
        try:
            if recover_address(message, sig) == address.lower(): return sig
        except ValueError:
            pass
    raise AssertionError("Could not find signature recovery bit")


def test_ethereum_keccak_vector_and_wallet_signature_authenticates_challenge_once(tmp_path, monkeypatch):
    from app.security import keccak256
    assert keccak256(b"").hex() == "c5d2460186f7233c927e7db2dcc703c0e500b653ca82273b7bfad8045d85a470"
    monkeypatch.setattr(config, "DATABASE_PATH", str(tmp_path / "test.sqlite3"))
    monkeypatch.setattr(config, "APP_SECRET", "test-random-secret-for-wallet-session-auth-123456")
    init_db()
    private_key, address = make_signer()
    with TestClient(main.app) as client:
        ch = client.post("/v1/auth/challenge", json={"address": address}).json()
        sig = sign_personal(private_key, address, ch["message"])
        verify = client.post("/v1/auth/verify", json={"challenge_id": ch["challenge_id"], "address": address, "signature": sig})
        assert verify.status_code == 200, verify.text
        assert verify.json()["wallet"].lower() == address.lower()
        again = client.post("/v1/auth/verify", json={"challenge_id": ch["challenge_id"], "address": address, "signature": sig})
        assert again.status_code == 401


def test_duplicate_prepare_intent_is_blocked(tmp_path, monkeypatch):
    monkeypatch.setattr(config, "DATABASE_PATH", str(tmp_path / "prepare.sqlite3"))
    monkeypatch.setattr(config, "APP_SECRET", "test-random-secret-for-wallet-session-auth-123456")
    monkeypatch.setattr(config, "ALLOWED_RECIPIENTS", {"0x1111111111111111111111111111111111111111"})
    monkeypatch.setattr(config, "ALLOW_ANY_RECIPIENT", False)
    monkeypatch.setattr(config, "RPC_URL", "https://mock.invalid")
    simulation = {"ok": True, "reason": "Simulation passed", "gas_estimate": 21000, "max_gas_limit": 25200,
                  "gas_price_wei": "1000000000", "max_fee_per_gas_wei": "2000000000", "max_fee_wei": str(50400 * 10**9),
                  "sender_balance_wei": str(10**18), "rpc_verified_chain_id": 11155111, "checks": ["mock"]}
    monkeypatch.setattr(main, "simulate_native_transfer", lambda *args: simulation)
    init_db()
    _, account_address = make_signer()
    token = issue_token(account_address)
    headers = {"Authorization": f"Bearer {token}"}
    with TestClient(main.app) as client:
        planned = client.post("/v1/agent/plan", headers=headers, json={"goal":"Pay a test recipient", "recipient":"0x1111111111111111111111111111111111111111", "amount_eth":"0.001"})
        assert planned.status_code == 200, planned.text
        pid = planned.json()["proposal"]["id"]
        req = {"proposal_id":pid,"chain_id":11155111}
        prepared = client.post("/v1/transactions/prepare", headers=headers, json=req)
        assert prepared.status_code == 200, prepared.text
        assert prepared.json()["intent_id"]
        repeated = client.post("/v1/transactions/prepare", headers=headers, json=req)
        assert repeated.status_code == 409


def test_confirmation_checks_transaction_and_receipt_then_records_searchable_audit(tmp_path, monkeypatch):
    monkeypatch.setattr(config, "DATABASE_PATH", str(tmp_path / "confirm.sqlite3"))
    monkeypatch.setattr(config, "APP_SECRET", "test-random-secret-for-wallet-session-auth-123456")
    monkeypatch.setattr(config, "ALLOWED_RECIPIENTS", {"0x1111111111111111111111111111111111111111"})
    monkeypatch.setattr(config, "ALLOW_ANY_RECIPIENT", False)
    monkeypatch.setattr(config, "RPC_URL", "https://mock.invalid")
    simulation = {"ok": True, "reason": "Simulation passed", "gas_estimate": 21000,
                  "max_gas_limit": 25200, "gas_price_wei": "1000000000",
                  "max_fee_per_gas_wei": "2000000000", "max_fee_wei": str(25200 * 2 * 10**9),
                  "sender_balance_wei": str(10**18), "rpc_verified_chain_id": 11155111, "checks": ["mock"]}
    monkeypatch.setattr(main, "simulate_native_transfer", lambda *args: simulation)
    init_db()
    _, address = make_signer()
    token = issue_token(address)
    headers = {"Authorization": f"Bearer {token}"}
    tx_hash = "0x" + "a" * 64
    tx = {"hash": tx_hash, "chainId": "0xaa36a7", "from": address, "to": "0x1111111111111111111111111111111111111111",
          "value": hex(10**15), "input": "0x", "gas": hex(25200), "maxFeePerGas": hex(2 * 10**9)}
    wrong_receipt = {"transactionHash": "0x" + "b" * 64, "status": "0x1", "blockNumber": "0x2", "gasUsed": "0x5208"}
    valid_receipt = {"transactionHash": tx_hash, "status": "0x1", "blockNumber": "0x2", "gasUsed": "0x5208",
                     "effectiveGasPrice": hex(10**9)}
    rpc_results = [(tx, wrong_receipt), (tx, valid_receipt)]
    monkeypatch.setattr(main, "fetch_transaction_and_receipt", lambda _hash: rpc_results.pop(0))

    with TestClient(main.app) as client:
        planned = client.post("/v1/agent/plan", headers=headers,
                              json={"goal": "Pay a test recipient", "recipient": tx["to"], "amount_eth": "0.001"})
        assert planned.status_code == 200, planned.text
        proposal_id = planned.json()["proposal"]["id"]
        prepared = client.post("/v1/transactions/prepare", headers=headers,
                               json={"proposal_id": proposal_id, "chain_id": 11155111})
        assert prepared.status_code == 200, prepared.text
        intent_id = prepared.json()["intent_id"]
        body = {"proposal_id": proposal_id, "intent_id": intent_id, "tx_hash": tx_hash}

        mismatch = client.post("/v1/transactions/confirm", headers=headers, json=body)
        assert mismatch.status_code == 409
        confirmed = client.post("/v1/transactions/confirm", headers=headers, json=body)
        assert confirmed.status_code == 200, confirmed.text
        assert confirmed.json()["confirmed"] is True
        assert confirmed.json()["receipt"]["transaction_hash"] == tx_hash

        repeated = client.post("/v1/transactions/confirm", headers=headers, json=body)
        assert repeated.status_code == 200
        assert repeated.json()["idempotent"] is True

        audit = client.get("/v1/audit", headers=headers, params={"q": tx["to"]})
        assert audit.status_code == 200, audit.text
        assert any(item["action"] == "proposal_created" for item in audit.json()["items"])


def test_wallet_authentication_refuses_known_placeholder_app_secret(tmp_path, monkeypatch):
    monkeypatch.setattr(config, "DATABASE_PATH", str(tmp_path / "weak-secret.sqlite3"))
    monkeypatch.setattr(config, "APP_SECRET", "replace-with-a-long-random-secret-before-use")
    init_db()
    with TestClient(main.app) as client:
        response = client.post("/v1/auth/challenge", json={"address": "0x1111111111111111111111111111111111111111"})
        assert response.status_code == 503
        assert "APP_SECRET" in response.text
