'use client'

import { useState } from 'react'
import { useAuth } from '@/app/contexts/auth'
import { ShieldCheck, Play, Check, X, Clock, AlertTriangle, Terminal, ArrowDown, Loader2 } from 'lucide-react'

// ─── Predefined tool scenarios ────────────────────────────────────────────────
const SCENARIOS = [
  {
    label: '✅ Safe — Read file',
    tool: 'read_file',
    args: { path: 'package.json' },
    agentId: 'DevAgent',
    description: 'Reading a config file — low risk',
  },
  {
    label: '✅ Safe — Web search',
    tool: 'remote_web_search',
    args: { query: 'latest React docs' },
    agentId: 'ResearchAgent',
    description: 'Simple web search — very low risk',
  },
  {
    label: '⚠️ Review — Web fetch',
    tool: 'web_fetch',
    args: { url: 'https://api.example.com/data' },
    agentId: 'ResearchAgent',
    description: 'External API call — medium risk, needs approval',
  },
  {
    label: '⚠️ Review — Delete file',
    tool: 'delete_file',
    args: { targetFile: 'config.json' },
    agentId: 'CodeAgent',
    description: 'File deletion — high risk, needs approval',
  },
  {
    label: '🚫 Block — Shell command',
    tool: 'execute_pwsh',
    args: { command: 'Get-ChildItem' },
    agentId: 'DevAgent',
    description: 'Shell execution — very high risk, blocked',
  },
  {
    label: '🚫 Block — Recursive delete',
    tool: 'execute_pwsh',
    args: { command: 'rm -rf ./src' },
    agentId: 'CodeAgent',
    description: 'Destructive command — blocked immediately',
  },
  {
    label: '🔐 Secret — API key leak',
    tool: 'fs_write',
    args: { path: 'config.txt', text: 'API_KEY=ghp_abc123xyz456secrettoken789' },
    agentId: 'DevAgent',
    description: 'Writing file with secret — secret redacted',
  },
]

type StepStatus = 'idle' | 'active' | 'done' | 'blocked'

interface PipelineStep {
  label: string
  detail: string
  status: StepStatus
}

interface Result {
  decision: string
  riskScore: number
  riskLevel: string
  message: string
  secretsDetected: boolean
  riskFindings: Array<{ rule: string; reason: string; score: number }>
  approvalRequestId?: string
}

const DECISION_COLOR: Record<string, string> = {
  allow: '#22c55e',
  block: '#ef4444',
  require_approval: '#f59e0b',
}

const DECISION_LABEL: Record<string, string> = {
  allow: '✅ ALLOW',
  block: '🚫 BLOCK',
  require_approval: '⚠️ REQUIRES APPROVAL',
}

export default function DemoPage() {
  const { accessToken } = useAuth()
  const [selected, setSelected] = useState(0)
  const [running, setRunning] = useState(false)
  const [steps, setSteps] = useState<PipelineStep[]>([])
  const [result, setResult] = useState<Result | null>(null)
  const [customTool, setCustomTool] = useState('')
  const [customArgs, setCustomArgs] = useState('{}')
  const [customAgent, setCustomAgent] = useState('MyAgent')
  const [useCustom, setUseCustom] = useState(false)

  const BASE_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3002'

  async function runDemo() {
    setRunning(true)
    setResult(null)

    const scenario = useCustom
      ? { tool: customTool, args: JSON.parse(customArgs || '{}'), agentId: customAgent }
      : SCENARIOS[selected]

    // Animate pipeline steps
    const pipeline: PipelineStep[] = [
      { label: '👤 User', detail: 'Request initiated', status: 'idle' },
      { label: '🤖 AI Agent', detail: `Agent: ${scenario.agentId}`, status: 'idle' },
      { label: '🛡️ AgentShield', detail: 'Intercepting tool call...', status: 'idle' },
      { label: '🔍 Validator', detail: 'Checking tool & args format', status: 'idle' },
      { label: '📋 Rule Engine', detail: 'Applying policy rules', status: 'idle' },
      { label: '🔐 Secret Scanner', detail: 'Scanning for secrets/PII', status: 'idle' },
      { label: '⚡ Risk Scorer', detail: 'Calculating risk score', status: 'idle' },
      { label: '⚖️ Decision Engine', detail: 'Making final decision', status: 'idle' },
    ]

    setSteps(pipeline.map(s => ({ ...s, status: 'idle' })))

    // Animate each step
    for (let i = 0; i < pipeline.length; i++) {
      await sleep(300)
      setSteps(prev => prev.map((s, idx) => ({
        ...s,
        status: idx === i ? 'active' : idx < i ? 'done' : 'idle',
      })))

      // Actually call backend at step 2 (AgentShield)
      if (i === 2) {
        try {
          const res = await fetch(`${BASE_URL}/inspect`, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
            },
            body: JSON.stringify({
              tool: scenario.tool,
              args: scenario.args,
              agentId: scenario.agentId,
            }),
          })
          const data = await res.json()
          // Store for later display
          ;(window as any).__agentshield_result = data
        } catch (e) {
          ;(window as any).__agentshield_result = { error: 'Backend offline' }
        }
      }
    }

    // Show result
    await sleep(400)
    const data: Result = (window as any).__agentshield_result

    if (data) {
      setResult(data)
      // Mark blocked steps if needed
      if (data.decision === 'block') {
        setSteps(prev => prev.map((s, idx) => ({
          ...s,
          status: idx < prev.length - 1 ? 'done' : 'blocked',
        })))
      } else {
        setSteps(prev => prev.map(s => ({ ...s, status: 'done' })))
      }
    }

    setRunning(false)
  }

  return (
    <div style={{ minHeight: '100vh', background: '#0a0a0a', color: '#e2e8f0', fontFamily: 'monospace', padding: '2rem' }}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '1rem', marginBottom: '2rem' }}>
        <ShieldCheck size={32} color="#3b82f6" />
        <div>
          <h1 style={{ fontSize: '1.8rem', fontWeight: 700, margin: 0 }}>AgentShield Demo</h1>
          <p style={{ margin: 0, opacity: 0.5, fontSize: '0.85rem' }}>Interactive pipeline — watch every tool call get inspected in real time</p>
        </div>
        <a href="/" style={{ marginLeft: 'auto', color: '#3b82f6', fontSize: '0.85rem', textDecoration: 'none' }}>← Back to Dashboard</a>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '2rem' }}>

        {/* Left — Scenario picker */}
        <div>
          <h2 style={{ fontSize: '1rem', opacity: 0.6, marginBottom: '1rem', textTransform: 'uppercase', letterSpacing: '0.1em' }}>1. Choose a Scenario</h2>

          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem', marginBottom: '1.5rem' }}>
            {SCENARIOS.map((s, i) => (
              <button
                key={i}
                onClick={() => { setSelected(i); setUseCustom(false) }}
                style={{
                  background: !useCustom && selected === i ? '#1e3a5f' : '#111',
                  border: !useCustom && selected === i ? '1px solid #3b82f6' : '1px solid #222',
                  borderRadius: '8px',
                  padding: '0.75rem 1rem',
                  color: '#e2e8f0',
                  cursor: 'pointer',
                  textAlign: 'left',
                  fontSize: '0.85rem',
                }}
              >
                <div style={{ fontWeight: 600 }}>{s.label}</div>
                <div style={{ opacity: 0.5, fontSize: '0.75rem', marginTop: '0.2rem' }}>{s.description}</div>
              </button>
            ))}
          </div>

          {/* Custom tool */}
          <div style={{ background: '#111', border: useCustom ? '1px solid #3b82f6' : '1px solid #222', borderRadius: '8px', padding: '1rem' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.75rem' }}>
              <input type="checkbox" checked={useCustom} onChange={e => setUseCustom(e.target.checked)} id="custom" />
              <label htmlFor="custom" style={{ fontWeight: 600, cursor: 'pointer' }}>🔧 Custom Tool Call</label>
            </div>
            {useCustom && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                <input
                  placeholder="Tool name (e.g. execute_pwsh)"
                  value={customTool}
                  onChange={e => setCustomTool(e.target.value)}
                  style={{ background: '#1a1a1a', border: '1px solid #333', borderRadius: '4px', padding: '0.5rem', color: '#e2e8f0', fontFamily: 'monospace', fontSize: '0.85rem' }}
                />
                <textarea
                  placeholder='Args JSON (e.g. {"command": "ls"})'
                  value={customArgs}
                  onChange={e => setCustomArgs(e.target.value)}
                  rows={3}
                  style={{ background: '#1a1a1a', border: '1px solid #333', borderRadius: '4px', padding: '0.5rem', color: '#e2e8f0', fontFamily: 'monospace', fontSize: '0.85rem', resize: 'vertical' }}
                />
                <input
                  placeholder="Agent ID (e.g. MyAgent)"
                  value={customAgent}
                  onChange={e => setCustomAgent(e.target.value)}
                  style={{ background: '#1a1a1a', border: '1px solid #333', borderRadius: '4px', padding: '0.5rem', color: '#e2e8f0', fontFamily: 'monospace', fontSize: '0.85rem' }}
                />
              </div>
            )}
          </div>

          {/* Run button */}
          <button
            onClick={runDemo}
            disabled={running || (useCustom && !customTool)}
            style={{
              marginTop: '1.5rem',
              width: '100%',
              background: running ? '#1e3a5f' : '#3b82f6',
              border: 'none',
              borderRadius: '8px',
              padding: '1rem',
              color: 'white',
              fontWeight: 700,
              fontSize: '1rem',
              cursor: running ? 'not-allowed' : 'pointer',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: '0.5rem',
            }}
          >
            {running ? <><Loader2 size={18} className="animate-spin" /> Running...</> : <><Play size={18} /> Run Through AgentShield</>}
          </button>
        </div>

        {/* Right — Pipeline + Result */}
        <div>
          <h2 style={{ fontSize: '1rem', opacity: 0.6, marginBottom: '1rem', textTransform: 'uppercase', letterSpacing: '0.1em' }}>2. Pipeline Execution</h2>

          {/* Pipeline steps */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.4rem', marginBottom: '1.5rem' }}>
            {steps.length === 0 ? (
              <div style={{ opacity: 0.3, textAlign: 'center', padding: '2rem' }}>Click "Run" to see the pipeline execute</div>
            ) : steps.map((step, i) => (
              <div key={i} style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
                {/* Icon */}
                <div style={{
                  width: 28, height: 28, borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
                  background: step.status === 'done' ? '#166534' : step.status === 'active' ? '#1e3a5f' : step.status === 'blocked' ? '#7f1d1d' : '#1a1a1a',
                  border: step.status === 'active' ? '2px solid #3b82f6' : step.status === 'blocked' ? '2px solid #ef4444' : '2px solid #333',
                  transition: 'all 0.3s',
                }}>
                  {step.status === 'done' && <Check size={14} color="#22c55e" />}
                  {step.status === 'active' && <Loader2 size={14} color="#3b82f6" className="animate-spin" />}
                  {step.status === 'blocked' && <X size={14} color="#ef4444" />}
                  {step.status === 'idle' && <span style={{ fontSize: '0.6rem', opacity: 0.4 }}>{i + 1}</span>}
                </div>

                {/* Label */}
                <div style={{ flex: 1 }}>
                  <div style={{ fontWeight: step.status === 'active' ? 700 : 400, fontSize: '0.9rem', color: step.status === 'blocked' ? '#ef4444' : '#e2e8f0' }}>{step.label}</div>
                  <div style={{ fontSize: '0.7rem', opacity: 0.4 }}>{step.detail}</div>
                </div>

                {/* Arrow */}
                {i < steps.length - 1 && (
                  <ArrowDown size={12} style={{ opacity: 0.2, flexShrink: 0 }} />
                )}
              </div>
            ))}
          </div>

          {/* Result card */}
          {result && (
            <div style={{
              background: '#0f1923',
              border: `2px solid ${DECISION_COLOR[result.decision] ?? '#333'}`,
              borderRadius: '12px',
              padding: '1.5rem',
            }}>
              {/* Decision */}
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '1rem' }}>
                <span style={{ fontSize: '1.3rem', fontWeight: 800, color: DECISION_COLOR[result.decision] }}>
                  {DECISION_LABEL[result.decision] ?? result.decision.toUpperCase()}
                </span>
                <span style={{
                  background: '#1a1a1a', border: '1px solid #333', borderRadius: '6px',
                  padding: '0.25rem 0.75rem', fontSize: '0.8rem',
                }}>
                  RISK SCORE: <strong style={{ color: result.riskScore >= 70 ? '#ef4444' : result.riskScore >= 40 ? '#f59e0b' : '#22c55e' }}>{result.riskScore}/100</strong>
                </span>
              </div>

              {/* Message */}
              <p style={{ margin: '0 0 1rem', opacity: 0.7, fontSize: '0.85rem' }}>{result.message}</p>

              {/* Secrets */}
              {result.secretsDetected && (
                <div style={{ background: '#2d1515', border: '1px solid #7f1d1d', borderRadius: '6px', padding: '0.5rem 0.75rem', marginBottom: '0.75rem', fontSize: '0.8rem', color: '#fca5a5' }}>
                  🔐 Secret detected in arguments — redacted from logs
                </div>
              )}

              {/* Approval */}
              {result.approvalRequestId && (
                <div style={{ background: '#1c1a0a', border: '1px solid #92400e', borderRadius: '6px', padding: '0.5rem 0.75rem', marginBottom: '0.75rem', fontSize: '0.8rem', color: '#fde68a' }}>
                  ⏳ Queued for human approval — check the Approvals page
                </div>
              )}

              {/* Risk findings */}
              {result.riskFindings?.length > 0 && (
                <div>
                  <div style={{ fontSize: '0.75rem', opacity: 0.5, marginBottom: '0.5rem', textTransform: 'uppercase' }}>Risk Findings</div>
                  {result.riskFindings.map((f, i) => (
                    <div key={i} style={{ display: 'flex', gap: '0.5rem', fontSize: '0.75rem', marginBottom: '0.3rem', alignItems: 'flex-start' }}>
                      <AlertTriangle size={12} color="#f59e0b" style={{ flexShrink: 0, marginTop: 2 }} />
                      <span style={{ opacity: 0.8 }}><strong>{f.rule}</strong> — {f.reason} <span style={{ opacity: 0.5 }}>(+{f.score})</span></span>
                    </div>
                  ))}
                </div>
              )}

              {/* Next step */}
              <div style={{ marginTop: '1rem', paddingTop: '1rem', borderTop: '1px solid #222', fontSize: '0.8rem', opacity: 0.6 }}>
                {result.decision === 'allow' && '✅ Tool execution proceeds in sandbox'}
                {result.decision === 'block' && '🚫 Tool execution stopped — no action taken'}
                {result.decision === 'require_approval' && '⚠️ Waiting for human approval before execution'}
              </div>
            </div>
          )}
        </div>
      </div>

      {/* How to integrate section */}
      <div style={{ marginTop: '3rem', background: '#0f0f0f', border: '1px solid #1a1a1a', borderRadius: '12px', padding: '2rem' }}>
        <h2 style={{ fontSize: '1rem', opacity: 0.6, marginBottom: '1.5rem', textTransform: 'uppercase', letterSpacing: '0.1em' }}>3. How to Integrate AgentShield in Your AI Agent</h2>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1.5rem' }}>
          <div>
            <div style={{ fontSize: '0.8rem', color: '#3b82f6', marginBottom: '0.5rem' }}>Python / LangChain</div>
            <pre style={{ background: '#0a0a0a', border: '1px solid #222', borderRadius: '8px', padding: '1rem', fontSize: '0.75rem', overflow: 'auto', color: '#86efac' }}>
{`import requests

def safe_tool_call(tool, args, agent_id):
    # Ask AgentShield first
    res = requests.post(
        "http://localhost:3002/inspect",
        json={
            "tool": tool,
            "args": args,
            "agentId": agent_id
        }
    )
    data = res.json()
    
    if data["decision"] == "allow":
        return execute_tool(tool, args)
    elif data["decision"] == "block":
        return {"error": data["message"]}
    else:
        # Wait for human approval
        return {"pending": data["approvalRequestId"]}`}
            </pre>
          </div>
          <div>
            <div style={{ fontSize: '0.8rem', color: '#3b82f6', marginBottom: '0.5rem' }}>JavaScript / TypeScript</div>
            <pre style={{ background: '#0a0a0a', border: '1px solid #222', borderRadius: '8px', padding: '1rem', fontSize: '0.75rem', overflow: 'auto', color: '#86efac' }}>
{`async function safeToolCall(tool, args, agentId) {
  // Ask AgentShield first
  const res = await fetch(
    "http://localhost:3002/inspect",
    {
      method: "POST",
      headers: {"Content-Type": "application/json"},
      body: JSON.stringify({ tool, args, agentId })
    }
  )
  const data = await res.json()

  if (data.decision === "allow") {
    return executeTool(tool, args)
  } else if (data.decision === "block") {
    throw new Error(data.message)
  } else {
    // Pending approval
    return { pending: data.approvalRequestId }
  }
}`}
            </pre>
          </div>
        </div>
      </div>
    </div>
  )
}

function sleep(ms: number) {
  return new Promise(resolve => setTimeout(resolve, ms))
}
