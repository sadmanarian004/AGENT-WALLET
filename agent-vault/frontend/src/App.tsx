import { useCallback, useEffect, useMemo, useState } from 'react'
import type { FormEvent } from 'react'
import {
  ArrowUpRight, FileClock,
  Gauge, LockKeyhole, LogOut, RefreshCw,
  Search, ShieldCheck, Sparkles, Wallet, User,
} from 'lucide-react'

type CheckItem = { name: string; status: 'pass' | 'block' | 'warn'; detail: string }
type Simulation = { ok: boolean; reason: string; gas_estimate?: number; max_gas_limit?: number; gas_price_wei?: string; max_fee_per_gas_wei?: string; max_fee_wei?: string; sender_balance_wei?: string; checks?: string[] }
type Receipt = { transaction_hash: string; block_number: number; status: string; gas_used: number; effective_gas_price_wei: string; to: string; from: string; value_wei: string; chain_id: number }
type AgentPlan = { summary: string; steps: { title: string; detail: string }[] }
type Proposal = { id: string; owner: string; goal: string; recipient: string; amount_eth: string; chain_id: number; explanation: string; llm_used: boolean; agent_plan?: AgentPlan; simulation: Simulation; risk: CheckItem[]; created_at: number; expires_at: number; status: string; receipt?: Receipt }
type Policy = { chain_id: number; chain_name: string; max_transaction_eth: string; daily_limit_eth: string; max_fee_eth: string; max_gas_limit: number; allow_any_recipient: boolean; allowlist_count: number; rpc_configured: boolean; llm_configured: boolean; mainnet_enabled: boolean; auth_secret_configured: boolean; signing: string }
type Audit = { id: number; created_at: number; action: string; proposal_id?: string; status: string; message: string; tx_hash?: string; details: Record<string, any> }
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
    const detail = data?.detail
    if (typeof detail === 'string') throw new Error(detail)
    if (detail?.message) throw new Error(`${detail.message}${detail.checks ? ` ${detail.checks.filter((x: CheckItem) => x.status === 'block').map((x: CheckItem) => x.detail).join(' ')}` : ''}`)
    throw new Error(`Request failed (${response.status}).`)
  }
  return { ...data, _httpStatus: response.status } as unknown as T
}

async function ensureSepolia() {
  if (!window.ethereum) throw new Error('MetaMask was not detected. Install or enable the MetaMask browser extension.')
  let chain = String(await window.ethereum.request({ method: 'eth_chainId' })).toLowerCase()
  if (chain !== SEPOLIA_ID) {
    try {
      await window.ethereum.request({ method: 'wallet_switchEthereumChain', params: [{ chainId: SEPOLIA_ID }] })
    } catch (e: any) {
      if (e?.code !== 4902) throw e
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
    setBalance(formatEth(BigInt(result)))
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
      window.ethereum.request({ method: 'eth_accounts' }).then((accounts: string[]) => {
        if (accounts?.[0]?.toLowerCase() === saved.address.toLowerCase()) setSession(saved)
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
    setError(''); setNotice(''); setBusy(true); setBusyLabel('Connect and authenticate wallet…')
    try {
      if (!window.ethereum) throw new Error('MetaMask was not detected. Install or enable the MetaMask browser extension.')
      await ensureSepolia()
      const accounts = await window.ethereum.request({ method: 'eth_requestAccounts' }) as string[]
      const addr = accounts?.[0]?.toLowerCase()
      if (!addr) throw new Error('No account was selected in MetaMask.')
      const challenge = await request<{ challenge_id: string; message: string }>('/v1/auth/challenge', undefined, { address: addr })
      const signature = await window.ethereum.request({ method: 'personal_sign', params: [hexText(challenge.message), addr] }) as string
      const auth = await request<{ access_token: string; wallet: string }>('/v1/auth/verify', undefined, { challenge_id: challenge.challenge_id, address: addr, signature })
      setSession({ token: auth.access_token, address: auth.wallet }); setNotice('Wallet authenticated. Transaction signing remains in MetaMask.')
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

  const navItems: { id: Page; label: string; icon: typeof Gauge }[] = [
    { id: 'overview', label: 'Overview', icon: Gauge }, { id: 'agent', label: 'AI Agent', icon: Sparkles },
    { id: 'controls', label: 'Risk controls', icon: ShieldCheck }, { id: 'audit', label: 'Audit log', icon: FileClock },
  ]

  return (
    <div style={{ background: '#000', color: '#fff', display: 'flex', minHeight: '100vh', fontFamily: 'system-ui, sans-serif' }}>
      <aside style={{ width: '96px', background: '#000', borderRight: '1px solid #111', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'space-between', padding: '32px 0', position: 'fixed', height: '100vh', zIndex: 50 }}>
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '24px' }}>
          <div style={{ width: '48px', height: '48px', background: 'rgba(16, 185, 129, 0.1)', borderRadius: '16px', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#10b981', border: '1px solid rgba(16, 185, 129, 0.3)' }}>
            <ShieldCheck size={24}/>
          </div>
          <nav style={{ display: 'flex', flexDirection: 'column', gap: '16px', marginTop: '16px' }}>
            {navItems.map(item => { 
              const Icon = item.icon; 
              const isActive = page === item.id;
              return (
                <button 
                  key={item.id} 
                  onClick={() => { setPage(item.id); setError(''); }}
                  style={{
                    width: '48px', height: '48px', borderRadius: '16px', display: 'flex', alignItems: 'center', justifyContent: 'center',
                    background: isActive ? '#059669' : 'transparent', color: isActive ? '#fff' : '#9ca3af', border: 'none', cursor: 'pointer'
                  }}
                  title={item.label}
                >
                  <Icon size={20}/>
                </button>
              ) 
            })}
          </nav>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '16px' }}>
          <button onClick={disconnect} style={{ width: '48px', height: '48px', borderRadius: '16px', background: 'transparent', border: 'none', color: '#9ca3af', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }} title="Log out">
            <LogOut size={18}/>
          </button>
        </div>
      </aside>

      <main style={{ flex: 1, marginLeft: '96px', padding: '32px', maxWidth: '1400px' }}>
        <header style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '32px' }}>
          <div style={{ position: 'relative', width: '380px' }}>
            <Search size={18} style={{ position: 'absolute', left: '16px', top: '14px', color: '#9ca3af' }} />
            <input 
              type="text" 
              placeholder="Search..." 
              style={{ width: '100%', background: '#121212', border: '1px solid #222', borderRadius: '9999px', padding: '12px 16px 12px 48px', color: '#fff', outline: 'none' }} 
            />
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
            <button style={{ width: '48px', height: '48px', background: '#fff', color: '#000', borderRadius: '50%', border: 'none', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer' }}>
              <User size={20} />
            </button>
            <button style={{ width: '48px', height: '48px', background: '#fff', color: '#000', borderRadius: '50%', border: 'none', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer' }}>
              <Wallet size={20} />
            </button>
            {!connected && (
              <button onClick={connectWallet} disabled={busy} style={{ background: '#059669', color: '#fff', border: 'none', padding: '12px 24px', borderRadius: '16px', fontWeight: 'bold', cursor: 'pointer' }}>
                {busy ? 'Connecting...' : 'Connect Wallet'}
              </button>
            )}
          </div>
        </header>

        <div>
          {error && <div style={{ background: 'rgba(239, 68, 68, 0.2)', border: '1px solid #ef4444', padding: '16px', borderRadius: '16px', marginBottom: '20px', color: '#fca5a5' }}>{error}</div>}
          {notice && <div style={{ background: 'rgba(16, 185, 129, 0.2)', border: '1px solid #10b981', padding: '16px', borderRadius: '16px', marginBottom: '20px', color: '#6ee7b7' }}>{notice}</div>}
          
          {page === 'overview' && (
            <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr', gap: '24px' }}>
              <div style={{ background: 'linear-gradient(135deg, #022c22 0%, #09090b 100%)', border: '1px solid rgba(16, 185, 129, 0.3)', borderRadius: '32px', padding: '48px', minHeight: '420px', display: 'flex', flexDirection: 'column', justifyContent: 'space-between' }}>
                <div>
                  <h1 style={{ fontSize: '48px', fontWeight: 900, lineHeight: 1.1, margin: 0 }}>
                    Smart <span style={{ color: '#10b981' }}>Finance</span><br />
                    For Modern User
                  </h1>
                </div>
                <div>
                  <button onClick={() => setPage('agent')} style={{ background: '#059669', color: '#fff', border: 'none', padding: '14px 28px', borderRadius: '16px', fontWeight: 'bold', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <Sparkles size={18} /> Launch Agent Vault <ArrowUpRight size={18} />
                  </button>
                </div>
              </div>

              <div style={{ background: 'linear-gradient(180deg, rgba(6, 78, 59, 0.4) 0%, #09090b 100%)', border: '1px solid rgba(16, 185, 129, 0.3)', borderRadius: '32px', padding: '32px', display: 'flex', flexDirection: 'column', justifyContent: 'space-between' }}>
                <div>
                  <h2 style={{ fontSize: '28px', fontWeight: 'bold', marginBottom: '12px', color: '#34d399' }}>Sepolia Wallet Balance</h2>
                  <p style={{ fontSize: '13px', color: '#9ca3af', lineHeight: 1.6 }}>Sepolia is an Ethereum testnet for testing smart contracts safely.</p>
                </div>
                <div style={{ margin: '20px 0', background: '#121212', padding: '20px', borderRadius: '20px', border: '1px solid #222' }}>
                  <div style={{ fontSize: '12px', color: '#9ca3af' }}>Connected Balance</div>
                  <div style={{ fontSize: '32px', fontWeight: 900, color: '#10b981', marginTop: '4px' }}>{balance} <span style={{ fontSize: '16px', color: '#fff' }}>ETH</span></div>
                </div>
                <button onClick={() => refreshBalance()} style={{ width: '100%', background: '#27272a', color: '#fff', border: 'none', padding: '14px', borderRadius: '16px', fontWeight: 'bold', cursor: 'pointer' }}>
                  Sync Wallet Balance
                </button>
              </div>
            </div>
          )}

          {page === 'agent' && (
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '24px' }}>
              <div style={{ background: 'linear-gradient(135deg, #064e3b 0%, #09090b 100%)', border: '1px solid rgba(16, 185, 129, 0.4)', borderRadius: '32px', padding: '40px', display: 'flex', flexDirection: 'column', justifyContent: 'space-between', minHeight: '480px' }}>
                <div>
                  <span style={{ background: 'rgba(255,255,255,0.1)', color: '#34d399', fontSize: '12px', fontWeight: 'bold', padding: '6px 14px', borderRadius: '9999px' }}>Autonomous Security</span>
                  <h2 style={{ fontSize: '40px', fontWeight: 900, color: '#fff', marginTop: '20px' }}>Ai Transaction <span style={{ color: '#34d399' }}>Agent</span></h2>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: '12px', color: '#34d399', fontSize: '14px', fontWeight: 'bold' }}>
                  <Sparkles size={20} /> Active
                </div>
              </div>

              <div style={{ background: '#121212', border: '1px solid #222', padding: '32px', borderRadius: '32px' }}>
                <h3 style={{ fontSize: '20px', fontWeight: 'bold', marginBottom: '16px', color: '#fff' }}>Build a Transaction</h3>
                <form onSubmit={createProposal} style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
                  <textarea value={goal} onChange={e => setGoal(e.target.value)} rows={2} style={{ width: '100%', background: '#000', border: '1px solid #333', borderRadius: '14px', padding: '14px', color: '#fff' }} required />
                  <input type="text" value={recipient} onChange={e => setRecipient(e.target.value)} placeholder="0x..." style={{ width: '100%', background: '#000', border: '1px solid #333', borderRadius: '14px', padding: '14px', color: '#fff' }} required />
                  <input type="number" step="0.0001" value={amount} onChange={e => setAmount(e.target.value)} style={{ width: '100%', background: '#000', border: '1px solid #333', borderRadius: '14px', padding: '14px', color: '#fff' }} required />
                  <button type="submit" disabled={!connected || busy} style={{ background: '#059669', color: '#fff', border: 'none', padding: '14px', borderRadius: '14px', fontWeight: 'bold', cursor: 'pointer' }}>
                    {busy ? (busyLabel || 'Processing...') : 'Generate & Check Proposal'}
                  </button>
                </form>
                {proposal && (
                  <div style={{ marginTop: '20px', padding: '16px', background: '#000', borderRadius: '16px', border: '1px solid #333' }}>
                    <p style={{ fontSize: '12px', color: '#d1d5db' }}>{proposal.explanation}</p>
                    <button onClick={approveAndSend} disabled={!isEligible || busy} style={{ width: '100%', background: '#2563eb', color: '#fff', border: 'none', padding: '12px', borderRadius: '10px', fontWeight: 'bold', cursor: 'pointer', marginTop: '10px' }}>
                      Approve & Sign in MetaMask
                    </button>
                  </div>
                )}
              </div>
            </div>
          )}

          {page === 'controls' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '24px' }}>
              <div style={{ background: 'linear-gradient(135deg, #064e3b 0%, #111827 100%)', border: '1px solid rgba(16, 185, 129, 0.4)', borderRadius: '32px', padding: '36px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <div>
                  <h2 style={{ fontSize: '32px', fontWeight: 900, color: '#fff' }}>Risk Controls & Spending Limit</h2>
                  <p style={{ fontSize: '13px', color: '#9ca3af' }}>Automated safety bounds</p>
                </div>
                <LockKeyhole size={32} style={{ color: '#34d399' }} />
              </div>
              <div style={{ background: '#121212', border: '1px solid #222', padding: '32px', borderRadius: '32px' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', padding: '16px', background: '#000', borderRadius: '16px', marginBottom: '12px' }}>
                  <span>Max Tx Limit</span>
                  <strong style={{ color: '#10b981' }}>{policy?.max_transaction_eth ?? '—'} ETH</strong>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', padding: '16px', background: '#000', borderRadius: '16px' }}>
                  <span>Daily Spend Limit</span>
                  <strong style={{ color: '#10b981' }}>{policy?.daily_limit_eth ?? '—'} ETH</strong>
                </div>
              </div>
            </div>
          )}

          {page === 'audit' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '24px' }}>
              <div style={{ background: 'linear-gradient(135deg, #064e3b 0%, #09090b 100%)', border: '1px solid rgba(16, 185, 129, 0.4)', borderRadius: '32px', padding: '36px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <div>
                  <h2 style={{ fontSize: '32px', fontWeight: 900, color: '#fff' }}>Forensic Audit Log</h2>
                  <p style={{ fontSize: '13px', color: '#9ca3af' }}>Server-generated records</p>
                </div>
                <button onClick={() => refreshAudit()} style={{ background: '#059669', color: '#fff', border: 'none', padding: '12px 20px', borderRadius: '14px', fontWeight: 'bold', cursor: 'pointer' }}>
                  <RefreshCw size={16}/>
                </button>
              </div>
              <div style={{ background: '#121212', border: '1px solid rgba(16, 185, 129, 0.2)', padding: '32px', borderRadius: '32px' }}>
                {audits.length === 0 ? (
                  <div style={{ textAlign: 'center', color: '#9ca3af' }}>No audit records.</div>
                ) : (
                  audits.map(item => (
                    <div key={item.id} style={{ background: '#000', padding: '16px', borderRadius: '16px', border: '1px solid #222', display: 'flex', justifyContent: 'space-between', marginBottom: '10px' }}>
                      <div><strong>{item.action}</strong><div style={{ fontSize: '12px', color: '#9ca3af' }}>{item.message}</div></div>
                      <span style={{ color: item.status === 'pass' ? '#34d399' : '#f87171' }}>{item.status.toUpperCase()}</span>
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