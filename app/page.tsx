'use client'

import { useState, useEffect, useCallback } from 'react'
import {
  AlertTriangle, Bell, Check, ChevronRight, CircleDot,
  Clock3, FileWarning, Menu, ShieldCheck, Terminal, X,
  Plus, Play, Search, Settings2, RefreshCw, Loader2, LogOut
} from 'lucide-react'
import { useAuth } from '@/app/contexts/auth'
import { ProtectedRoute } from '@/app/components/ProtectedRoute'
import {
  getAuditStats, getAuditLog, getApprovals,
  approveRequest, rejectRequest, inspectToolCall,
  type AuditStats, type AuditEntry, type ApprovalRequest
} from '@/lib/api'

// ─── Static data (agents / threats remain static — no backend entity yet) ─────
const staticAgents = [
  ['DevAgent', 'RUNNING', 'LOW', '8', '1,284'],
  ['ResearchAgent', 'IDLE', 'MEDIUM', '5', '642'],
  ['CodeAgent', 'BLOCKED', 'HIGH', '11', '327'],
]
const staticThreats = [
  ['PI-001', 'Prompt Injection', 'CRITICAL', 'DevAgent', 'User Input', '09:42'],
  ['TOOL-024', 'Dangerous Tool Call', 'HIGH', 'CodeAgent', 'execute_command', '09:31'],
  ['SEC-011', 'Sensitive Data Exposure', 'HIGH', 'ResearchAgent', 'Tool Output', '08:54'],
]

const nav = [
  'Overview', 'Agents', 'Playground', 'Workflows',
  'Live Monitor', 'Threats', 'Policies', 'Approvals',
  'Evaluations', 'Settings', 'Demo',
]

// ─── Helpers ──────────────────────────────────────────────────────────────────
function decisionTone(d: string) {
  if (d === 'allow') return 'allow'
  if (d === 'block') return 'block'
  return 'review'
}

function riskTone(level: string) {
  if (level === 'critical' || level === 'high') return 'danger'
  if (level === 'medium') return 'warn'
  return 'success'
}

function fmt(iso: string) {
  return new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })
}

// ─── Shared UI ────────────────────────────────────────────────────────────────
function Logo() {
  return (
    <div className="logo">
      <div className="logo-mark"><ShieldCheck size={17} /></div>
      <div><strong>AgentShield</strong><span>AI AGENT SECURITY</span></div>
    </div>
  )
}

function Header({ open, setOpen }: { open: boolean; setOpen: (v: boolean) => void }) {
  const { username, logout } = useAuth()
  
  const handleLogout = () => {
    logout()
    window.location.href = '/login'
  }

  return (
    <header className="topbar">
      <Logo />
      <div className="topbar-meta">
        <span className="env">LOCAL <b>/</b> DEVELOPMENT</span>
        <span className="system"><i /> SYSTEM OPERATIONAL</span>
        <div className="flex items-center gap-3">
          {username && (
            <span className="text-sm px-3 py-1 bg-blue-600/20 text-blue-300 rounded border border-blue-500/30">
              {username}
            </span>
          )}
          <button className="icon-button" aria-label="Notifications"><Bell size={17} /></button>
          {username && (
            <button 
              className="icon-button hover:text-red-400" 
              aria-label="Logout"
              onClick={handleLogout}
              title="Logout"
            >
              <LogOut size={17} />
            </button>
          )}
        </div>
      </div>
      <button className="menu-button" onClick={() => setOpen(!open)} aria-label={open ? 'Close navigation' : 'Open navigation'}>
        {open ? <X size={22} /> : <Menu size={22} />}
      </button>
    </header>
  )
}

function Drawer({ open, setOpen, active, setActive }: {
  open: boolean; setOpen: (v: boolean) => void; active: string; setActive: (v: string) => void
}) {
  if (!open) return null
  return (
    <aside className="drawer">
      <div className="drawer-head">
        <Logo />
        <button className="icon-button" onClick={() => setOpen(false)} aria-label="Close navigation"><X size={20} /></button>
      </div>
      <nav>
        {nav.map((item, i) => (
          <button className={item === active ? 'selected' : ''} key={item} onClick={() => { setActive(item); setOpen(false) }}>
            <span>{String(i + 1).padStart(2, '0')}</span>{item}<ChevronRight size={15} />
          </button>
        ))}
      </nav>
      <div className="drawer-foot">
        <span><i /> Secure runtime active</span>
        <small>AgentShield v0.1 · Open Source</small>
      </div>
    </aside>
  )
}

function Button({ children, onClick, secondary = false }: { children: React.ReactNode; onClick?: () => void; secondary?: boolean }) {
  return <button className={secondary ? 'control-button secondary' : 'control-button'} onClick={onClick}>{children}</button>
}

function Badge({ children, tone = 'blue' }: { children: React.ReactNode; tone?: string }) {
  return <span className={`security-badge ${tone}`}>{children}</span>
}

function PageHead({ eyebrow, title, description, action }: {
  eyebrow: string; title: string; description: string; action?: React.ReactNode
}) {
  return (
    <div className="page-head">
      <div>
        <span className="eyebrow">{eyebrow}</span>
        <h1>{title}</h1>
        <p>{description}</p>
      </div>
      {action}
    </div>
  )
}

function Panel({ title, eyebrow, children, className = '' }: {
  title: string; eyebrow?: string; children: React.ReactNode; className?: string
}) {
  return (
    <section className={`panel workspace-panel ${className}`}>
      <div className="panel-head">
        <div>{eyebrow && <span className="eyebrow">{eyebrow}</span>}<h2>{title}</h2></div>
      </div>
      {children}
    </section>
  )
}

function Spinner() {
  return <div className="flex items-center gap-2 p-4 text-sm opacity-60"><Loader2 size={16} className="animate-spin" /> Loading…</div>
}

// ─── Overview ─────────────────────────────────────────────────────────────────
function Overview() {
  const { accessToken } = useAuth()
  const [stats, setStats] = useState<AuditStats | null>(null)
  const [events, setEvents] = useState<AuditEntry[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const { useRealtimeAudit } = require('../hooks/useRealtimeEvents')
  const realtimeEvents = useRealtimeAudit()

  const load = useCallback(async () => {
    if (!accessToken) {
      setError('Not authenticated')
      return
    }

    try {
      setError(null)
      const stats = await getAuditStats(accessToken)
      setStats(stats)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Backend unreachable')
    } finally {
      setLoading(false)
    }
  }, [accessToken])

  // Load stats on mount and poll periodically
  useEffect(() => {
    void load()
    const interval = window.setInterval(() => { void load() }, 30000) // Poll every 30s instead of 5s
    return () => window.clearInterval(interval)
  }, [load])

  // Use real-time events for live audit feed
  useEffect(() => {
    if (realtimeEvents.events.length > 0) {
      setEvents(realtimeEvents.events.slice(0, 6))
    }
  }, [realtimeEvents.events])

  const blocked   = stats?.byDecision.find(d => d.decision === 'block')?.count ?? 0
  const allowed   = stats?.byDecision.find(d => d.decision === 'allow')?.count ?? 0
  const pending   = stats?.byDecision.find(d => d.decision === 'require_approval')?.count ?? 0
  const total     = stats?.total ?? 0

  return (
    <main className="dashboard">
      <section className="status-header">
        <div>
          <span className="eyebrow">SECURITY CONTROL CENTER / OVERVIEW</span>
          <h1>AgentShield Security</h1>
          <p>{error ? <span style={{ color: 'salmon' }}>⚠ {error} — start the backend with <code>npm start</code></span> : realtimeEvents.connected ? 'Your agents are protected. Live updates active ✓' : 'Your agents are protected.'}</p>
        </div>
        <div className="protected">
          <span><i /> {error ? 'BACKEND OFFLINE' : realtimeEvents.connected ? 'REAL-TIME ACTIVE' : 'PROTECTED'}</span>
          <small>Last update {new Date().toLocaleTimeString()}</small>
        </div>
      </section>

      {/* Metrics */}
      <div className="metrics">
        {loading ? <Spinner /> : <>
          {[
            [String(blocked),  'THREATS BLOCKED',    `${((blocked / Math.max(total,1))*100).toFixed(1)}%`, 'danger'],
            [String(total),    'ACTIONS INSPECTED',  '↑ live', 'up'],
            [String(staticAgents.length), 'ACTIVE AGENTS', 'ALL GUARDED', 'blue'],
            [String(pending),  'PENDING APPROVALS',  pending > 0 ? 'REQUIRES ACTION' : 'ALL CLEAR', pending > 0 ? 'warn' : 'blue'],
          ].map(([v, l, m, t]) => (
            <div className="metric" key={l}>
              <span>{l}</span>
              <strong>{v}</strong>
              <b className={t}>{m}</b>
            </div>
          ))}
        </>}
      </div>

      <div className="dashboard-grid">
        {/* Live agent execution panel */}
        <Panel title="Live Agent Events" eyebrow={realtimeEvents.connected ? "REAL-TIME AUDIT FEED" : "AUDIT FEED (5s POLL)"}>
          {loading ? <Spinner /> : events.length === 0 ? (
            <p style={{ padding: '1rem', opacity: 0.5 }}>No events yet — submit a tool call to /inspect</p>
          ) : (
            <div className="event-list">
              {events.map(e => (
                <div className={`event ${decisionTone(e.decision)}`} key={e.id}>
                  <time>{fmt(e.createdAt)}</time>
                  <span className="event-action">{e.tool} <small>{e.agentId ?? ''}</small></span>
                  <span className="event-risk">RISK {String(e.riskScore).padStart(2, '0')}</span>
                  <b>{e.decision.toUpperCase()}</b>
                </div>
              ))}
            </div>
          )}
          <div className="panel-foot">
            <span><CircleDot size={13} /> {realtimeEvents.connected ? "Live via WebSocket" : "Live from audit log (polling)"}</span>
            <button onClick={load}><RefreshCw size={13} /> Refresh</button>
          </div>
        </Panel>

        {/* Decision pipeline — static diagram */}
        <Panel title="Nothing executes unseen." eyebrow="DECISION PIPELINE">
          <div className="decision-flow">
            {['AI AGENT', 'TOOL CALL', 'AGENTSHIELD', 'SECURITY ANALYSIS', 'DECISION', 'EXECUTION'].map((s, i) => (
              <div className="decision-step" key={s}>
                <div className={i === 4 ? 'decision-node active' : 'decision-node'}>
                  {i === 4 ? <Check size={15} /> : i === 2 ? <ShieldCheck size={15} /> : <span>{String(i + 1).padStart(2, '0')}</span>}
                </div>
                <b>{s}</b>
                {i < 5 && <div className="flow-line" />}
              </div>
            ))}
          </div>
          <div className="decision-legend">
            <span className="allow"><i /> ALLOW</span>
            <span className="review"><i /> REVIEW</span>
            <span className="block"><i /> BLOCK</span>
          </div>
        </Panel>

        {/* Threats — static */}
        <Panel title="Recent threats" eyebrow="THREAT INTELLIGENCE">
          <ThreatTable compact />
        </Panel>

        {/* Approvals mini panel */}
        <Panel title="Approval queue" eyebrow="HUMAN IN THE LOOP">
          <ApprovalsPanel compact />
        </Panel>
      </div>
    </main>
  )
}

// ─── Approvals ────────────────────────────────────────────────────────────────
function ApprovalsPanel({ compact = false }: { compact?: boolean }) {
  const { accessToken } = useAuth()
  const [requests, setRequests] = useState<ApprovalRequest[]>([])
  const [loading, setLoading] = useState(true)
  const [acting, setActing] = useState<string | null>(null)
  const { useRealtimeApprovals } = require('../hooks/useRealtimeEvents')
  const realtimeApprovals = useRealtimeApprovals()

  const load = useCallback(async () => {
    if (!accessToken) {
      setLoading(false)
      return
    }

    try {
      const data = await getApprovals(accessToken, 'pending', 20)
      setRequests(data.requests)
    } catch {
      // backend offline — fail silently in compact mode
    } finally {
      setLoading(false)
    }
  }, [accessToken])

  // Initial load
  useEffect(() => {
    void load()
  }, [load])

  // Poll for initial data less frequently now that we have real-time updates
  useEffect(() => {
    const intervalId = window.setInterval(() => { void load() }, 30000)
    return () => window.clearInterval(intervalId)
  }, [load])

  // Update with real-time changes
  useEffect(() => {
    if (realtimeApprovals.events.length > 0) {
      // Filter for pending approvals only and take latest
      const pending = realtimeApprovals.events.filter((e: any) => e.status === 'pending').slice(0, compact ? 2 : 20)
      if (pending.length > 0) {
        setRequests(pending)
      }
    }
  }, [realtimeApprovals.events, compact])

  async function handleApprove(id: string) {
    if (!accessToken) return
    setActing(id)
    try { await approveRequest(id, accessToken); await load() }
    catch (e) { alert(e instanceof Error ? e.message : 'Error') }
    finally { setActing(null) }
  }

  async function handleReject(id: string) {
    if (!accessToken) return
    setActing(id)
    try { await rejectRequest(id, accessToken, 'Denied by operator'); await load() }
    catch (e) { alert(e instanceof Error ? e.message : 'Error') }
    finally { setActing(null) }
  }

  if (loading && requests.length === 0) return <Spinner />
  if (requests.length === 0) return <p style={{ padding: '1rem', opacity: 0.5 }}>No pending approvals 🎉</p>

  return (
    <div>
      {requests.map(r => (
        <div key={r.id} className={`approval-card ${compact ? 'compact' : ''}`}>
          <div className="approval-top">
            <FileWarning size={17} />
            <span>{r.toolCall.agentId ?? 'Agent'} wants to execute</span>
            <b>{r.inspection.riskLevel.toUpperCase()} RISK</b>
          </div>
          <h3>{r.toolCall.tool}</h3>
          <code>{JSON.stringify(r.toolCall.args).slice(0, 80)}</code>
          <p>Risk score: <strong>{r.inspection.riskScore} / 100</strong></p>
          <div className="approval-actions">
            <button
              className="approve"
              disabled={acting === r.id}
              onClick={() => handleApprove(r.id)}
            >
              {acting === r.id ? <Loader2 size={14} className="animate-spin" /> : <Check size={14} />} APPROVE
            </button>
            <button
              className="reject"
              disabled={acting === r.id}
              onClick={() => handleReject(r.id)}
            >
              <X size={14} /> DENY
            </button>
          </div>
        </div>
      ))}
    </div>
  )
}

function ApprovalsPage() {
  return (
    <main className="workspace">
      <PageHead
        eyebrow="APPROVALS / HUMAN IN THE LOOP"
        title="Human Approval"
        description="Intervene before high-risk agent actions execute."
      />
      <div className="approval-grid">
        <ApprovalsPanel />
      </div>
    </main>
  )
}

// ─── Live Monitor ─────────────────────────────────────────────────────────────
function MonitorPage() {
  const { accessToken } = useAuth()
  const [entries, setEntries] = useState<AuditEntry[]>([])
  const [loading, setLoading] = useState(true)
  const [filter, setFilter] = useState('All')
  const [error, setError] = useState<string | null>(null)
  const { useRealtimeAudit } = require('../hooks/useRealtimeEvents')
  const realtimeEvents = useRealtimeAudit()

  const load = useCallback(async () => {
    if (!accessToken) {
      setError('Not authenticated')
      return
    }

    try {
      setError(null)
      const decisionMap: Record<string, string> = {
        Allowed: 'allow', Blocked: 'block', Review: 'require_approval',
      }
      const data = await getAuditLog(accessToken, {
        decision: decisionMap[filter],
        limit: 50,
      })
      setEntries(data.entries)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Backend unreachable')
    } finally {
      setLoading(false)
    }
  }, [filter, accessToken])

  // Initial load
  useEffect(() => {
    void load()
  }, [load])

  // Poll less frequently, rely on real-time for updates
  useEffect(() => {
    const intervalId = window.setInterval(() => { void load() }, 30000)
    return () => window.clearInterval(intervalId)
  }, [load])

  // Use real-time events for live updates
  useEffect(() => {
    if (realtimeEvents.connected && realtimeEvents.events.length > 0) {
      setEntries(realtimeEvents.events.slice(0, 50))
    }
  }, [realtimeEvents.events, realtimeEvents.connected])

  const filtered = filter === 'Critical'
    ? entries.filter(e => e.riskLevel === 'critical')
    : entries

  return (
    <main className="workspace">
      <PageHead
        eyebrow={realtimeEvents.connected ? "LIVE MONITOR / REAL-TIME" : "LIVE MONITOR / 30S POLL"}
        title="Live Security Monitor"
        description="Every agent action, analyzed and decided at runtime."
        action={
          <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
            <Badge tone={error ? 'danger' : realtimeEvents.connected ? 'success' : 'success'}>{error ? '● BACKEND OFFLINE' : realtimeEvents.connected ? '● REAL-TIME ACTIVE' : '● SYSTEM OPERATIONAL'}</Badge>
            <button className="control-button secondary" onClick={load}><RefreshCw size={14} /></button>
          </div>
        }
      />

      <div className="filter-bar">
        {['All', 'Allowed', 'Review', 'Blocked', 'Critical'].map(x => (
          <button key={x} className={`filter-chip${filter === x ? ' active' : ''}`} onClick={() => setFilter(x)}>{x}</button>
        ))}
      </div>

      <Panel title="Security events" eyebrow={`${filtered.length} EVENTS`}>
        {loading && entries.length === 0 ? <Spinner /> : error ? (
          <p style={{ padding: '1rem', color: 'salmon' }}>⚠ {error} — make sure the backend is running on port 3000</p>
        ) : filtered.length === 0 ? (
          <p style={{ padding: '1rem', opacity: 0.5 }}>No events found</p>
        ) : (
          <div className="monitor-list">
            {filtered.map(e => (
              <div className={`monitor-row ${decisionTone(e.decision)}`} key={e.id}>
                <time>{fmt(e.createdAt)}</time>
                <strong>{e.agentId ?? '—'}</strong>
                <code>{e.tool}</code>
                <span>{e.riskLevel}</span>
                <Badge tone={decisionTone(e.decision) === 'block' ? 'danger' : decisionTone(e.decision) === 'review' ? 'warn' : 'success'}>
                  {e.decision.toUpperCase()}
                </Badge>
                <b>RISK {e.riskScore}</b>
              </div>
            ))}
          </div>
        )}
      </Panel>
    </main>
  )
}

// ─── Static pages (unchanged) ─────────────────────────────────────────────────
function ThreatTable({ compact = false }: { compact?: boolean }) {
  return (
    <div className={compact ? 'threat-list' : 'data-list'}>
      {staticThreats.map(([id, type, severity, agent, source, time]) => (
        <div className="threat-row" key={id}>
          <div className={`severity ${severity.toLowerCase()}`}><AlertTriangle size={14} /></div>
          <div><strong>{type}</strong><span>{id} · {agent} · {source}</span></div>
          <Badge tone={severity === 'CRITICAL' ? 'danger' : 'danger'}>{severity}</Badge>
          <time>{time}</time>
        </div>
      ))}
    </div>
  )
}

function AgentsPage({ setActive }: { setActive: (v: string) => void }) {
  const [selected, setSelected] = useState<string | null>(null)
  return (
    <main className="workspace">
      <PageHead
        eyebrow="AGENTS / RUNTIME INVENTORY"
        title="Agents"
        description="Manage and monitor AI agents protected by AgentShield."
        action={<Button onClick={() => setSelected('new')}><Plus size={14} /> Connect Agent</Button>}
      />
      {selected && (
        <div className="notice">
          <span>Agent connection workflow ready.</span>
          <button onClick={() => setSelected(null)}><X size={14} /></button>
        </div>
      )}
      <div className="agent-grid">
        {staticAgents.map(([name, status, risk, tools, actions]) => (
          <article className="agent-card" key={name} onClick={() => setSelected(name)}>
            <div className="card-top">
              <div className="agent-avatar"><Terminal size={18} /></div>
              <Badge tone={status === 'BLOCKED' ? 'danger' : status === 'IDLE' ? 'warn' : 'success'}>{status}</Badge>
            </div>
            <h2>{name}</h2>
            <div className="agent-risk">
              <span>RISK LEVEL</span>
              <strong className={risk === 'HIGH' ? 'danger' : risk === 'MEDIUM' ? 'warn' : 'success'}>{risk}</strong>
            </div>
            <div className="agent-stats">
              <span><b>{tools}</b> TOOLS</span>
              <span><b>{actions}</b> ACTIONS TODAY</span>
            </div>
            <button className="row-link">Open agent <ChevronRight size={14} /></button>
          </article>
        ))}
      </div>
      {selected && selected !== 'new' && (
        <Panel title={`${selected} / Security profile`} eyebrow="AGENT DETAIL">
          <div className="detail-grid">
            <div><span className="label">CONNECTED TOOLS</span><p>read_file · search_web · execute_command · write_file</p></div>
            <div><span className="label">PERMISSIONS</span><p>Filesystem read · Network review · Shell approval</p></div>
            <div><span className="label">RECENT DECISION</span><p><Badge tone="danger">BLOCKED</Badge> destructive shell command</p></div>
          </div>
        </Panel>
      )}
    </main>
  )
}

function Playground() {
  const { accessToken } = useAuth()
  const [result, setResult] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  async function runSim() {
    if (!accessToken) {
      setResult('Error: Not authenticated')
      return
    }

    setLoading(true)
    try {
      const res = await inspectToolCall({
        tool: 'execute_pwsh',
        args: { command: 'rm -rf ./src' },
        agentId: 'DevAgent',
      }, accessToken)
      setResult(`Decision: ${res.decision.toUpperCase()} · Score: ${res.riskScore} · ${res.message}`)
    } catch (e) {
      setResult(`Error: ${e instanceof Error ? e.message : 'Backend offline'}`)
    } finally {
      setLoading(false)
    }
  }

  return (
    <main className="workspace">
      <PageHead
        eyebrow="PLAYGROUND / POLICY SIMULATION"
        title="Agent Playground"
        description="Test agent actions and inspect every security decision in real time."
        action={<Button onClick={runSim}>{loading ? <Loader2 size={14} className="animate-spin" /> : <Play size={14} />} Run simulation</Button>}
      />
      {result && <div className="notice"><span>{result}</span></div>}
      <div className="playground-grid">
        <Panel title="Agent configuration" eyebrow="CONFIGURATION">
          <div className="form-stack">
            <label>AGENT<select><option>DevAgent</option></select></label>
            <label>MODEL<select><option>Qwen / Local Model</option></select></label>
            <label>SYSTEM INSTRUCTIONS<textarea defaultValue={'You are a coding assistant...'} /></label>
            <fieldset>
              <legend>TOOLS</legend>
              {['read_file', 'search_web', 'execute_command', 'write_file'].map(t => (
                <label className="check" key={t}><input type="checkbox" defaultChecked /> {t}</label>
              ))}
            </fieldset>
          </div>
        </Panel>
        <Panel title="Execution stream" eyebrow="LIVE AGENT EXECUTION">
          <div className="conversation">
            <div className="chat-line"><span>USER</span><p>Update the project dependencies.</p></div>
            <div className="chat-line agent"><span>AGENT</span><p>I will inspect package.json.</p></div>
            <div className="tool-call"><span>TOOL CALL</span><code>read_file(&quot;package.json&quot;)</code><Badge tone="success">ALLOWED · RISK 08</Badge></div>
            <div className="tool-call"><span>TOOL CALL</span><code>execute(&quot;npm install&quot;)</code><Badge tone="success">ALLOWED · RISK 18</Badge></div>
            <div className="tool-call blocked"><span>TOOL CALL</span><code>execute(&quot;rm -rf ./src&quot;)</code><Badge tone="danger">BLOCKED · RISK 96</Badge></div>
          </div>
        </Panel>
        <Panel title="96 / 100" eyebrow="SECURITY DECISION">
          <div className="decision-panel">
            <Badge tone="danger">BLOCK</Badge>
            <h3>High risk action intercepted</h3>
            <ul>
              <li>Destructive filesystem operation</li>
              <li>Irreversible action</li>
              <li>Outside permitted tool policy</li>
            </ul>
            <p>Suggested safer action: <strong>Remove only the obsolete files after confirming their paths.</strong></p>
            <div className="decision-actions">
              <Button>Allow Once</Button>
              <Button secondary>Block</Button>
              <Button secondary>Require Approval</Button>
            </div>
          </div>
        </Panel>
      </div>
    </main>
  )
}

function Workflows() {
  const steps = ['GitHub Pull Request', 'Code Agent', 'Prompt Injection Scan', 'Secret Detection', 'Tool Permission Check', 'Human Approval', 'Merge']
  return (
    <main className="workspace">
      <PageHead eyebrow="WORKFLOWS / ENFORCEMENT CHAINS" title="Secure Workflows" description="Build deterministic security gates around autonomous execution." action={<Button><Plus size={14} /> Create workflow</Button>} />
      <Panel title="Code Review Security" eyebrow="ACTIVE WORKFLOW">
        <div className="workflow">
          <span className="trigger">TRIGGER</span>
          {steps.map((s, i) => (
            <div className="workflow-step" key={s}>
              <span>{String(i + 1).padStart(2, '0')}</span>
              <strong>{s}</strong>
              <small>{i === 2 ? 'AI security scan' : i === 4 ? 'Permission gate' : i === 5 ? 'Human decision' : 'Connected step'}</small>
              {i < steps.length - 1 && <ChevronRight size={16} />}
            </div>
          ))}
        </div>
      </Panel>
    </main>
  )
}

function Policies() {
  const rows = [
    ['Destructive Commands', 'BLOCK', 'CRITICAL', 'All agents'],
    ['External Network Access', 'REVIEW', 'HIGH', 'ResearchAgent'],
    ['Secret Access', 'BLOCK', 'CRITICAL', 'All agents'],
    ['File System Write', 'REVIEW', 'MEDIUM', 'DevAgent'],
    ['Unknown Tools', 'BLOCK', 'HIGH', 'All agents'],
    ['Prompt Injection', 'BLOCK', 'CRITICAL', 'All agents'],
  ]
  return (
    <main className="workspace">
      <PageHead eyebrow="POLICIES / ENFORCEMENT ENGINE" title="Security Policies" description="The rules that decide what agents can do." action={<Button><Plus size={14} /> New policy</Button>} />
      <Panel title="Active policy set" eyebrow="6 POLICIES">
        <div className="policy-list">
          {rows.map(([name, action, severity, scope]) => (
            <div className="policy-row" key={name}>
              <div><strong>{name}</strong><span>{scope} · severity {severity}</span></div>
              <Badge tone={action === 'BLOCK' ? 'danger' : 'warn'}>{action}</Badge>
              <button className="toggle on" aria-label={`Toggle ${name}`}><i /></button>
              <Settings2 size={15} />
            </div>
          ))}
        </div>
      </Panel>
    </main>
  )
}

function ThreatsPage() {
  return (
    <main className="workspace">
      <PageHead eyebrow="THREATS / INVESTIGATION" title="Threat Intelligence" description="Investigate attacks and understand why AgentShield intervened." />
      <Panel title="Threat queue" eyebrow="3 ACTIVE INVESTIGATIONS">
        <div className="threat-table">
          <div className="table-head"><span>ID</span><span>TYPE</span><span>SEVERITY</span><span>AGENT</span><span>SOURCE</span><span>TIME</span></div>
          {staticThreats.map(t => (
            <div className="table-row" key={t[0]}>
              {t.map((x, i) => <span key={x}>{i === 2 ? <Badge tone="danger">{x}</Badge> : x}</span>)}
            </div>
          ))}
        </div>
      </Panel>
      <Panel title="Investigation notes" eyebrow="SELECT A THREAT">
        <div className="empty-investigation">
          <AlertTriangle size={24} />
          <p>Select a threat from the queue to inspect its payload, agent response, and recommended mitigation.</p>
        </div>
      </Panel>
    </main>
  )
}

function Evaluations() {
  const tests = ['Prompt Injection', 'Tool Abuse', 'Data Exfiltration', 'Privilege Escalation', 'Malicious Instructions', 'Unsafe Shell Commands', 'Unauthorized Network Access']
  return (
    <main className="workspace">
      <PageHead eyebrow="EVALUATIONS / ADVERSARIAL TESTING" title="Agent Evaluation" description="Run security tests against an agent before it reaches production." action={<Button><Play size={14} /> Run security evaluation</Button>} />
      <div className="evaluation-summary">
        <div><span>SECURITY SCORE</span><strong>94<small>/100</small></strong></div>
        <div><span>TESTS</span><b>42</b></div>
        <div><span>PASSED</span><b className="success">39</b></div>
        <div><span>BLOCKED ATTACKS</span><b className="success">37</b></div>
      </div>
      <Panel title="Technical results" eyebrow="LATEST RUN">
        <div className="policy-list">
          {tests.map((x, i) => (
            <div className="policy-row" key={x}>
              <div><strong>{x}</strong><span>Adversarial test suite / run #0042</span></div>
              <Badge tone={i === 2 ? 'warn' : 'success'}>{i === 2 ? '3 FAILED' : 'PASSED'}</Badge>
              <span className="muted">{i === 2 ? '72' : '100'}%</span>
            </div>
          ))}
        </div>
      </Panel>
    </main>
  )
}

function DemoRedirect() {
  if (typeof window !== 'undefined') window.location.href = '/demo'
  return null
}

function SettingsPage() {
  return (
    <main className="workspace">
      <PageHead eyebrow="SETTINGS / RUNTIME CONFIGURATION" title="Settings" description="Configure how AgentShield protects your agents." />
      <div className="settings-grid">
        <Panel title="Security controls" eyebrow="ENFORCEMENT">
          <div className="settings-list">
            {['Prompt Injection Detection', 'Tool Permission Enforcement', 'Secret Detection', 'Human Approval', 'Runtime Monitoring'].map(x => (
              <div key={x}><span>{x}</span><button className="toggle on" aria-label={`Toggle ${x}`}><i /></button></div>
            ))}
          </div>
        </Panel>
        <Panel title="Model runtime" eyebrow="PROVIDER">
          <div className="form-stack">
            <label>MODEL TYPE<select><option>Local / Open Weight</option></select></label>
            <label>PROVIDER<select><option>Ollama</option></select></label>
            <label>MODEL<select><option>Qwen</option></select></label>
          </div>
        </Panel>
      </div>
    </main>
  )
}

// ─── Root App ─────────────────────────────────────────────────────────────────
function App() {
  const [open, setOpen] = useState(false)
  const [active, setActive] = useState('Overview')

  const page =
    active === 'Overview'     ? <Overview /> :
    active === 'Agents'       ? <AgentsPage setActive={setActive} /> :
    active === 'Playground'   ? <Playground /> :
    active === 'Workflows'    ? <Workflows /> :
    active === 'Live Monitor' ? <MonitorPage /> :
    active === 'Threats'      ? <ThreatsPage /> :
    active === 'Policies'     ? <Policies /> :
    active === 'Approvals'    ? <ApprovalsPage /> :
    active === 'Evaluations'  ? <Evaluations /> :
    active === 'Demo'         ? <DemoRedirect /> :
    <SettingsPage />

  return (
    <div className="app">
      <Header open={open} setOpen={setOpen} />
      <Drawer open={open} setOpen={setOpen} active={active} setActive={setActive} />
      {page}
      <footer>
        <Logo />
        <span>Security infrastructure for autonomous AI.</span>
        <span>OPEN SOURCE · 2026</span>
      </footer>
    </div>
  )
}

export default function Page() {
  return (
    <ProtectedRoute>
      <App />
    </ProtectedRoute>
  )
}

export { Terminal }
