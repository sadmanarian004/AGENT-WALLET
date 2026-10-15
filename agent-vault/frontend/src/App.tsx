import { useCallback, useEffect, useMemo, useState } from 'react'
import type { FormEvent, ReactNode } from 'react'
import {
  Activity, ArrowUpRight, BadgeCheck, Ban, Blocks, Check,
  CircleAlert, CircleCheck, CircleDollarSign, Clock3, Copy, ExternalLink, FileClock,
  Fingerprint, Gauge, KeyRound, LoaderCircle, LockKeyhole, LogOut, Menu, RefreshCw,
  Search, Shield, ShieldAlert, ShieldCheck, Sparkles, Wallet, X,
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
function fmtDate(seconds: number) { return new Date(seconds * 1000).toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }) }
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
  const [auditQuery, setAuditQuery] = useState('')
  const [goal, setGoal] = useState('Send test ETH to a recipient for a small transfer test.')
  const [recipient, setRecipient] = useState('')
  const [amount, setAmount] = useState('0.005')
  const [busy, setBusy] = useState(false)
  const [busyLabel, setBusyLabel] = useState('')
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [mobileMenu, setMobileMenu] = useState(false)
  const [auditLoading, setAuditLoading] = useState(false)
  const [health, setHealth] = useState<{ rpc_configured: boolean; llm_configured: boolean; auth_secret_configured: boolean } | null>(null)

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
    setAuditLoading(true)
    try {
      const query = q.trim() ? `?q=${encodeURIComponent(q.trim())}&limit=150` : '?limit=150'
      const data = await request<{ items: Audit[] }>('/v1/audit', session.token, undefined, { query })
      setAudits(data.items || [])
    } catch (e) { setError(errorMessage(e)) } finally { setAuditLoading(false) }
  }, [session?.token])

  useEffect(() => {
    const timer = window.setInterval(() => setClock(Date.now() / 1000), 1000)
    return () => window.clearInterval(timer)
  }, [])
  useEffect(() => { refreshPolicy().catch(() => setPolicy(null)); request<any>('/health').then(setHealth).catch(() => setHealth(null)) }, [refreshPolicy])
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
      sessionStorage.removeItem('agent-wallet-session')
    } else {
      sessionStorage.removeItem('agent-vault-session')
      sessionStorage.removeItem('agent-wallet-session')
    }
  }, [session])
  useEffect(() => {
    if (!connected) { setBalance('—'); setAudits([]); return }
    refreshBalance().catch(e => setError(errorMessage(e)))
    refreshAudit('').catch(() => {})
  }, [connected, refreshBalance, refreshAudit])
  useEffect(() => {
    if (!window.ethereum?.on) return
    const onAccounts = (accounts: string[]) => {
      if (!accounts?.[0] || accounts[0].toLowerCase() !== address.toLowerCase()) {
        setSession(null); setProposal(null); setNotice('Wallet account changed. Reconnect to create a new authenticated session.')
      }
    }
    const onChain = (chainId: string) => {
      if (String(chainId).toLowerCase() !== SEPOLIA_ID) { setBalance('—'); setNotice('Wrong network. Switch to Sepolia; mainnet is not supported.') }
      else if (address) refreshBalance(address).catch(() => {})
    }
    window.ethereum.on('accountsChanged', onAccounts); window.ethereum.on('chainChanged', onChain)
    return () => { window.ethereum?.removeListener?.('accountsChanged', onAccounts); window.ethereum?.removeListener?.('chainChanged', onChain) }
  }, [address, refreshBalance])

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

  function disconnect() { setSession(null); setProposal(null); setNotice('Wallet session cleared. MetaMask remains connected in your browser.') }

  async function createProposal(e: FormEvent) {
    e.preventDefault(); setError(''); setNotice(''); setBusy(true); setBusyLabel('Building proposal and running server-side checks…'); setProposal(null)
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
    setError(''); setNotice(''); setBusy(true); setBusyLabel('Rechecking policy and preparing one-time approval…')
    try {
      await ensureSepolia()
      const validation = await request<{ eligible: boolean; checks: CheckItem[]; simulation: Simulation }>('/v1/transactions/validate', session.token, { proposal_id: proposal.id, chain_id: 11155111 })
      const refreshed = { ...proposal, risk: validation.checks, simulation: validation.simulation }
      setProposal(refreshed)
      if (!validation.eligible || !validation.simulation.ok) throw new Error(`Server blocked this transaction. ${validation.checks.filter(c => c.status === 'block').map(c => c.detail).join(' ')}`)
      setBusyLabel('Issuing a one-time approval intent…')
      const prepared = await request<{ intent_id: string; transaction: { from: string; to: string; value_wei: string; data: string; gas_limit: number; max_fee_per_gas_wei: string }; message: string }>('/v1/transactions/prepare', session.token, { proposal_id: proposal.id, chain_id: 11155111 })
      setProposal(p => p ? { ...p, status: 'prepared' } : p)
      setBusyLabel('Confirm the exact transaction in MetaMask…')
      const activeAccounts = await window.ethereum.request({ method: 'eth_accounts' }) as string[]
      if (!activeAccounts?.[0] || activeAccounts[0].toLowerCase() !== session.address.toLowerCase()) throw new Error('The active MetaMask account changed. Transaction was not requested.')
      const tx = prepared.transaction
      const hash = await window.ethereum.request({ method: 'eth_sendTransaction', params: [{
        from: tx.from, to: tx.to, value: hexNumber(BigInt(tx.value_wei)), data: tx.data,
        gas: hexNumber(tx.gas_limit), maxFeePerGas: hexNumber(BigInt(tx.max_fee_per_gas_wei)),
        maxPriorityFeePerGas: hexNumber(BigInt(tx.max_fee_per_gas_wei) / 4n > 0n ? BigInt(tx.max_fee_per_gas_wei) / 4n : 1n),
      }] }) as string
      setNotice(`Transaction submitted (${shortAddress(hash)}). Verifying it against Sepolia and waiting for the receipt…`)
      setBusyLabel('Verifying signed transaction and receipt…')
      let finished = false
      let finalStatus: 'confirmed' | 'failed' | 'submitted' = 'submitted'
      for (let i = 0; i < 12; i++) {
        try {
          const result = await request<{ confirmed?: boolean; status?: string; receipt?: Receipt; tx_hash?: string; detail?: any }>(
            '/v1/transactions/confirm', session.token,
            { proposal_id: proposal.id, intent_id: prepared.intent_id, tx_hash: hash })
          if (result.receipt && (result.status === 'confirmed' || result.status === 'failed')) {
            finalStatus = result.status
            setProposal(p => p ? { ...p, status: result.status || 'failed', receipt: result.receipt } : p)
            setNotice(result.status === 'confirmed' ? 'Receipt verified. The approved transaction is confirmed on Sepolia.' : 'The transaction was mined but reverted. It is recorded as failed, not successful.')
            finished = true; break
          }
        } catch (e) {
          // A confirmed mismatch/policy error is not a transient receipt delay.
          if (e instanceof Error && /does not match|not on Sepolia|returned a transaction with a missing|exceeds the approved|different transaction hash|intent is invalid|intent expired|already consumed|incomplete or invalid/i.test(e.message)) throw e
          // Once MetaMask broadcasts, transient backend/RPC errors should not imply the tx failed.
          if (i === 11) setNotice(`Transaction was broadcast as ${hash}, but receipt verification is still pending. Check the Audit Log and explorer.`)
        }
        if (i < 11) await new Promise(resolve => setTimeout(resolve, 2500))
      }
      if (!finished) setNotice(`Transaction is pending: ${hash}`)
      await refreshBalance(session.address).catch(() => {})
      await refreshAudit('').catch(() => {})
      setProposal(p => p ? { ...p, status: finished ? finalStatus : 'submitted' } : p)
    } catch (e) { setError(errorMessage(e)); await refreshAudit('').catch(() => {}) } finally { setBusy(false); setBusyLabel('') }
  }

  async function copy(text: string) { try { await navigator.clipboard.writeText(text); setNotice('Copied to clipboard.') } catch { setError('Clipboard access was denied by the browser.') } }

  const navItems: { id: Page; label: string; icon: typeof Activity }[] = [
    { id: 'overview', label: 'Overview', icon: Gauge }, { id: 'agent', label: 'AI Agent', icon: Sparkles },
    { id: 'controls', label: 'Risk controls', icon: ShieldCheck }, { id: 'audit', label: 'Audit log', icon: FileClock },
  ]

  return <div className="app-shell">
    <aside className={`sidebar ${mobileMenu ? 'open' : ''}`}>
      <div className="brand"><div className="brand-mark"><ShieldCheck size={23}/></div><div><strong>agent<span>vault</span></strong><small>SECURE EXECUTION LAYER</small></div><button className="icon-button mobile-close" onClick={() => setMobileMenu(false)} aria-label="Close navigation"><X size={18}/></button></div>
      <div className="side-label">WORKSPACE</div>
      <nav>{navItems.map(item => { const Icon = item.icon; return <button key={item.id} className={`nav-item ${page === item.id ? 'active' : ''}`} onClick={() => { setPage(item.id); setMobileMenu(false); setError(''); }}><Icon size={18}/><span>{item.label}</span>{item.id === 'audit' && audits.some(a => a.status === 'block') && <i className="nav-dot"/>}</button> })}</nav>
      <div className="sidebar-bottom"><div className="network-card"><div className="network-top"><span className="pulse-dot"/> SEPOLIA TESTNET</div><div className="network-title">Mainnet disabled</div><p>All transactions are scoped to a test network. Signing always happens in your wallet.</p><div className="network-status"><LockKeyhole size={14}/> Policy gated</div></div><div className="side-foot"><span className="pulse-dot green"/> API {health ? 'reachable' : 'checking'}<span className="version">v1.0</span></div></div>
    </aside>
    {mobileMenu && <button className="mobile-scrim" aria-label="Close navigation" onClick={() => setMobileMenu(false)}/>}
    <main className="main-area">
      <header className="topbar"><div className="top-left"><button className="icon-button mobile-menu" onClick={() => setMobileMenu(true)} aria-label="Open navigation"><Menu size={20}/></button><div className="crumb">Workspace <span>/</span> <strong>{navItems.find(x => x.id === page)?.label}</strong></div></div><div className="top-actions"><div className="secure-chip"><span className="pulse-dot green"/> <span>Policy engine active</span></div>{connected ? <div className="wallet-menu"><div className="avatar"><Wallet size={16}/></div><div className="wallet-ident"><strong>{shortAddress(address)}</strong><small>Sepolia account</small></div><button className="icon-button" onClick={disconnect} title="Disconnect session" aria-label="Disconnect session"><LogOut size={16}/></button></div> : <button className="button button-primary button-sm" disabled={busy} onClick={connectWallet}><Wallet size={16}/>{busy ? 'Connecting…' : 'Connect wallet'}</button>}</div></header>
      <div className="content">
        {error && <div className="alert alert-error"><CircleAlert size={18}/><span>{error}</span><button onClick={() => setError('')} aria-label="Dismiss error"><X size={16}/></button></div>}
        {notice && <div className="alert alert-info"><CircleCheck size={18}/><span>{notice}</span><button onClick={() => setNotice('')} aria-label="Dismiss message"><X size={16}/></button></div>}
        {page === 'overview' && <>
          <div className="page-heading"><div><div className="eyebrow"><span className="eyebrow-line"/> WALLET INTELLIGENCE</div><h1>Wallet overview</h1><p>Human-approved execution, independently checked before anything is broadcast.</p></div><button className="button button-quiet" onClick={() => { refreshPolicy().catch(() => {}); refreshBalance().catch(e => setError(errorMessage(e))); refreshAudit('').catch(() => {}); }} disabled={!connected}><RefreshCw size={15}/> Refresh data</button></div>
          <div className="metric-grid">
            <div className="metric-card balance-card"><div className="metric-label">SEPOLIA WALLET BALANCE <span className="metric-symbol"><CircleDollarSign size={17}/></span></div><div className="metric-value">{connected ? balance : '—'} <span>ETH</span></div><div className="metric-foot"><span className="metric-live"><span className="pulse-dot green"/> Live from MetaMask RPC</span></div><div className="balance-watermark"><Blocks size={100}/></div></div>
            <div className="metric-card"><div className="metric-label">TRANSACTION CAP <span className="metric-symbol"><ArrowUpRight size={17}/></span></div><div className="metric-value">{policy?.max_transaction_eth ?? '—'} <span>ETH</span></div><div className="metric-foot"><span className="text-muted">Per transaction · server enforced</span></div><div className="metric-progress"><span style={{ width: '46%' }}/></div></div>
            <div className="metric-card"><div className="metric-label">DAILY SPENDING LIMIT <span className="metric-symbol"><Activity size={17}/></span></div><div className="metric-value">{policy?.daily_limit_eth ?? '—'} <span>ETH</span></div><div className="metric-foot"><span className="text-muted">Rolling 24 hours · reservations count</span></div><div className="metric-progress indigo"><span style={{ width: '30%' }}/></div></div>
            <div className="metric-card"><div className="metric-label">SAFETY STATUS <span className="metric-symbol"><Shield size={17}/></span></div><div className="metric-value status-value"><span className="status-orb"><ShieldCheck size={20}/></span>{policy?.mainnet_enabled ? 'Check setup' : 'Protected'}</div><div className="metric-foot"><span className="green-text">Mainnet execution disabled</span></div></div>
          </div>
          <div className="main-grid">
            <section className="panel execution-panel"><div className="panel-heading"><div><div className="panel-kicker">TRANSACTION PIPELINE</div><h2>Security before execution</h2><p>A proposal is not a transaction until you approve it in MetaMask.</p></div><span className="badge badge-neutral"><LockKeyhole size={13}/> Guarded flow</span></div>
              <div className="pipeline"><div className="pipeline-step"><div className="pipeline-icon purple"><Sparkles size={18}/></div><div className="pipeline-copy"><strong>AI proposal</strong><span>Turns your instruction into a fixed transfer request.</span></div><div className="step-tag">01</div></div><div className="pipeline-connector"/><div className="pipeline-step"><div className="pipeline-icon blue"><ShieldCheck size={18}/></div><div className="pipeline-copy"><strong>Server risk checks</strong><span>Allowlist, spending cap, RPC simulation and fee bounds.</span></div><div className="step-tag">02</div></div><div className="pipeline-connector"/><div className="pipeline-step"><div className="pipeline-icon amber"><Fingerprint size={18}/></div><div className="pipeline-copy"><strong>Explicit wallet approval</strong><span>MetaMask displays the transaction you are signing.</span></div><div className="step-tag">03</div></div><div className="pipeline-connector"/><div className="pipeline-step"><div className="pipeline-icon green"><BadgeCheck size={18}/></div><div className="pipeline-copy"><strong>Verified receipt</strong><span>Server checks the mined transaction against the proposal.</span></div><div className="step-tag">04</div></div></div>
              <button className="button button-primary full-button" onClick={() => setPage('agent')}><Sparkles size={16}/> Create a transaction proposal <ArrowUpRight size={16}/></button>
            </section>
            <section className="panel health-panel"><div className="panel-heading"><div><div className="panel-kicker">SYSTEM HEALTH</div><h2>Execution readiness</h2></div><span className={`health-indicator ${policy?.rpc_configured ? 'healthy' : 'warning'}`}><span className="pulse-dot"/>{policy?.rpc_configured ? 'RPC configured' : 'RPC not configured'}</span></div>
              <div className="health-list"><HealthRow icon={<Blocks size={17}/>} title="Network restriction" description="Ethereum Sepolia · Chain ID 11155111" status="pass" label="Enforced"/><HealthRow icon={<Shield size={17}/>} title="Recipient allowlist" description={policy?.allow_any_recipient ? 'Any valid recipient (unsafe demo override)' : `${policy?.allowlist_count ?? 0} recipient(s) configured`} status={policy?.allow_any_recipient ? 'warn' : (policy?.allowlist_count ? 'pass' : 'block')} label={policy?.allow_any_recipient ? 'Override on' : policy?.allowlist_count ? 'Configured' : 'Configure'}/><HealthRow icon={<Gauge size={17}/>} title="Trusted simulation" description="eth_call, gas estimate, balance and fee checks" status={policy?.rpc_configured ? 'pass' : 'block'} label={policy?.rpc_configured ? 'Available' : 'Blocked'}/><HealthRow icon={<Sparkles size={17}/>} title="Claude planner" description="AI writes explanations; rules remain deterministic" status={policy?.llm_configured ? 'pass' : 'warn'} label={policy?.llm_configured ? 'Connected' : 'Fallback'}/></div>
              {!health?.auth_secret_configured && <div className="setup-hint"><CircleAlert size={16}/><span>Set a random <code>APP_SECRET</code> (32+ characters) in backend <code>.env</code> before wallet authentication is enabled.</span></div>}
              {!policy?.rpc_configured && <div className="setup-hint"><CircleAlert size={16}/><span>Set <code>SEPOLIA_RPC_URL</code> in backend <code>.env</code> to enable trusted simulation. Execution fails closed until then.</span></div>}
            </section>
          </div>
          <section className="panel audit-preview"><div className="panel-heading compact"><div><div className="panel-kicker">LATEST EVENTS</div><h2>Recent audit activity</h2></div><button className="text-button" onClick={() => setPage('audit')}>View all <ArrowUpRight size={14}/></button></div>
            {!connected ? <EmptyState icon={<Wallet size={20}/>} title="Connect to view your audit trail" text="Audit events are scoped to the authenticated wallet." action="Connect wallet" onAction={connectWallet}/> : audits.length === 0 ? <EmptyState icon={<FileClock size={20}/>} title="No activity yet" text="Your proposals, policy decisions and receipt checks will appear here."/> : <AuditTable items={audits.slice(0, 5)} onCopy={copy}/>}</section>
        </>}

        {page === 'agent' && <>
          <div className="page-heading"><div><div className="eyebrow"><span className="eyebrow-line"/> INTENT WORKSPACE</div><h1>AI transaction agent</h1><p>Describe your goal, set exact transaction fields, and inspect every server-side check.</p></div><span className="badge badge-live"><span className="pulse-dot green"/> Testnet only</span></div>
          <div className="agent-layout"><section className="panel agent-form-panel"><div className="form-title"><div className="form-icon"><Sparkles size={19}/></div><div><h2>Build a transaction</h2><p>The AI can explain the request, but it cannot change the address or amount.</p></div></div>
              <form onSubmit={createProposal} className="agent-form"><label htmlFor="goal">Your instruction <span>Required</span></label><textarea id="goal" value={goal} onChange={e => setGoal(e.target.value)} maxLength={500} minLength={3} rows={3} placeholder="e.g. Send test ETH to my test recipient for a small transfer test." required/><div className="field-meta"><span>Describe the purpose in plain language</span><span>{goal.length}/500</span></div>
                <label htmlFor="recipient">Recipient address <span>Exact transaction field</span></label><div className="input-wrap"><Wallet size={16}/><input id="recipient" value={recipient} onChange={e => setRecipient(e.target.value)} placeholder="0x…" spellCheck={false} autoComplete="off" required minLength={42} maxLength={42}/>{recipient && /^0x[a-fA-F0-9]{40}$/.test(recipient) && <Check size={16} className="valid-icon"/>}</div><p className="field-help">Must be on the server's <code>ALLOWED_RECIPIENTS</code> list.</p>
                <label htmlFor="amount">Amount <span>Native Sepolia ETH</span></label><div className="input-wrap amount-wrap"><CircleDollarSign size={16}/><input id="amount" type="number" min="0.000000000000000001" step="0.000000000000000001" value={amount} onChange={e => setAmount(e.target.value)} required/><span className="input-suffix">ETH</span></div><div className="amount-limit"><span>Per-tx limit</span><strong>{policy?.max_transaction_eth ?? '—'} ETH</strong></div>
                <div className="form-notice"><LockKeyhole size={16}/><p>Private keys never enter this app. The backend simulates and validates; MetaMask alone signs and broadcasts.</p></div>
                <button className="button button-primary full-button" type="submit" disabled={!connected || busy}>{busy ? <LoaderCircle className="spin" size={17}/> : <Sparkles size={17}/>} {busy ? (busyLabel || 'Working…') : 'Generate & check proposal'} <ArrowUpRight size={16}/></button>
                {!connected && <div className="inline-warning"><CircleAlert size={15}/> Connect and authenticate MetaMask to create a proposal.</div>}
              </form></section>
            <section className="panel proposal-panel"><div className="panel-heading"><div><div className="panel-kicker">PROPOSAL INSPECTOR</div><h2>Risk analysis</h2><p>Every decision below comes from backend rules and RPC responses.</p></div>{proposal && <span className={`badge ${isEligible ? 'badge-live' : 'badge-danger'}`}>{isEligible ? 'Passed checks' : 'Blocked'}</span>}</div>
              {!proposal ? <div className="proposal-empty"><div className="empty-orbit"><ShieldCheck size={28}/></div><h3>Awaiting a proposal</h3><p>Submit your transaction details to run recipient, limit, gas, balance and simulation checks.</p><div className="empty-steps"><span><Check size={13}/> Address validation</span><span><Check size={13}/> Spending policy</span><span><Check size={13}/> RPC simulation</span></div></div> : <div className="proposal-details">
                <div className={`proposal-status ${proposal.risk.every(c => c.status === 'pass') && proposal.simulation.ok ? 'ok' : 'blocked'}`}><div className="status-icon">{proposal.risk.every(c => c.status === 'pass') && proposal.simulation.ok ? <ShieldCheck size={21}/> : <ShieldAlert size={21}/>}</div><div><strong>{proposal.risk.every(c => c.status === 'pass') && proposal.simulation.ok ? 'Eligible for explicit approval' : 'Transaction blocked'}</strong><span>{proposal.risk.every(c => c.status === 'pass') && proposal.simulation.ok ? 'All current checks passed. This is not an execution or guarantee.' : 'Resolve every blocking check before signing.'}</span></div></div>
                <div className="proposal-amount"><div><small>Proposed transfer</small><div className="big-amount">{proposal.amount_eth} <span>ETH</span></div></div><div className="chain-pill"><Blocks size={14}/> Sepolia</div></div>
                <div className="detail-row"><span>Recipient</span><div className="detail-address">{shortAddress(proposal.recipient)} <button onClick={() => copy(proposal.recipient)} aria-label="Copy recipient"><Copy size={13}/></button></div></div>
                <div className="detail-row"><span>Proposal ID</span><div className="detail-address mono">{proposal.id.slice(0, 12)}… <button onClick={() => copy(proposal.id)} aria-label="Copy proposal ID"><Copy size={13}/></button></div></div>
                <div className="detail-row"><span>Expires at</span><strong className={proposal.expires_at < Date.now() / 1000 ? 'red-text' : ''}>{fmtDate(proposal.expires_at)}</strong></div>
                <div className="ai-explanation"><div className="ai-label"><Sparkles size={14}/> AGENT EXPLANATION <span>{proposal.llm_used ? 'CLAUDE' : 'LOCAL FALLBACK'}</span></div><p>{proposal.explanation}</p>{proposal.agent_plan?.steps?.length ? <ol className="agent-plan-steps">{proposal.agent_plan.steps.map((step, i) => <li key={`${i}-${step.title}`}><span>{String(i + 1).padStart(2, '0')}</span><div><strong>{step.title}</strong><p>{step.detail}</p></div></li>)}</ol> : null}</div>
                <div className="checks-title"><span>SERVER-SIDE CHECKS</span><span>{proposal.risk.filter(c => c.status === 'pass').length}/{proposal.risk.length} passed</span></div><div className="checks-list">{proposal.risk.map((c, i) => <div className="check-line" key={`${c.name}-${i}`}><span className={`check-symbol ${c.status}`}>{c.status === 'pass' ? <Check size={12}/> : c.status === 'warn' ? <CircleAlert size={12}/> : <X size={12}/>}</span><div><strong>{c.name.replaceAll('_', ' ')}</strong><p>{c.detail}</p></div><span className={`check-result ${c.status}`}>{c.status === 'pass' ? 'PASS' : c.status === 'warn' ? 'WARN' : 'BLOCK'}</span></div>)}</div>
                <div className={`simulation-card ${proposal.simulation.ok ? 'sim-ok' : 'sim-bad'}`}><div className="simulation-head"><span>{proposal.simulation.ok ? <CircleCheck size={17}/> : <CircleAlert size={17}/>} Trusted RPC simulation</span><strong>{proposal.simulation.ok ? 'PASSED' : 'FAILED'}</strong></div><p>{proposal.simulation.reason}</p>{proposal.simulation.gas_estimate !== undefined && <div className="sim-metrics"><div><span>Gas estimate</span><strong>{proposal.simulation.gas_estimate.toLocaleString()}</strong></div><div><span>Max gas cap</span><strong>{proposal.simulation.max_gas_limit?.toLocaleString()}</strong></div><div><span>Max fee</span><strong>{formatEth(proposal.simulation.max_fee_wei)} ETH</strong></div></div>}</div>
                {proposal.receipt && <div className="receipt-card"><div className="simulation-head"><span><BadgeCheck size={17}/> On-chain receipt</span><strong>{proposal.receipt.status.toUpperCase()}</strong></div><div className="detail-row"><span>Transaction hash</span><div className="detail-address mono">{shortAddress(proposal.receipt.transaction_hash)} <button onClick={() => copy(proposal.receipt!.transaction_hash)}><Copy size={13}/></button></div></div><div className="detail-row"><span>Block</span><strong>{proposal.receipt.block_number.toLocaleString()}</strong></div><a href={`https://sepolia.etherscan.io/tx/${proposal.receipt.transaction_hash}`} target="_blank" rel="noreferrer" className="explorer-link">Open on Sepolia Etherscan <ExternalLink size={14}/></a></div>}
                {proposal.status === 'confirmed' && <div className="success-note"><CircleCheck size={16}/> Receipt verified and audit event written.</div>}
                <button className="button button-primary full-button approve-button" onClick={approveAndSend} disabled={!connected || !isEligible || busy || ['prepared','submitted','confirmed','failed'].includes(proposal.status)}>{busy ? <LoaderCircle className="spin" size={17}/> : <Fingerprint size={17}/>} {busy ? (busyLabel || 'Processing…') : proposal.status === 'confirmed' ? 'Transaction confirmed' : proposal.status === 'submitted' ? 'Transaction submitted' : 'Review & approve in MetaMask'} <ArrowUpRight size={16}/></button>
                <p className="approval-foot"><LockKeyhole size={13}/> Requires a fresh server check and one-time intent. Review network, recipient, amount and fee in MetaMask.</p>
              </div>}
            </section></div>
        </>}

        {page === 'controls' && <>
          <div className="page-heading"><div><div className="eyebrow"><span className="eyebrow-line"/> POLICY CONFIGURATION</div><h1>Risk controls</h1><p>Limits are loaded from backend environment settings, not editable client-side values.</p></div><span className="badge badge-neutral"><LockKeyhole size={13}/> Server enforced</span></div>
          <div className="controls-grid"><section className="panel controls-summary"><div className="panel-heading"><div><div className="panel-kicker">ACTIVE POLICY</div><h2>Transaction guardrails</h2><p>Policy changes require a backend environment update and application restart.</p></div><div className="policy-icon"><ShieldCheck size={23}/></div></div>
              <div className="policy-rows"><PolicyRow title="Network allowlist" value="Sepolia only" meta="Chain ID 11155111" status="On"/><PolicyRow title="Per-transaction limit" value={`${policy?.max_transaction_eth ?? '—'} ETH`} meta="Transfer value, excluding fees" status="On"/><PolicyRow title="Rolling daily spend" value={`${policy?.daily_limit_eth ?? '—'} ETH`} meta="Prepared reservations and confirmed transfers count" status="On"/><PolicyRow title="Maximum network fee" value={`${policy?.max_fee_eth ?? '—'} ETH`} meta={`Gas cap: ${policy?.max_gas_limit?.toLocaleString() ?? '—'}`} status="On"/><PolicyRow title="Recipient allowlist" value={policy?.allow_any_recipient ? 'Disabled by override' : `${policy?.allowlist_count ?? 0} configured`} meta={policy?.allow_any_recipient ? 'Unsafe demo setting is enabled' : 'Only configured recipients can be approved'} status={policy?.allow_any_recipient ? 'Review' : policy?.allowlist_count ? 'On' : 'Needs setup'}/><PolicyRow title="Duplicate intent protection" value="One-time & expiring" meta="Each proposal binds to one approval intent and transaction hash" status="On"/><PolicyRow title="LLM authority" value="Explanation only" meta="AI output cannot change transaction fields or override checks" status="On"/></div>
            </section>
            <section className="panel configuration-panel"><div className="panel-kicker">SERVER CONFIGURATION</div><h2>Configure the guardrails</h2><p className="body-copy">Set these values in <code>backend/.env</code>. Never put API keys or privileged secrets in the frontend.</p><div className="env-snippet"><div className="env-header"><span>backend/.env</span><button onClick={() => copy('SEPOLIA_RPC_URL=https://your-sepolia-rpc\nALLOWED_RECIPIENTS=0xYourAllowedAddress\nALLOW_ANY_RECIPIENT=false\nMAX_TX_ETH=0.02\nDAILY_LIMIT_ETH=0.05\nMAX_FEE_ETH=0.001\nMAX_GAS_LIMIT=50000\nANTHROPIC_API_KEY=your-key\nANTHROPIC_MODEL=claude-sonnet-5-5')}><Copy size={13}/> Copy template</button></div><pre>{`SEPOLIA_RPC_URL=https://your-sepolia-rpc
ALLOWED_RECIPIENTS=0xYourAllowedAddress
ALLOW_ANY_RECIPIENT=false
MAX_TX_ETH=0.02
DAILY_LIMIT_ETH=0.05
MAX_FEE_ETH=0.001
MAX_GAS_LIMIT=50000
ANTHROPIC_API_KEY=your-key
ANTHROPIC_MODEL=claude-sonnet-5-5`}</pre></div><div className="warning-box"><ShieldAlert size={17}/><div><strong>Fail-closed execution</strong><p>If trusted RPC simulation is unavailable, the server blocks preparation. An empty recipient allowlist blocks all transfers unless you explicitly turn on the unsafe override.</p></div></div><div className="warning-box muted-warning"><KeyRound size={17}/><div><strong>No server-side signing</strong><p>This prototype never stores private keys. Wallet ownership is proven with a session signature; the actual transaction must be signed in MetaMask.</p></div></div><button className="button button-secondary full-button" onClick={() => refreshPolicy().catch(e => setError(errorMessage(e)))}><RefreshCw size={15}/> Reload active policy</button></section></div>
        </>}

        {page === 'audit' && <>
          <div className="page-heading"><div><div className="eyebrow"><span className="eyebrow-line"/> FORENSIC ACTIVITY</div><h1>Audit log</h1><p>Server-generated records for proposals, blocked checks, approval intents and receipts.</p></div><button className="button button-quiet" onClick={() => refreshAudit().catch(() => {})} disabled={!connected || auditLoading}><RefreshCw size={15} className={auditLoading ? 'spin' : ''}/> Refresh log</button></div>
          <section className="panel full-audit-panel"><div className="audit-tools"><div className="audit-count"><span className="count-block">{audits.filter(a => a.status === 'block').length} blocked</span><span className="count-total">{audits.length} events</span></div><div className="audit-search"><Search size={16}/><input aria-label="Search audit log" value={auditQuery} onChange={e => setAuditQuery(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') refreshAudit(auditQuery).catch(() => {}) }} placeholder="Search actions, hashes, proposal IDs…"/><button onClick={() => refreshAudit(auditQuery).catch(() => {})} disabled={!connected}>Search</button></div></div>
            {!connected ? <EmptyState icon={<Wallet size={20}/>} title="Connect your wallet" text="Sign in with MetaMask to load its private audit view." action="Connect wallet" onAction={connectWallet}/> : audits.length === 0 ? <EmptyState icon={<Search size={20}/>} title="No matching events" text="Try a different query or create your first proposal."/> : <AuditTable items={audits} onCopy={copy}/>}</section>
          <div className="audit-disclaimer"><LockKeyhole size={15}/> Audit events are stored in the backend SQLite database. They are not blockchain events unless explicitly linked to a verified on-chain transaction receipt.</div>
        </>}
        <footer className="app-footer"><span>AGENT VAULT <span className="footer-sep">/</span> TESTNET PROTOTYPE</span><span><span className="pulse-dot green"/> Mainnet execution disabled</span></footer>
      </div>
    </main>
  </div>
}

function HealthRow({ icon, title, description, status, label }: { icon: ReactNode; title: string; description: string; status: 'pass' | 'block' | 'warn'; label: string }) {
  return <div className="health-row"><div className="health-icon">{icon}</div><div className="health-copy"><strong>{title}</strong><span>{description}</span></div><span className={`health-tag ${status}`}>{status === 'pass' ? <Check size={12}/> : status === 'warn' ? <CircleAlert size={12}/> : <Ban size={12}/>} {label}</span></div>
}
function PolicyRow({ title, value, meta, status }: { title: string; value: string; meta: string; status: string }) {
  const needs = status === 'Needs setup' || status === 'Review'
  return <div className="policy-row"><div className="policy-status-icon">{needs ? <CircleAlert size={17}/> : <Check size={17}/>}</div><div className="policy-copy"><strong>{title}</strong><span>{meta}</span></div><div className="policy-value"><strong>{value}</strong><span className={needs ? 'amber-text' : 'green-text'}>{status}</span></div></div>
}
function EmptyState({ icon, title, text, action, onAction }: { icon: ReactNode; title: string; text: string; action?: string; onAction?: () => void }) {
  return <div className="empty-state"><div className="empty-icon">{icon}</div><strong>{title}</strong><p>{text}</p>{action && onAction && <button className="button button-secondary button-sm" onClick={onAction}>{action}</button>}</div>
}
function AuditTable({ items, onCopy }: { items: Audit[]; onCopy: (text: string) => void }) {
  return <div className="table-scroll"><table className="audit-table"><thead><tr><th>Event</th><th>Status</th><th>Details</th><th>Timestamp</th><th>Reference</th></tr></thead><tbody>{items.map(item => <tr key={item.id}><td><div className="event-name"><span className={`event-icon ${item.status}`}>{item.status === 'pass' ? <Check size={14}/> : item.status === 'pending' ? <Clock3 size={14}/> : <ShieldAlert size={14}/>}</span><div><strong>{item.action.replaceAll('_',' ')}</strong><small>#{item.id}</small></div></div></td><td><span className={`table-status ${item.status}`}>{item.status}</span></td><td><span className="audit-message">{item.message}</span></td><td><span className="date-cell">{fmtDate(item.created_at)}</span></td><td>{item.tx_hash ? <div className="reference-cell"><a href={`https://sepolia.etherscan.io/tx/${item.tx_hash}`} target="_blank" rel="noreferrer">{shortAddress(item.tx_hash)} <ExternalLink size={12}/></a><button onClick={() => onCopy(item.tx_hash!)} aria-label="Copy transaction hash"><Copy size={12}/></button></div> : item.proposal_id ? <div className="reference-cell mono">{item.proposal_id.slice(0, 8)}…<button onClick={() => onCopy(item.proposal_id!)} aria-label="Copy proposal ID"><Copy size={12}/></button></div> : <span className="text-muted">—</span>}</td></tr>)}</tbody></table></div>
}
