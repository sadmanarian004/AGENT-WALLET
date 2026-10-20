

Here is the **entire, single block**. Click the **Copy** button in the top-right corner of the code block below, paste it straight into your GitHub `README.md` editor, and click **Commit changes**:

```markdown
<div align="center">


```

█████╗  ██████╗ ███████╗███╗   ██╗████████╗    ██╗   ██╗█████╗ ██╗   ██╗██╗  ██╗████████╗
██╔══██╗██╔════╝ ██╔════╝████╗  ██║╚══██╔══╝    ██║   ██║██╔══██╗██║   ██║██║  ██║╚══██╔══╝
███████║██║  ███╗█████╗  ██╔██╗ ██║   ██║       ██║   ██║███████║██║   ██║███████║   ██║

██╔══██║██║   ██║██╔══╝  ██║╚██╗██║   ██║       ╚██╗ ██╔╝██╔══██║██║   ██║██╔══██║   ██║

██║  ██║╚██████╔╝███████╗██║ ╚████║   ██║        ╚████╔╝ ██║  ██║╚██████╔╝██║  ██║   ██║

╚═╝  ╚═╝ ╚═════╝ ╚══════╝╚═╝  ╚═══╝   ╚═╝         ╚═══╝  ╚═╝  ╚═╝ ╚═════╝ ╚═╝  ╚═╝   ╚═╝

```

### ⚡ Zero-Trust Autonomous On-Chain AI Wallet Architecture

[![Status](https://img.shields.io/badge/System_Status-Live_%26_Operational-00FF66?style=for-the-badge&logo=statuspage&logoColor=black)](https://agent-wallet-xi.vercel.app)
[![Network](https://img.shields.io/badge/Chain-Ethereum_Sepolia-0088FF?style=for-the-badge&logo=ethereum&logoColor=white)](https://sepolia.etherscan.io)
[![Security](https://img.shields.io/badge/Security-EIP--712_Gated-FF0055?style=for-the-badge&logo=shield&logoColor=white)](#-key-security--governance-guarantees)
[![License](https://img.shields.io/badge/License-MIT-yellow?style=for-the-badge)](./LICENSE)

---

**🏆 2026 Shenzhen International FinTech Competition (FinTechathon)**  
*Track F: Autonomous On-Chain Wallet Agent Infrastructure*

[🌐 Live App Gateway](https://agent-wallet-xi.vercel.app) • [⚡ Backend API Engine](https://agent-wallet-6oou.onrender.com) • [📜 Sepolia Etherscan](https://sepolia.etherscan.io)

</div>

---

## 🌟 Visual Overview & Metrics

<div align="center">

| 🔒 **Security Protocol** | ⚡ **Execution Speed** | 📊 **Audit Capability** | 🌐 **Chain Support** |
| :---: | :---: | :---: | :---: |
| **EIP-712 + Policy Gate** | **< 1.2s Latency** | **Turso libSQL Append-Only** | **EVM (Sepolia Testnet)** |

</div>

---

## 🏗️ Interactive System Architecture

```mermaid
graph TD
    %% Nodes
    A[📱 Client Dashboard<br/>React + Vite] -->|1. Session Handshake| B[🔑 MetaMask Wallet<br/>EIP-191 / EIP-712]
    B -->|2. Crypto Signed Intent| C[🛡️ FastAPI Gateway<br/>Policy Engine]
    
    subgraph Core Policy Server
        C -->|3a. Risk Check| D{Deterministic Risk Matrix}
        D -->|Pass| E[📝 Sign Proposal]
        D -->|Fail / Exceed Cap| F[❌ Circuit Breaker Trigger]
        C -->|3b. Log Audit| G[(Turso libSQL Audit DB)]
    end
    
    E -->|4. JSON-RPC Broadcast| H[🌐 Ethereum Sepolia RPC]
    H -->|5. Execution Receipt| C

```

---

## ✨ Core Pillars & Innovation Highlights

```text
┌─────────────────────────────────────────────────────────────────────────┐
│ 🛡️ ZERO-KNOWLEDGE KEY ISOLATION                                         │
│ Private keys never reach the backend server or AI reasoning modules.     │
│ Transactions are constructed as proposals and signed strictly client-side.│
└─────────────────────────────────────────────────────────────────────────┘
┌─────────────────────────────────────────────────────────────────────────┐
│ ⚡ DETERMINISTIC CIRCUIT BREAKER                                        │
│ Natural language AI intent is treated as untrusted input. Backend policy │
│ rules enforce hard value caps before generating EIP-712 payloads.       │
└─────────────────────────────────────────────────────────────────────────┘

```

---

## 📄 Official Competition Submission Dossiers

The formal competition dossiers required by the contest board are available directly in this repository:

* 📄 **`Technical documentation.docx`** — Deep-dive system architecture, threat model, and algorithm designs.
* 📄 **`Source code.docx`** — Directory layout, codebase walk-through, and environment variables.
* 📄 **`Execution evidence.docx`** — On-chain Sepolia hashes, sandbox execution logs, and API status.
* 📄 **`Security self assessment report.docx`** — Permission-tier matrix and vulnerability mitigations.

---

## ⚡ Quick Start & Development Setup

### 1. Backend Service

```bash
cd backend
python -m venv venv
source venv/bin/activate  # On Windows: venv\Scripts\activate
pip install -r requirements.txt

# Launch FastAPI Local Engine
uvicorn backend.app.main:app --host 0.0.0.0 --port 8080 --reload

```

### 2. Frontend Dashboard

```bash
cd ../frontend
npm install
npm run dev

```

---

Designed & Built with ❤️ for the **2026 Shenzhen International FinTech Competition**.
