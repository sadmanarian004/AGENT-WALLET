from __future__ import annotations
import os
from decimal import Decimal
from dotenv import load_dotenv

from pathlib import Path

load_dotenv(Path(__file__).resolve().parents[1] / ".env")
TURSO_DATABASE_URL = os.getenv("TURSO_DATABASE_URL", "").strip()
TURSO_AUTH_TOKEN = os.getenv("TURSO_AUTH_TOKEN", "").strip()
APP_NAME = "Agent Vault API"
CHAIN_ID = 11155111  # Sepolia; deliberately hard-coded for this demo.
CHAIN_NAME = "Sepolia"
RPC_URL = os.getenv("SEPOLIA_RPC_URL", "").strip()
DATABASE_PATH = os.getenv("DATABASE_PATH", "./agent_wallet.sqlite3")
APP_SECRET = os.getenv("APP_SECRET", "dev-only-change-this-secret-before-deploying")
ANTHROPIC_API_KEY = os.getenv("ANTHROPIC_API_KEY", "").strip()
ANTHROPIC_MODEL = os.getenv("ANTHROPIC_MODEL", "claude-sonnet-5-5").strip()
ALLOWED_RECIPIENTS = {x.strip().lower() for x in os.getenv("ALLOWED_RECIPIENTS", "").split(",") if x.strip()}
ALLOW_ANY_RECIPIENT = os.getenv("ALLOW_ANY_RECIPIENT", "false").lower() in {"1", "true", "yes"}
MAX_TX_ETH = Decimal(os.getenv("MAX_TX_ETH", "0.02"))
DAILY_LIMIT_ETH = Decimal(os.getenv("DAILY_LIMIT_ETH", "0.05"))
MAX_FEE_ETH = Decimal(os.getenv("MAX_FEE_ETH", "0.001"))
MAX_GAS_LIMIT = int(os.getenv("MAX_GAS_LIMIT", "50000"))
PROPOSAL_TTL_SECONDS = int(os.getenv("PROPOSAL_TTL_SECONDS", "300"))
SESSION_TTL_SECONDS = int(os.getenv("SESSION_TTL_SECONDS", "28800"))
CORS_ORIGINS = [x.strip() for x in os.getenv("CORS_ORIGINS", "http://localhost:5173,http://127.0.0.1:5173,http://localhost:8080").split(",") if x.strip()]
