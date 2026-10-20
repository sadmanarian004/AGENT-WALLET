<div align="center">

# 🛡️ AGENT VAULT
### Enterprise-Grade Autonomous On-Chain AI Wallet Engine

[![Status](https://img.shields.io/badge/Status-Live%20%26%20Operational-success?style=for-the-badge&logo=statuspage)](https://agent-wallet-xi.vercel.app)
[![Network](https://img.shields.io/badge/Network-Ethereum%20Sepolia%20(11155111)-blue?style=for-the-badge&logo=ethereum)](https://sepolia.etherscan.io)
[![License](https://img.shields.io/badge/License-MIT-green?style=for-the-badge)](./LICENSE)
[![Python](https://img.shields.io/badge/Backend-FastAPI%20%7C%20Web3.py-0052CC?style=for-the-badge&logo=python&logoColor=white)](https://fastapi.tiangolo.com/)
[![React](https://img.shields.io/badge/Frontend-React%2018%20%7C%20Vite-61DAFB?style=for-the-badge&logo=react&logoColor=black)](https://react.dev/)

**2026 Shenzhen International FinTech Competition (FinTechathon) Submission**  
*Track F: Autonomous On-Chain Wallet Agent Infrastructure*

---

</div>

## 📌 Executive Summary

**Agent Vault** is a zero-trust, policy-gated autonomous AI wallet agent framework designed for EVM-compatible blockchains. Standard AI wallets often risk unauthorized execution or prompt injections. Agent Vault solves this by strictly separating **Natural Language Intent Compilation** (LLM) from **Financial Execution**, enforced via deterministic backend risk constraints, EIP-712 structured cryptographic signatures, and real-time execution verification on Ethereum Sepolia.

---

## 🌐 Live Systems & Operational Telemetry

| Component | Provider / Infrastructure | Status | Direct Endpoint Link |
| :--- | :--- | :---: | :--- |
| **Frontend Dashboard** | Vercel Serverless Edge | 🟢 Active | [https://agent-wallet-xi.vercel.app](https://agent-wallet-xi.vercel.app) |
| **Backend API Engine** | Render Distributed Instance | 🟢 Active | [https://agent-wallet-6oou.onrender.com](https://agent-wallet-6oou.onrender.com) |
| **Audit Ledger DB** | Turso libSQL Serverless Edge | 🟢 Active | Encrypted Sync |
| **Sepolia Execution Tx** | Ethereum Sepolia Testnet | 🟢 Verified | [Etherscan Explorer Link](https://sepolia.etherscan.io) |

---

## 🏗️ System Architecture & Execution Flow

```text
               ┌─────────────────────────────────────────────────────────┐
               │              CLIENT LAYER (React / Vite)                │
               │  - MetaMask Web3 Connection (Chain ID: 11155111)       │
               │  - Session Auth via EIP-191 Cryptographic Challenge    │
               └────────────────────────────┬────────────────────────────┘
                                            │ EIP-712 Signature
                                            ▼
               ┌─────────────────────────────────────────────────────────┐
               │        BACKEND GATEWAY & POLICY ENGINE (FastAPI)        │
               │  - Deterministic Policy Evaluation (Single/Daily Cap)  │
               │  - Zero-Knowledge Key Isolation (No Private Key Storage)│
               └──────────────┬───────────────────────────┬──────────────┘
                              │                           │
                   Log Event  │                           │ JSON-RPC Broadcast
                              ▼                           ▼
               ┌────────────────────────┐      ┌─────────────────────────┐
               │ AUDIT LEDGER (Turso)   │      │ ETHEREUM SEPOLIA NET    │
               │ Append-only Logs       │      │ On-Chain Settlement     │
               └────────────────────────┘      └─────────────────────────┘
