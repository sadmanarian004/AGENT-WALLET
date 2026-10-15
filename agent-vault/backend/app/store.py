from __future__ import annotations
import json, sqlite3, time
from contextlib import contextmanager
from pathlib import Path
from typing import Any
from . import config


@contextmanager
def connect():
    path = Path(config.DATABASE_PATH)
    path.parent.mkdir(parents=True, exist_ok=True)
    db = sqlite3.connect(path, timeout=10, isolation_level=None)
    db.row_factory = sqlite3.Row
    try:
        db.execute("PRAGMA foreign_keys=ON")
        db.execute("PRAGMA journal_mode=WAL")
        yield db
    finally:
        db.close()


def init_db() -> None:
    with connect() as db:
        db.executescript("""
        CREATE TABLE IF NOT EXISTS challenges (
            id TEXT PRIMARY KEY, address TEXT NOT NULL, message TEXT NOT NULL, expires_at INTEGER NOT NULL
        );
        CREATE TABLE IF NOT EXISTS proposals (
            id TEXT PRIMARY KEY, owner TEXT NOT NULL, goal TEXT NOT NULL, recipient TEXT NOT NULL,
            amount_wei TEXT NOT NULL, amount_eth TEXT NOT NULL, chain_id INTEGER NOT NULL,
            explanation TEXT NOT NULL, llm_used INTEGER NOT NULL DEFAULT 0, agent_plan_json TEXT NOT NULL DEFAULT '{}',
            simulation_json TEXT NOT NULL, risk_json TEXT NOT NULL,
            created_at INTEGER NOT NULL, expires_at INTEGER NOT NULL, status TEXT NOT NULL,
            intent_id TEXT, intent_expires_at INTEGER, tx_hash TEXT UNIQUE, receipt_json TEXT
        );
        CREATE INDEX IF NOT EXISTS idx_proposals_owner_created ON proposals(owner, created_at DESC);
        CREATE TABLE IF NOT EXISTS audit (
            id INTEGER PRIMARY KEY AUTOINCREMENT, created_at INTEGER NOT NULL, wallet TEXT NOT NULL,
            action TEXT NOT NULL, proposal_id TEXT, status TEXT NOT NULL, message TEXT NOT NULL,
            tx_hash TEXT, details_json TEXT NOT NULL DEFAULT '{}'
        );
        CREATE INDEX IF NOT EXISTS idx_audit_wallet_created ON audit(wallet, created_at DESC);
        """)
        columns = {row["name"] for row in db.execute("PRAGMA table_info(proposals)").fetchall()}
        if "agent_plan_json" not in columns:
            db.execute("ALTER TABLE proposals ADD COLUMN agent_plan_json TEXT NOT NULL DEFAULT '{}'")


def add_audit(db: sqlite3.Connection, wallet: str, action: str, status: str, message: str,
              proposal_id: str | None = None, tx_hash: str | None = None, details: dict[str, Any] | None = None) -> None:
    db.execute("INSERT INTO audit(created_at,wallet,action,proposal_id,status,message,tx_hash,details_json) VALUES(?,?,?,?,?,?,?,?)",
               (int(time.time()), wallet.lower(), action, proposal_id, status, message, tx_hash,
                json.dumps(details or {}, separators=(",", ":"))))


def get_proposal(proposal_id: str) -> dict[str, Any] | None:
    with connect() as db:
        row = db.execute("SELECT * FROM proposals WHERE id=?", (proposal_id,)).fetchone()
        return dict(row) if row else None


def parse_proposal(row: dict[str, Any]) -> dict[str, Any]:
    for name in ("simulation_json", "risk_json", "receipt_json", "agent_plan_json"):
        key = name.removesuffix("_json")
        raw = row.pop(name)
        if not raw:
            row[key] = None if key == "receipt" else ([] if key == "risk" else {})
        else:
            row[key] = json.loads(raw)
    row["llm_used"] = bool(row["llm_used"])
    return row
