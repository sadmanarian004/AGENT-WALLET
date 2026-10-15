from __future__ import annotations
import base64, hashlib, hmac, json, re, time, secrets
from fastapi import Header, HTTPException
from . import config
try:
    # Prefer the maintained Ethereum account library whenever it is installed.
    from eth_account import Account as _EthAccount
    from eth_account.messages import encode_defunct as _encode_defunct
except ImportError:  # Offline test environments can use the self-contained recovery path below.
    _EthAccount = None
    _encode_defunct = None

ADDRESS_RE = re.compile(r"^0x[a-fA-F0-9]{40}$")
TX_HASH_RE = re.compile(r"^0x[a-fA-F0-9]{64}$")
# secp256k1 parameters (Ethereum EOAs)
_P = 0xFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFEFFFFFC2F
_N = 0xFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFEBAAEDCE6AF48A03BBFD25E8CD0364141
_G = (0x79BE667EF9DCBBAC55A06295CE870B07029BFCDB2DCE28D959F2815B16F81798,
      0x483ADA7726A3C4655DA4FBFC0E1108A8FD17B448A68554199C47D08FFB10D4B8)
_MASK = (1 << 64) - 1
_RC = [0x0000000000000001,0x0000000000008082,0x800000000000808A,0x8000000080008000,
       0x000000000000808B,0x0000000080000001,0x8000000080008081,0x8000000000008009,
       0x000000000000008A,0x0000000000000088,0x0000000080008009,0x000000008000000A,
       0x000000008000808B,0x800000000000008B,0x8000000000008089,0x8000000000008003,
       0x8000000000008002,0x8000000000000080,0x000000000000800A,0x800000008000000A,
       0x8000000080008081,0x8000000000008080,0x0000000080000001,0x8000000080008008]
_RHO = [[0,36,3,41,18],[1,44,10,45,2],[62,6,43,15,61],[28,55,25,21,56],[27,20,39,8,14]]


def keccak256(data: bytes) -> bytes:
    """Minimal Ethereum Keccak-256 implementation (legacy Keccak padding, not NIST SHA3)."""
    rate = 136
    padded = bytearray(data)
    padded.append(0x01)
    padded.extend(b"\x00" * ((rate - len(padded) % rate) % rate))
    padded[-1] |= 0x80  # final bit of the final rate byte (may share the suffix byte)
    state = [0] * 25
    for offset in range(0, len(padded), rate):
        block = padded[offset:offset + rate]
        for i in range(rate // 8):
            state[i] ^= int.from_bytes(block[i * 8:(i + 1) * 8], "little")
        for rc in _RC:
            c = [state[x] ^ state[x+5] ^ state[x+10] ^ state[x+15] ^ state[x+20] for x in range(5)]
            d = [c[(x-1) % 5] ^ (((c[(x+1) % 5] << 1) | (c[(x+1) % 5] >> 63)) & _MASK) for x in range(5)]
            for y in range(5):
                for x in range(5):
                    state[x + 5*y] ^= d[x]
            b = [0] * 25
            for y in range(5):
                for x in range(5):
                    value = state[x + 5*y]
                    r = _RHO[x][y]
                    rotated = value if r == 0 else ((value << r) | (value >> (64-r))) & _MASK
                    b[y + 5 * ((2*x + 3*y) % 5)] = rotated
            for y in range(5):
                for x in range(5):
                    state[x + 5*y] = b[x + 5*y] ^ ((~b[(x+1)%5 + 5*y]) & b[(x+2)%5 + 5*y])
            state[0] ^= rc
    return b"".join(x.to_bytes(8, "little") for x in state)[:32]


def _inv(value: int, modulus: int) -> int:
    return pow(value, -1, modulus)


def _add(p1: tuple[int, int] | None, p2: tuple[int, int] | None) -> tuple[int, int] | None:
    if p1 is None: return p2
    if p2 is None: return p1
    x1, y1 = p1; x2, y2 = p2
    if x1 == x2 and (y1 + y2) % _P == 0: return None
    if p1 == p2:
        if y1 == 0: return None
        slope = (3 * x1 * x1) * _inv(2 * y1 % _P, _P) % _P
    else:
        slope = (y2 - y1) * _inv((x2 - x1) % _P, _P) % _P
    x3 = (slope * slope - x1 - x2) % _P
    y3 = (slope * (x1 - x3) - y1) % _P
    return x3, y3


def _mul(scalar: int, point: tuple[int, int] | None) -> tuple[int, int] | None:
    scalar %= _N
    result = None
    addend = point
    while scalar:
        if scalar & 1: result = _add(result, addend)
        addend = _add(addend, addend)
        scalar >>= 1
    return result


def personal_sign_hash(message: str) -> bytes:
    data = message.encode("utf-8")
    prefix = b"\x19Ethereum Signed Message:\n" + str(len(data)).encode("ascii")
    return keccak256(prefix + data)


def address_from_public_key(x: int, y: int) -> str:
    return "0x" + keccak256(x.to_bytes(32, "big") + y.to_bytes(32, "big"))[-20:].hex()


def valid_address(address: str) -> bool:
    return bool(ADDRESS_RE.fullmatch(address or ""))


def recover_address(message: str, signature: str) -> str:
    """Recover the EOA signer from MetaMask `personal_sign` (65-byte r,s,v signature)."""
    if _EthAccount is not None:
        return _EthAccount.recover_message(_encode_defunct(text=message), signature=signature).lower()
    if not isinstance(signature, str) or not re.fullmatch(r"0x[0-9a-fA-F]{130}", signature):
        raise ValueError("Invalid Ethereum signature encoding")
    raw = bytes.fromhex(signature[2:])
    r = int.from_bytes(raw[:32], "big")
    s = int.from_bytes(raw[32:64], "big")
    v = raw[64]
    recovery = v - 27 if v in (27, 28) else v if v in (0, 1) else -1
    if recovery not in (0, 1) or not (1 <= r < _N and 1 <= s < _N):
        raise ValueError("Invalid Ethereum signature parameters")
    x = r
    if x >= _P: raise ValueError("Invalid signature recovery point")
    alpha = (pow(x, 3, _P) + 7) % _P
    y = pow(alpha, (_P + 1) // 4, _P)
    if pow(y, 2, _P) != alpha: raise ValueError("Signature recovery point is not on secp256k1")
    if y & 1 != recovery: y = _P - y
    point_r = (x, y)
    if _mul(_N, point_r) is not None: raise ValueError("Invalid signature recovery point order")
    z = int.from_bytes(personal_sign_hash(message), "big") % _N
    inv_r = _inv(r, _N)
    q = _mul(inv_r, _add(_mul(s, point_r), _mul((-z) % _N, _G)))
    if q is None: raise ValueError("Could not recover signature signer")
    return address_from_public_key(q[0], q[1]).lower()


def _b64(data: bytes) -> str:
    return base64.urlsafe_b64encode(data).decode().rstrip("=")


def app_secret_ready() -> bool:
    secret = config.APP_SECRET
    return len(secret) >= 32 and secret not in {
        "dev-only-change-this-secret-before-deploying",
        "replace-with-a-long-random-secret-before-use",
    }


def issue_token(address: str) -> str:
    if not app_secret_ready():
        raise ValueError("APP_SECRET must be a random secret of at least 32 characters")
    payload = _b64(json.dumps({"sub": address.lower(), "exp": int(time.time()) + config.SESSION_TTL_SECONDS,
                                "jti": secrets.token_hex(8)}, separators=(",", ":")).encode())
    sig = _b64(hmac.new(config.APP_SECRET.encode(), payload.encode(), hashlib.sha256).digest())
    return f"{payload}.{sig}"


def require_wallet(authorization: str | None = Header(default=None)) -> str:
    if not app_secret_ready():
        raise HTTPException(503, "Set APP_SECRET to a random secret of at least 32 characters before authenticating a wallet.")
    if not authorization or not authorization.startswith("Bearer "):
        raise HTTPException(401, "Wallet session required. Connect and sign in with MetaMask.")
    try:
        payload, signature = authorization[7:].split(".", 1)
        expected = _b64(hmac.new(config.APP_SECRET.encode(), payload.encode(), hashlib.sha256).digest())
        if not hmac.compare_digest(signature, expected): raise ValueError("signature")
        data = json.loads(base64.urlsafe_b64decode(payload + "=" * (-len(payload) % 4)))
        if int(data.get("exp", 0)) < int(time.time()) or not valid_address(data.get("sub", "")):
            raise ValueError("expired")
        return data["sub"].lower()
    except Exception as exc:
        raise HTTPException(401, "Wallet session is invalid or expired. Reconnect MetaMask.") from exc
