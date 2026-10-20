import { useCallback, useEffect, useMemo, useState } from 'react'
import type { FormEvent } from 'react'
import {
  ArrowUpRight,
  LockKeyhole, RefreshCw,
  Search, Sparkles, Wallet, User,
} from 'lucide-react'
import Sidebar from './components/Sidebar'

type CheckItem = { name: string; status: 'pass' | 'block' | 'warn'; detail: string }
type Simulation = { ok: boolean; reason: string; gas_estimate?: number; max_gas_limit?: number; gas_price_wei?: string; max_fee_per_gas_wei?: string; max_fee_wei?: string; sender_balance_wei?: string; checks?: string[] }
type Receipt = { transaction_hash: string; block_number: number; status: string; gas_used: number; effective_gas_price_wei: string; to: string; from: string; value_wei: string; chain_id: number }
type AgentPlan = { summary: string; steps: { title: string; detail: string }[] }
type Proposal = { id: string; owner: string; goal: string; recipient: string; amount_eth: string; chain_id: number; explanation: string; llm_used: boolean; agent_plan?: AgentPlan; simulation: Simulation; risk: CheckItem[]; created_at: number; expires_at: number; status: string; receipt?: Receipt }
type Policy = { chain_id: number; chain_name: string; max_transaction_eth: string; daily_limit_eth: string; max_fee_eth: string; max_gas_limit: number; allow_any_recipient: boolean; allowlist_count: number; rpc_configured: boolean; llm_configured: boolean; mainnet_enabled: boolean; auth_secret_configured: boolean; signing: string }
type Audit = { id: number; created_at: number; action: string; proposal_id?: string; status: string; message: string; tx_hash?: string; details: Record<string, unknown> }
type Session = { token: string; address: string }
type Page = 'overview' | 'agent' | 'controls' | 'audit'

const API = (import.meta.env.VITE_API_URL || 'http://localhost:8000').replace(/\/$/, '')
const SEPOLIA_ID = '0xaa36a7'
const WEI = 10n ** 18n

function shortAddress(value?: string) { return value ? `${value.slice(0, 6)}…${value.slice(-4)}` : '' }
function formatEth(wei?: string | bigint) {
  if (wei === undefined) return '—'
  const n = typeof wei === 'bigint' ? wei : BigInt(wei)
  const whole = n / WEI
  const fraction = (n % WEI).toString().padStart(18, '0').slice(0, 5).replace(/0+$/, '')
  return `${whole}${fraction ? `.${fraction}` : ''}`
}
function hexNumber(v: number | bigint) { return `0x${BigInt(v).toString(16)}` }
function hexText(s: string) { return `0x${Array.from(new TextEncoder().encode(s)).map(x => x.toString(16).padStart(2, '0')).join('')}` }
function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.message
  if (typeof error === 'string') return error
  return 'Something went wrong. Check the connection and try again.'
}

async function request<T>(path: string, token?: string, body?: unknown, options?: { method?: string; query?: string }): Promise<T> {
  const response = await fetch(`${API}${path}${options?.query || ''}`, {
    method: options?.method || (body === undefined ? 'GET' : 'POST'),
    headers: { ...(body === undefined ? {} : { 'Content-Type': 'application/json' }), ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  const data = await response.json().catch(() => ({}))
  if (!response.ok && response.status !== 202) {
    const detail = (data as { detail?: any })?.detail
    if (typeof detail === 'string') throw new Error(detail)
    if (detail?.message) throw new Error(`${detail.message}${detail.checks ? ` ${(detail.checks as CheckItem[]).filter(x => x.status === 'block').map(x => x.detail).join(' ')}` : ''}`)
    throw new Error(`Request failed (${response.status}).`)
  }
  return { ...(data as object), _httpStatus: response.status } as unknown as T
}

async function ensureSepolia() {
  if (!window.ethereum) throw new Error('MetaMask was not detected. Install or enable the MetaMask browser extension.')
  let chain = String(await window.ethereum.request({ method: 'eth_chainId' })).toLowerCase()
  if (chain !== SEPOLIA_ID) {
    try {
      await window.ethereum.request({ method: 'wallet_switchEthereumChain', params: [{ chainId: SEPOLIA_ID }] })
    } catch (e: unknown) {
      const err = e as { code?: number }
      if (err?.code !== 4902) throw e
      await window.ethereum.request({ method: 'wallet_addEthereumChain', params: [{
        chainId: SEPOLIA_ID, chainName: 'Sepolia', nativeCurrency: { name: 'Sepolia Ether', symbol: 'ETH', decimals: 18 },
        rpcUrls: ['https://ethereum-sepolia-rpc.publicnode.com'], blockExplorerUrls: ['https://sepolia.etherscan.io'],
      }] })
    }
    chain = String(await window.ethereum.request({ method: 'eth_chainId' })).toLowerCase()
  }
  if (chain !== SEPOLIA_ID) throw new Error('Switch MetaMask to Sepolia before continuing. Mainnet is disabled in this app.')
}

export default function App() {
  const [session, setSession] = useState<Session | null>(null)
  const [page, setPage] = useState<Page>('overview')
  const [balance, setBalance] = useState<string>('—')
  const [clock, setClock] = useState(() => Date.now() / 1000)
  const [policy, setPolicy] = useState<Policy | null>(null)
  const [proposal, setProposal] = useState<Proposal | null>(null)
  const [audits, setAudits] = useState<Audit[]>([])
  const [goal, setGoal] = useState('Send test ETH to a recipient for a small transfer test.')
  const [recipient, setRecipient] = useState('')
  const [amount, setAmount] = useState('0.005')
  const [busy, setBusy] = useState(false)
  const [busyLabel, setBusyLabel] = useState('')
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')

  const address = session?.address || ''
  const connected = Boolean(session?.token && address)
  const isEligible = useMemo(() => Boolean(proposal && proposal.risk.length && proposal.risk.every(c => c.status === 'pass') && proposal.simulation?.ok && proposal.expires_at > clock), [proposal, clock])

  const refreshPolicy = useCallback(async () => {
    const data = await request<Policy>('/v1/policy')
    setPolicy(data)
  }, [])

  const refreshBalance = useCallback(async (addr = address) => {
    if (!window.ethereum || !addr) return
    const chainId = String(await window.ethereum.request({ method: 'eth_chainId' })).toLowerCase()
    if (chainId !== SEPOLIA_ID) { setBalance('—'); return }
    const result = await window.ethereum.request({ method: 'eth_getBalance', params: [addr, 'latest'] })
    setBalance(formatEth(BigInt(result as string)))
  }, [address])

  const refreshAudit = useCallback(async (q = '') => {
    if (!session?.token) return
    try {
      const query = q.trim() ? `?q=${encodeURIComponent(q.trim())}&limit=150` : '?limit=150'
      const data = await request<{ items: Audit[] }>('/v1/audit', session.token, undefined, { query })
      setAudits(data.items || [])
    } catch (e) { setError(errorMessage(e)) }
  }, [session?.token])

  useEffect(() => {
    const timer = window.setInterval(() => setClock(Date.now() / 1000), 1000)
    return () => window.clearInterval(timer)
  }, [])
  useEffect(() => { refreshPolicy().catch(() => setPolicy(null)) }, [refreshPolicy])
  useEffect(() => {
    const raw = sessionStorage.getItem('agent-vault-session') || sessionStorage.getItem('agent-wallet-session')
    if (!raw || !window.ethereum) return
    try {
      const saved = JSON.parse(raw) as Session
      window.ethereum.request({ method: 'eth_accounts' }).then((accounts: unknown) => {
        const accs = accounts as string[]
        if (accs?.[0]?.toLowerCase() === saved.address.toLowerCase()) setSession(saved)
      }).catch(() => {})
    } catch { sessionStorage.removeItem('agent-vault-session'); sessionStorage.removeItem('agent-wallet-session') }
  }, [])
  useEffect(() => {
    if (session) {
      sessionStorage.setItem('agent-vault-session', JSON.stringify(session))
    } else {
      sessionStorage.removeItem('agent-vault-session')
    }
  }, [session])
  useEffect(() => {
    if (!connected) { setBalance('—'); setAudits([]); return }
    refreshBalance().catch(e => setError(errorMessage(e)))
    refreshAudit('').catch(() => {})
  }, [connected, refreshBalance, refreshAudit])

  async function connectWallet() {
    setError(''); setNotice(''); setBusy(true); setBusyLabel('Connect and authenticate via JWT…')
    try {
      if (!window.ethereum) throw new Error('MetaMask was not detected. Install or enable the MetaMask browser extension.')
      await ensureSepolia()
      const accounts = await window.ethereum.request({ method: 'eth_requestAccounts' }) as string[]
      const addr = accounts?.[0]?.toLowerCase()
      if (!addr) throw new Error('No account was selected in MetaMask.')
      const challenge = await request<{ challenge_id: string; message: string }>('/v1/auth/challenge', undefined, { address: addr })
      const signature = await window.ethereum.request({ method: 'personal_sign', params: [hexText(challenge.message), addr] }) as string
      const auth = await request<{ access_token: string; wallet: string }>('/v1/auth/verify', undefined, { challenge_id: challenge.challenge_id, address: addr, signature })
      setSession({ token: auth.access_token, address: auth.wallet }); setNotice('JWT Authentication successful. Secure session established.')
      await refreshPolicy(); await refreshBalance(addr)
    } catch (e) { setError(errorMessage(e)) } finally { setBusy(false); setBusyLabel('') }
  }

  function disconnect() { setSession(null); setProposal(null); setNotice('Wallet session cleared.') }

  async function createProposal(e: FormEvent) {
    e.preventDefault(); setError(''); setNotice(''); setBusy(true); setBusyLabel('Building proposal…'); setProposal(null)
    try {
      if (!session) throw new Error('Connect MetaMask before proposing a transaction.')
      await ensureSepolia()
      const data = await request<{ proposal: Proposal; eligible: boolean; message: string }>('/v1/agent/plan', session.token, { goal: goal.trim(), recipient: recipient.trim(), amount_eth: amount.trim() })
      setProposal(data.proposal); setNotice(data.message)
      await refreshAudit('')
    } catch (e) { setError(errorMessage(e)) } finally { setBusy(false); setBusyLabel('') }
  }

  async function approveAndSend() {
    if (!session || !proposal || !window.ethereum) return
    setError(''); setNotice(''); setBusy(true); setBusyLabel('Preparing one-time approval…')
    try {
      await ensureSepolia()
      const validation = await request<{ eligible: boolean; checks: CheckItem[]; simulation: Simulation }>('/v1/transactions/validate', session.token, { proposal_id: proposal.id, chain_id: 11155111 })
      const refreshed = { ...proposal, risk: validation.checks, simulation: validation.simulation }
      setProposal(refreshed)
      if (!validation.eligible || !validation.simulation.ok) throw new Error('Server blocked this transaction.')
      const prepared = await request<{ intent_id: string; transaction: { from: string; to: string; value_wei: string; data: string; gas_limit: number; max_fee_per_gas_wei: string }; message: string }>('/v1/transactions/prepare', session.token, { proposal_id: proposal.id, chain_id: 11155111 })
      setProposal(p => p ? { ...p, status: 'prepared' } : p)
      const tx = prepared.transaction
      const hash = await window.ethereum.request({ method: 'eth_sendTransaction', params: [{
        from: tx.from, to: tx.to, value: hexNumber(BigInt(tx.value_wei)), data: tx.data,
        gas: hexNumber(tx.gas_limit), maxFeePerGas: hexNumber(BigInt(tx.max_fee_per_gas_wei)),
        maxPriorityFeePerGas: hexNumber(BigInt(tx.max_fee_per_gas_wei) / 4n > 0n ? BigInt(tx.max_fee_per_gas_wei) / 4n : 1n),
      }] }) as string
      setNotice(`Transaction submitted (${shortAddress(hash)}).`)
      await refreshBalance(session.address).catch(() => {})
      await refreshAudit('').catch(() => {})
    } catch (e) { setError(errorMessage(e)) } finally { setBusy(false); setBusyLabel('') }
  }

  return (
    <div style={{ background: '#000', color: '#fff', display: 'flex', minHeight: '100vh', fontFamily: 'system-ui, sans-serif' }}>
      <Sidebar activeTab={page} setActiveTab={(tab) => { setPage(tab); setError(''); }} onLogout={disconnect} />

      <main style={{ flex: 1, marginLeft: '96px', padding: '32px', maxWidth: '1440px' }}>
        <header style={{ display: 'flex', justifyContent: 'flex-end', alignItems: 'center', marginBottom: '32px', gap: '16px' }}>
          <div style={{ position: 'relative', width: '320px', marginRight: 'auto' }}>
            <Search size={18} style={{ position: 'absolute', left: '16px', top: '14px', color: '#9ca3af' }} />
            <input 
              type="text" 
              placeholder="Search..." 
              style={{ width: '100%', background: '#121212', border: '1px solid #222', borderRadius: '9999px', padding: '12px 16px 12px 48px', color: '#fff', outline: 'none' }} 
            />
          </div>
          <div style={{ width: '52px', height: '52px', background: '#fff', color: '#000', borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', boxShadow: '0 4px 12px rgba(0,0,0,0.3)' }}>
            <User size={22} />
          </div>
          <div style={{ width: '52px', height: '52px', background: '#fff', color: '#000', borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', boxShadow: '0 4px 12px rgba(0,0,0,0.3)' }}>
            <Wallet size={22} />
          </div>
          {!connected && (
            <button onClick={connectWallet} disabled={busy} style={{ background: '#059669', color: '#fff', border: 'none', padding: '14px 28px', borderRadius: '20px', fontWeight: 'bold', cursor: 'pointer', boxShadow: '0 4px 12px rgba(5,150,105,0.4)' }}>
              {busy ? (busyLabel || 'Connecting...') : 'Connect & Login (JWT)'}
            </button>
          )}
          {connected && (
            <div style={{ background: 'rgba(16, 185, 129, 0.15)', border: '1px solid rgba(16, 185, 129, 0.4)', padding: '12px 20px', borderRadius: '18px', fontSize: '13px', color: '#34d399', fontWeight: 'bold' }}>
              {shortAddress(address)} (JWT Active)
            </div>
          )}
        </header>

        <div>
          {error && <div style={{ background: 'rgba(239, 68, 68, 0.2)', border: '1px solid #ef4444', padding: '16px', borderRadius: '16px', marginBottom: '20px', color: '#fca5a5' }}>{error}</div>}
          {notice && <div style={{ background: 'rgba(16, 185, 129, 0.2)', border: '1px solid #10b981', padding: '16px', borderRadius: '16px', marginBottom: '20px', color: '#6ee7b7' }}>{notice}</div>}
          
          {page === 'overview' && (
            <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr', gap: '28px' }}>
              <div style={{ 
                background: 'linear-gradient(145deg, #022c22 0%, #064e3b 50%, #09090b 100%)', 
                border: '1px solid rgba(16, 185, 129, 0.35)', 
                borderRadius: '36px', 
                padding: '48px', 
                minHeight: '500px', 
                display: 'flex', 
                flexDirection: 'column', 
                justifyContent: 'space-between',
                position: 'relative',
                overflow: 'hidden',
                boxShadow: '0 20px 40px rgba(0,0,0,0.5)'
              }}>
                <div>
                  <h1 style={{ fontSize: '48px', fontWeight: 900, lineHeight: 1.15, margin: 0, letterSpacing: '-0.02em' }}>
                    Smart <span style={{ color: '#10b981' }}>Finance</span><br />
                    For Modern User
                  </h1>
                </div>

                <div style={{
                  position: 'absolute',
                  right: '40px',
                  bottom: '60px',
                  width: '320px',
                  height: '200px',
                  background: 'linear-gradient(135deg, #1c1c1e 0%, #0c0c0e 100%)',
                  borderRadius: '18px',
                  padding: '24px',
                  boxShadow: '0 20px 40px rgba(0,0,0,0.8), inset 0 1px 0 rgba(255,255,255,0.2)',
                  border: '1px solid rgba(255,255,255,0.1)',
                  transform: 'rotate(-6deg)',
                  display: 'flex',
                  flexDirection: 'column',
                  justifyContent: 'space-between'
                }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <div style={{
                      width: '42px',
                      height: '32px',
                      background: 'linear-gradient(135deg, #d4af37 0%, #aa771c 100%)',
                      borderRadius: '6px',
                      border: '1px solid rgba(255,255,255,0.3)',
                      boxShadow: 'inset 0 1px 2px rgba(0,0,0,0.4)'
                    }} />
                    <div style={{ color: '#e5e7eb', fontSize: '20px', fontWeight: 'bold' }}>✦</div>
                  </div>

                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end' }}>
                    <div style={{ fontFamily: 'monospace', fontSize: '15px', color: '#9ca3af', letterSpacing: '2px' }}>
                      •••• 8492
                    </div>
                    <div style={{ display: 'flex', position: 'relative', width: '36px', height: '22px' }}>
                      <div style={{ width: '22px', height: '22px', borderRadius: '50%', background: '#eb001b', opacity: 0.9 }} />
                      <div style={{ width: '22px', height: '22px', borderRadius: '50%', background: '#f79e1b', opacity: 0.9, position: 'absolute', left: '12px' }} />
                    </div>
                  </div>
                </div>

                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', zIndex: 2 }}>
                  <button onClick={() => setPage('agent')} style={{ background: '#059669', color: '#fff', border: 'none', padding: '16px 32px', borderRadius: '20px', fontWeight: 'bold', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '10px', boxShadow: '0 8px 20px rgba(5,150,105,0.4)' }}>
                    <Sparkles size={18} /> Launch Agent Vault <ArrowUpRight size={18} />
                  </button>

                  <div style={{ background: '#064e3b', border: '1px solid rgba(16, 185, 129, 0.4)', padding: '12px 24px', borderRadius: '20px', display: 'flex', alignItems: 'center', gap: '8px', color: '#34d399', fontWeight: 'bold' }}>
                    <span>⚡</span> AgentVault
                  </div>
                </div>
              </div>

              <div style={{ display: 'flex', flexDirection: 'column', gap: '24px' }}>
                <div style={{ background: 'linear-gradient(180deg, rgba(6, 78, 59, 0.4) 0%, #09090b 100%)', border: '1px solid rgba(16, 185, 129, 0.3)', borderRadius: '36px', padding: '36px', display: 'flex', flexDirection: 'column', justifyContent: 'space-between', flex: 1 }}>
                  <div>
                    <h2 style={{ fontSize: '26px', fontWeight: 'bold', marginBottom: '12px', color: '#34d399' }}>Sepolia Wallet Balance</h2>
                    <p style={{ fontSize: '13px', color: '#9ca3af', lineHeight: 1.6 }}>Sepolia is an Ethereum testnet for testing smart contracts and blockchain apps using test ETH, without risking real funds.</p>
                  </div>
                  <div style={{ margin: '20px 0', background: '#121212', padding: '24px', borderRadius: '24px', border: '1px solid #222' }}>
                    <div style={{ fontSize: '12px', color: '#9ca3af' }}>Connected Balance</div>
                    <div style={{ fontSize: '36px', fontWeight: 900, color: '#10b981', marginTop: '6px' }}>{balance} <span style={{ fontSize: '16px', color: '#fff' }}>ETH</span></div>
                  </div>
                  <button onClick={() => refreshBalance()} style={{ width: '100%', background: '#27272a', color: '#fff', border: 'none', padding: '16px', borderRadius: '20px', fontWeight: 'bold', cursor: 'pointer', transition: 'background 0.2s' }}>
                    Sync Wallet Balance
                  </button>
                </div>
              </div>
            </div>
          )}

          {page === 'agent' && (
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '28px' }}>
              <div style={{ background: 'linear-gradient(135deg, #064e3b 0%, #09090b 100%)', border: '1px solid rgba(16, 185, 129, 0.4)', borderRadius: '36px', padding: '40px', display: 'flex', flexDirection: 'column', justifyContent: 'space-between', minHeight: '480px' }}>
                <div>
                  <span style={{ background: 'rgba(255,255,255,0.1)', color: '#34d399', fontSize: '12px', fontWeight: 'bold', padding: '6px 14px', borderRadius: '9999px' }}>Autonomous Security</span>
                  <h2 style={{ fontSize: '40px', fontWeight: 900, color: '#fff', marginTop: '20px' }}>Ai Transaction <span style={{ color: '#34d399' }}>Agent</span></h2>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: '12px', color: '#34d399', fontSize: '14px', fontWeight: 'bold' }}>
                  <Sparkles size={20} /> Active (JWT Protected)
                </div>
              </div>

              <div style={{ background: '#121212', border: '1px solid #222', padding: '36px', borderRadius: '36px' }}>
                <h3 style={{ fontSize: '22px', fontWeight: 'bold', marginBottom: '16px', color: '#fff' }}>Build a Transaction</h3>
                <form onSubmit={createProposal} style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
                  <textarea value={goal} onChange={e => setGoal(e.target.value)} rows={2} style={{ width: '100%', background: '#000', border: '1px solid #333', borderRadius: '16px', padding: '16px', color: '#fff', outline: 'none' }} required />
                  <input type="text" value={recipient} onChange={e => setRecipient(e.target.value)} placeholder="0x..." style={{ width: '100%', background: '#000', border: '1px solid #333', borderRadius: '16px', padding: '16px', color: '#fff', outline: 'none' }} required />
                  <input type="number" step="0.0001" value={amount} onChange={e => setAmount(e.target.value)} style={{ width: '100%', background: '#000', border: '1px solid #333', borderRadius: '16px', padding: '16px', color: '#fff', outline: 'none' }} required />
                  <button type="submit" disabled={!connected || busy} style={{ background: '#059669', color: '#fff', border: 'none', padding: '16px', borderRadius: '16px', fontWeight: 'bold', cursor: 'pointer' }}>
                    {busy ? (busyLabel || 'Processing...') : 'Generate & Check Proposal'}
                  </button>
                </form>
                {proposal && (
                  <div style={{ marginTop: '20px', padding: '20px', background: '#000', borderRadius: '20px', border: '1px solid #333' }}>
                    <p style={{ fontSize: '13px', color: '#d1d5db', marginBottom: '12px' }}>{proposal.explanation}</p>
                    <button onClick={approveAndSend} disabled={!isEligible || busy} style={{ width: '100%', background: '#2563eb', color: '#fff', border: 'none', padding: '14px', borderRadius: '14px', fontWeight: 'bold', cursor: 'pointer' }}>
                      Approve & Sign in MetaMask
                    </button>
                  </div>
                )}
              </div>
            </div>
          )}

          {page === 'controls' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '28px' }}>
              <div style={{ background: 'linear-gradient(135deg, #064e3b 0%, #111827 100%)', border: '1px solid rgba(16, 185, 129, 0.4)', borderRadius: '36px', padding: '40px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <div>
                  <h2 style={{ fontSize: '36px', fontWeight: 900, color: '#fff' }}>Risk Controls & Spending Limit</h2>
                  <p style={{ fontSize: '14px', color: '#9ca3af', marginTop: '6px' }}>Automated safety bounds</p>
                </div>
                <LockKeyhole size={36} style={{ color: '#34d399' }} />
              </div>
              <div style={{ background: '#121212', border: '1px solid #222', padding: '36px', borderRadius: '36px', display: 'flex', flexDirection: 'column', gap: '16px' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', padding: '20px', background: '#000', borderRadius: '20px', border: '1px solid #222' }}>
                  <span style={{ fontSize: '15px', color: '#9ca3af' }}>Max Tx Limit</span>
                  <strong style={{ color: '#10b981', fontSize: '16px' }}>{policy?.max_transaction_eth ?? '—'} ETH</strong>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', padding: '20px', background: '#000', borderRadius: '20px', border: '1px solid #222' }}>
                  <span style={{ fontSize: '15px', color: '#9ca3af' }}>Daily Spend Limit</span>
                  <strong style={{ color: '#10b981', fontSize: '16px' }}>{policy?.daily_limit_eth ?? '—'} ETH</strong>
                </div>
              </div>
            </div>
          )}

          {page === 'audit' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '28px' }}>
              <div style={{ background: 'linear-gradient(135deg, #064e3b 0%, #09090b 100%)', border: '1px solid rgba(16, 185, 129, 0.4)', borderRadius: '36px', padding: '40px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <div>
                  <h2 style={{ fontSize: '36px', fontWeight: 900, color: '#fff' }}>Forensic Audit Log</h2>
                  <p style={{ fontSize: '14px', color: '#9ca3af', marginTop: '6px' }}>Server-generated records (JWT Secured)</p>
                </div>
                <button onClick={() => refreshAudit()} style={{ background: '#059669', color: '#fff', border: 'none', padding: '14px 24px', borderRadius: '16px', fontWeight: 'bold', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <RefreshCw size={16}/> Refresh
                </button>
              </div>
              <div style={{ background: '#121212', border: '1px solid rgba(16, 185, 129, 0.2)', padding: '36px', borderRadius: '36px' }}>
                {audits.length === 0 ? (
                  <div style={{ textAlign: 'center', color: '#9ca3af', padding: '24px' }}>No audit records.</div>
                ) : (
                  audits.map(item => (
                    <div key={item.id} style={{ background: '#000', padding: '20px', borderRadius: '20px', border: '1px solid #222', display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px' }}>
                      <div>
                        <strong style={{ fontSize: '15px' }}>{item.action}</strong>
                        <div style={{ fontSize: '13px', color: '#9ca3af', marginTop: '4px' }}>{item.message}</div>
                      </div>
                      <span style={{ color: item.status === 'pass' ? '#34d399' : '#f87171', fontWeight: 'bold' }}>{item.status.toUpperCase()}</span>
                    </div>
                  ))
                )}
              </div>
            </div>
          )}
        </div>
      </main>
    </div>
  )
}