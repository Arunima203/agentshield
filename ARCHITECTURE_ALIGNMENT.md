# AgentShield Architecture Alignment Report

## Current Status: 70% Complete

Your AgentShield implementation is **mostly complete** but has a critical gap: **the LLM layer is built but disconnected from the backend**.

---

## What's Working ✅

### 1. **Backend Security Gateway** (Express)
- ✅ JWT authentication
- ✅ `/inspect` endpoint for tool call analysis
- ✅ `/approvals` endpoint for human-in-loop decisions
- ✅ `/audit` endpoint with query and stats
- ✅ CORS and security middleware

### 2. **Deterministic Risk Detection**
- ✅ Shell command heuristics (destructive patterns)
- ✅ File write detection (system paths, hidden files)
- ✅ Remote code execution patterns (curl|bash)
- ✅ Secret pattern matching and redaction
- ✅ Config-based tool risk scoring (YAML)

### 3. **Approval Queue & Audit Log**
- ✅ SQL.js database (in-memory + persistent)
- ✅ Approval request creation, resolution, timeout
- ✅ Audit trail with full details
- ✅ Configurable retention policies

### 4. **Frontend Dashboard**
- ✅ Login with JWT authentication
- ✅ Approval queue UI
- ✅ Audit log viewer
- ✅ Real-time risk metrics

### 5. **LLM Security Analysis Layer** (Python)
- ✅ `SecurityAnalyzer` class with async/sync methods
- ✅ Ollama client integration (Qwen 2.5 7B model)
- ✅ Semantic risk detection (prompt injection, instruction override, etc.)
- ✅ Structured JSON output with validation
- ✅ Fallback handling when Ollama unavailable
- ✅ System prompt with 15 security categories

---

## What's Missing ❌

### **CRITICAL: LLM Integration is Disconnected**

**The Problem:**
```
Current Flow:
  Tool Call → [Deterministic Rules] → Decision → Audit

Architecture Requires:
  Tool Call → [Deterministic + LLM Analysis] → Decision → Audit
```

**The Gap:**
- `backend/src/interceptor.ts` uses ONLY `riskDetector.ts` (deterministic)
- `llm/security_analyzer.py` exists but is NEVER CALLED
- No Python ↔ Node.js bridge exists
- Decision is 100% rule-based, 0% semantic

---

## The Architecture Flow (From Your Diagram)

```
┌─────────────────────────────────────────────────────────────────┐
│                     AGENTSHIELD ARCHITECTURE                    │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  User                                              ✓ Exists    │
│   ↓                                                             │
│  AI Agent (LangChain/CrewAI/custom)               ✗ Missing   │
│   ↓                                                             │
│  AgentShield SDK/Adapter                          ⚠ REST only │
│   ↓                                                             │
│  FastAPI Security Gateway                         ⚠ Express   │
│   ↓                                                             │
│  Normalize + Redact                               ✓ Partial   │
│   ↓                                                             │
│  Prompt Injection Detection + Deterministic Rules ⚠ Rules OK  │
│   ↓                                                             │
│  Policy Engine                                    ⚠ Static    │
│   ↓                                                             │
│  Open-Weight LLM (Ollama + Qwen)                  ✓ Built     │
│   ↓                                                             │
│  Risk Scoring Engine                              ⚠ Incomplete
│   ↓                                                             │
│  Decision Engine                                  ✓ Partial   │
│   ├─ ALLOW → Tool Execution Gateway               ✓          │
│   ├─ REVIEW → Human Approval → Tool Execution    ✓          │
│   └─ BLOCK → Stop action + Safe Alternative      ✓          │
│   ↓                                                             │
│  Audit/Event Service                              ✓ Works    │
│   └─ Database + WebSocket → React Live Monitor   ✓ Exists   │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

---

## Step-by-Step Action Plan

### Phase 1: Connect LLM to Backend (DO THIS FIRST)

#### Step 1.1: Start Ollama Server
```bash
# Install Ollama: https://ollama.ai
ollama serve

# In another terminal, pull the model:
ollama pull qwen2.5:7b
```

Verify it's working:
```bash
curl http://localhost:11434/api/status
# Should return: {"status": "success"}
```

#### Step 1.2: Create LLM Bridge in Backend

Create `backend/src/services/llmBridge.ts`:

```typescript
/**
 * Bridge between Node.js backend and Python LLM service.
 * Calls the security analyzer for semantic risk analysis.
 */

import fetch from 'node-fetch'
import { logger } from '../logger'

const LLM_SERVICE_URL = process.env.LLM_SERVICE_URL || 'http://localhost:5000'
const CTX = 'LLMBridge'

export interface LLMAnalysis {
  risk_score: number
  severity: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL'
  decision: 'ALLOW' | 'REVIEW' | 'BLOCK'
  categories: string[]
  reason: string
  confidence: number
}

export async function analyzWithLLM(
  tool: string,
  args: Record<string, unknown>,
  agentId: string = 'default'
): Promise<LLMAnalysis | null> {
  try {
    const response = await fetch(`${LLM_SERVICE_URL}/analyze`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ tool, args, agent_id: agentId }),
    })

    if (!response.ok) {
      logger.warn(CTX, `LLM service returned ${response.status}`)
      return null
    }

    return (await response.json()) as LLMAnalysis
  } catch (err) {
    logger.warn(CTX, `LLM unavailable: ${err instanceof Error ? err.message : String(err)}`)
    return null
  }
}
```

#### Step 1.3: Create Python LLM Service

Create `llm/server.py`:

```python
"""
FastAPI server exposing the SecurityAnalyzer via HTTP.
Bridges the Node.js backend with the Python LLM analysis layer.
"""

from fastapi import FastAPI
from fastapi.responses import JSONResponse
from pydantic import BaseModel
from typing import Dict, Any, Optional
import asyncio

from llm.security_analyzer import SecurityAnalyzer
from llm.config import LLMConfig

app = FastAPI()
analyzer = SecurityAnalyzer(config=LLMConfig())

class AnalyzeRequest(BaseModel):
    tool: str
    args: Dict[str, Any]
    agent_id: Optional[str] = "default"
    context: Optional[Dict[str, Any]] = None

@app.post("/analyze")
async def analyze(request: AnalyzeRequest):
    """Analyze a tool call for security risks using the LLM."""
    result = await analyzer.analyze_action(
        tool=request.tool,
        arguments=request.args,
        agent_id=request.agent_id,
        context=request.context,
    )
    return result.model_dump()

@app.get("/health")
async def health():
    """Health check endpoint."""
    status = analyzer.get_status()
    return {"status": "ok", "llm_available": status.get("available", False)}

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=5000)
```

Install dependencies:
```bash
cd llm
pip install fastapi uvicorn httpx
```

Run it:
```bash
python llm/server.py
# Server runs on http://localhost:5000
```

#### Step 1.4: Update Backend Interceptor

Modify `backend/src/interceptor.ts` to call LLM:

```typescript
// In inspect() function, after deterministic risk assessment:

// Get deterministic score
const riskAssessment = assessRisk({ ...toolCall, args: sanitizedArgs })

// GET LLM score (new)
let llmAnalysis = null
if (process.env.LLM_ENABLED !== 'false') {
  llmAnalysis = await analyzWithLLM(toolCall.tool, sanitizedArgs, toolCall.agentId)
}

// Combine scores
let finalScore = riskAssessment.riskScore
if (llmAnalysis) {
  // Weighted: 40% deterministic, 60% LLM
  finalScore = Math.round(
    riskAssessment.riskScore * 0.4 + llmAnalysis.risk_score * 0.6
  )
}

// Make decision based on combined score
const finalLevel = scoreToLevel(finalScore)
const finalDecision = makeDecision(finalScore)

// Log both scores in audit
// ... audit entry now includes both deterministic_score and llm_score
```

#### Step 1.5: Test End-to-End

```bash
# Terminal 1: Start backend
cd backend && npm start

# Terminal 2: Start Ollama
ollama serve

# Terminal 3: Start LLM service
cd llm && python server.py

# Terminal 4: Test it
curl -X POST http://localhost:3002/inspect \
  -H "Authorization: Bearer <token>" \
  -H "Content-Type: application/json" \
  -d '{
    "tool": "execute_pwsh",
    "args": {"command": "rm -rf /"},
    "agentId": "test"
  }'

# Response should show:
# - deterministic_score: 90 (destructive pattern)
# - llm_score: 95 (LLM detects dangerous intent)
# - final_score: 92
# - decision: "block"
# - reason includes both deterministic and LLM findings
```

---

### Phase 2: Create Python SDK for Agents (1 week)

Create `agentshield/__init__.py`:

```python
"""AgentShield SDK for AI agents (LangChain, CrewAI, etc.)"""

import httpx
from typing import Dict, Any, Optional, Literal

class AgentShield:
    def __init__(self, url: str = "http://localhost:3002", api_key: str = ""):
        self.url = url
        self.api_key = api_key
        self.client = httpx.Client(
            headers={"Authorization": f"Bearer {api_key}"}
        )
    
    def inspect_tool(
        self,
        tool: str,
        args: Dict[str, Any],
        agent_id: str = "default",
        context: Optional[Dict[str, Any]] = None,
    ) -> Dict[str, Any]:
        """Inspect a tool call before execution."""
        response = self.client.post(
            f"{self.url}/inspect",
            json={
                "tool": tool,
                "args": args,
                "agentId": agent_id,
                "metadata": context,
            },
        )
        response.raise_for_status()
        return response.json()

# Usage example:
if __name__ == "__main__":
    shield = AgentShield(url="http://localhost:3002")
    
    result = shield.inspect_tool(
        "execute_command",
        {"command": "ls -la"},
        agent_id="my_agent",
    )
    
    print(f"Decision: {result['decision']}")  # 'allow' or 'block' or 'require_approval'
    print(f"Risk Score: {result['riskScore']}")
```

---

## Your Current System Status

```
✅ WORKING:
  - Frontend dashboard with auth
  - Approval queue management
  - Audit trail
  - Deterministic risk scoring
  - Secrets detection and redaction

❌ NOT INTEGRATED:
  - LLM semantic analysis (built but unused)
  - Agent SDKs (no Python integration)
  - Policy engine (static YAML only)

⚠️ NEEDS WORK:
  - Production deployment (no Docker)
  - Multi-agent features (rate limiting, quotas)
  - Persistent database (SQLite only)
```

---

## What This Means for Your Project

**TODAY**: You have a working security gateway with deterministic rules.

**AFTER PHASE 1**: You'll have semantic + rule-based security analysis.

**AFTER PHASE 2**: Agents can easily integrate with a Python SDK.

The architecture diagram is achievable. The LLM integration is the key blocker holding it all together.

---

## Next Immediate Action

**Pick one:**

1. **Integrate LLM now** (recommended) — 2-3 hours to complete Phase 1
2. **Test current system** — Verify deterministic rules work end-to-end
3. **Set up Ollama** — Get the LLM model running locally
4. **Build Python SDK** — Make agents easy to integrate

Which would you like to tackle first?
