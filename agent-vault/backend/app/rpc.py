from __future__ import annotations
from decimal import Decimal
import httpx
from . import config

WEI = 10**18

class RpcError(RuntimeError):
    pass


def rpc(method: str, params: list) -> object:
    if not config.RPC_URL:
        raise RpcError("SEPOLIA_RPC_URL is not configured. Trusted simulation is unavailable; fail-closed.")
    try:
        response = httpx.post(config.RPC_URL, json={"jsonrpc":"2.0", "id":1, "method":method, "params":params}, timeout=8.0)
        response.raise_for_status()
        body = response.json()
        if not isinstance(body, dict):
            raise RpcError("RPC returned a malformed response")
        if body.get("error"):
            error = body["error"]
            message = error.get("message", "RPC error") if isinstance(error, dict) else str(error)
            raise RpcError(str(message))
        if "result" not in body:
            raise RpcError("RPC returned a malformed response")
        return body["result"]
    except (httpx.HTTPError, ValueError) as exc:
        raise RpcError(f"RPC request failed: {exc.__class__.__name__}") from exc


def verify_network() -> None:
    actual = int(str(rpc("eth_chainId", [])), 16)
    if actual != config.CHAIN_ID:
        raise RpcError(f"Configured RPC reports chain ID {actual}; only Sepolia ({config.CHAIN_ID}) is allowed")


def simulate_native_transfer(sender: str, recipient: str, amount_wei: int) -> dict:
    """Trusted server-side node simulation, with bounded gas and fee policy."""
    try:
        verify_network()
        tx = {"from": sender, "to": recipient, "value": hex(amount_wei), "data": "0x"}
        # eth_call checks whether the node can execute the proposed call without broadcasting it.
        rpc("eth_call", [tx, "latest"])
        estimate = int(str(rpc("eth_estimateGas", [tx])), 16)
        gas_price = int(str(rpc("eth_gasPrice", [])), 16)
        if estimate <= 0:
            raise RpcError("RPC returned a non-positive gas estimate; simulation blocked")
        if gas_price < 0:
            raise RpcError("RPC returned an invalid gas price; simulation blocked")
        max_gas = (estimate * 120 + 99) // 100
        max_fee_per_gas = gas_price * 2
        fee_wei = max_gas * max_fee_per_gas
        balance = int(str(rpc("eth_getBalance", [sender, "latest"])), 16)
        checks = []
        if max_gas > config.MAX_GAS_LIMIT:
            checks.append(f"Estimated gas exceeds the configured limit of {config.MAX_GAS_LIMIT}.")
        if Decimal(fee_wei) / WEI > config.MAX_FEE_ETH:
            checks.append(f"Estimated maximum fee exceeds {config.MAX_FEE_ETH} ETH.")
        if balance < amount_wei + fee_wei:
            checks.append("Sender balance may not cover the transfer plus maximum estimated network fee.")
        return {"ok": not checks, "reason": "Simulation passed" if not checks else " ".join(checks),
                "gas_estimate": estimate, "max_gas_limit": max_gas, "gas_price_wei": str(gas_price),
                "max_fee_per_gas_wei": str(max_fee_per_gas), "max_fee_wei": str(fee_wei),
                "sender_balance_wei": str(balance), "rpc_verified_chain_id": config.CHAIN_ID,
                "checks": ["eth_call", "eth_estimateGas", "eth_getBalance", "eth_gasPrice"]}
    except (RpcError, TypeError, ValueError) as exc:
        return {"ok": False, "reason": str(exc), "checks": []}


def fetch_transaction_and_receipt(tx_hash: str) -> tuple[dict | None, dict | None]:
    verify_network()
    tx = rpc("eth_getTransactionByHash", [tx_hash])
    receipt = rpc("eth_getTransactionReceipt", [tx_hash])
    return (tx if isinstance(tx, dict) else None, receipt if isinstance(receipt, dict) else None)
