# Agent Vault — policy-gated Sepolia demo

A full-stack prototype for **Agent Vault**, an AI-assisted EVM wallet with a responsive dark dashboard and policy-gated execution workflow. The app builds a native ETH transfer proposal, independently enforces backend policies, simulates it on Ethereum Sepolia, asks MetaMask to sign/broadcast the exact transfer, and verifies the resulting transaction and receipt against a configured Sepolia RPC. No private key is sent to or stored by this application.

> **Important:** this is a testnet hackathon prototype, not a production wallet/security product. The API server cannot stop a user from opening MetaMask and manually sending a different transaction outside this app. It controls only the app's own workflow. Do not use mainnet funds.

## Features implemented

- Responsive React + TypeScript dashboard, proposal inspector, policy view and searchable per-wallet audit table.
- MetaMask wallet connection, Sepolia network switch, and EIP-191 signed challenge for backend session authentication.
- Read-only live native Sepolia ETH balance from MetaMask's EIP-1193 provider.
- Optional Claude Messages API integration for explanatory text. The model does **not** choose or mutate sender, recipient, amount, network or policy. If no API key is configured or the API errors, the UI labels a deterministic local fallback.
- FastAPI backend with SQLite persistence for one-time challenges, proposals, approval intents and audit records.
- Server-side recipient allowlist, per-transaction cap, rolling 24-hour spend cap, trusted `eth_call`, gas estimate, balance and maximum-fee checks. Transaction preparation fails closed if trusted RPC simulation is unavailable or policy fails.
- Sepolia-only transaction preparation, expiring proposal/approval intent, one intent per proposal, sender/recipient/value/calldata/gas/fee matching, replay/hash collision checks, and mined receipt verification.
- Mainnet chain ID is not configurable; every server RPC request verifies that the RPC reports Sepolia (11155111).
- Tests for exact ETH precision, fail-closed policy, simulation, single-use wallet challenge and duplicate intent rejection.

## 1. Prerequisites

- Python 3.11 or newer (Python 3.12 recommended)
- Node.js 20 or newer (Node 22 recommended)
- MetaMask browser extension
- A Sepolia RPC URL from a provider you trust
- A Sepolia-funded test account and a Sepolia recipient address
- Optional Anthropic API key if you want live Claude-generated explanations

## 2. Configure environment

From the project root:

```bash
cp .env.example .env
```

Edit `.env`:

1. Set `SEPOLIA_RPC_URL` to your trusted Sepolia RPC endpoint. The example uses a public community endpoint which may rate-limit or change availability.
2. Replace `APP_SECRET` with a random value, for example `python -c "import secrets; print(secrets.token_urlsafe(48))"`.
3. Set `ALLOWED_RECIPIENTS` to a comma-separated list of recipient addresses you want this demo to permit. The address in `.env.example` is only a placeholder; replace it. An empty allowlist blocks all sends unless `ALLOW_ANY_RECIPIENT=true`, which is discouraged.
4. Optionally add `ANTHROPIC_API_KEY`. The API key is backend-only. The default model is configured as `claude-sonnet-5-5`; change `ANTHROPIC_MODEL` if your account uses another available model.
5. Keep `ALLOW_ANY_RECIPIENT=false`.

Never commit `.env` or put backend secrets into `frontend/.env` or a `VITE_*` variable.

## 3A. Run locally

Terminal 1 — backend:

```bash
cd backend
python -m venv .venv
# Windows: .venv\Scripts\activate
source .venv/bin/activate
pip install -r requirements.txt
uvicorn app.main:app --reload --port 8000
```

Terminal 2 — frontend:

```bash
cd frontend
npm install
npm run dev
```

Open http://localhost:5173. The backend docs are at http://localhost:8000/docs and health status at http://localhost:8000/health.

## 3B. Run with Docker

Make sure `.env` exists, then from the project root:

```bash
docker compose up --build
```

Open http://localhost:8080. The API is at http://localhost:8000. SQLite database contents persist in the `agent-wallet-data` named volume.

## 4. Demo flow

1. Open MetaMask and select an account with Sepolia test ETH.
2. Connect wallet. MetaMask asks for a message signature used only to authenticate the app session; it is not a transaction approval.
3. Open **AI Agent**. Enter the recipient address, a small amount below the configured cap, and the purpose. The recipient must be in the backend allowlist.
4. Generate the proposal. Review all server-side policy checks and the trusted RPC simulation. A failed or unavailable check blocks execution.
5. Click **Review & approve in MetaMask**. The backend independently revalidates, creates a one-time short-lived intent, and returns an exact native ETH transfer. Inspect recipient, amount, network and fee in MetaMask before approving.
6. The app submits the transaction hash to the backend. The backend fetches it from the configured Sepolia RPC and verifies sender, recipient, value, empty calldata, gas/fee bounds and mined receipt before marking it confirmed.
7. Use **Audit log** to search for blocked checks, proposals, intent issuance and receipt verification. The transaction hash links to Sepolia Etherscan.

For the hackathon demo, show at least: (a) a valid allowlisted transfer succeeds, (b) an amount above `MAX_TX_ETH` is rejected, (c) a non-allowlisted recipient is blocked, and (d) replaying the same proposal/intent is rejected.

## 5. Run tests and build

Backend tests:

```bash
cd backend
python -m pytest -q
```

Frontend production build:

```bash
cd frontend
npm run build
```

## Security model and limitations

- The LLM supplies explanatory language only. Deterministic server code builds the transaction fields and applies the policy.
- All value transfer signing and broadcasting is done through the user's MetaMask wallet. The backend does not hold signing keys.
- The API verifies the transaction and receipt against its configured Sepolia RPC, but this is not a multi-provider, consensus-level verification system; a compromised RPC provider could misreport data.
- Transaction matching occurs after MetaMask broadcasts. If a user manually alters transaction fields in the wallet confirmation UI, the server detects a mismatch when it can query the chain, but it cannot reverse an already broadcast transfer. Always inspect the MetaMask confirmation itself.
- Prepared/submitted transactions reserve their amount against the rolling 24-hour cap. If a user rejects the MetaMask prompt after preparation, the conservative reservation can remain until it ages out of the 24-hour window; create a new proposal only after reviewing the policy state.
- `ALLOWED_RECIPIENTS` and caps are server environment configuration. This demo has no admin UI to change them and no production-grade multi-user tenant/admin system.
- The only supported transaction is a native ETH transfer with empty calldata. ERC-20 token transfers, swaps, smart accounts, account abstraction, multisig/guardian approvals, portfolio price valuation and arbitrary contract calls are not implemented.
- The app reads native balance, but does not discover token balances or calculate fiat portfolio value.
- Claude is optional and is not required for policy enforcement; if it is not configured the local fallback works, and the interface indicates this.
- SQLite is suitable for a local prototype only. Before production, use an authenticated database, HTTPS, deployment-specific secret management, rate limiting, abuse controls, monitoring, migrations, and independent security review.
- Mainnet execution is intentionally not implemented. Do not extend this demo to mainnet without a threat model, transaction policy audit and security review.

## Important verification note

The original scaffold ZIP and a previous full-stack ZIP were referenced in the conversation, but the archive bytes could not be accessed in the execution environment during this task. This package is therefore a best-effort runnable reconstruction from the known Agent Vault flow and API route names, **not a verified archive-to-archive merge**. It preserves the identified FastAPI route conventions (`/health`, `/v1/agent/plan`, `/v1/transactions/validate`, `/v1/audit`) but any project-specific logic that only existed inside those unavailable archives could not be compared or preserved. Please merge any missing domain-specific code manually if it appears when you open the original ZIP.
