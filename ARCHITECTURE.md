# AgentShield Architecture

Complete visual architecture of the LLM-integrated system.

## System Architecture Diagram

```
┌─────────────────────────────────────────────────────────────────────────┐
│                            Your AI Agent                                 │
│                     (Kiro, Claude, ChatGPT, etc.)                        │
└────────────────────────┬────────────────────────────────────────────────┘
                         │
                         │ Tool Call Request
                         │ (tool, args, agent_id, context)
                         │
                         ▼
         ┌───────────────────────────────────┐
         │   AgentShield Backend Server      │
         │      (Node.js Express)            │
         │        :5000                      │
         │                                   │
         │  ┌─────────────────────────────┐  │
         │  │  /inspect endpoint          │  │
         │  └───────────┬─────────────────┘  │
         └──────────────┼──────────────────┘
                        │
         ┌──────────────┴──────────────┐
         │                             │
         ▼                             ▼
    ┌─────────────────────────┐   ┌──────────────────────────┐
    │ Secrets Scanner         │   │ Risk Assessment          │
    │ ──────────────────────  │   │ ────────────────────────  │
    │ • Pattern matching      │   │ • Base tool score        │
    │ • Regex on arguments    │   │ • Heuristic checks       │
    │ • Redact before LLM     │   │ • Accumulate findings    │
    │ • Log discoveries       │   │ • Final: 0-100 score     │
    └───────┬─────────────────┘   └────────────┬─────────────┘
            │                                  │
            └──────────────┬───────────────────┘
                           │
              Deterministic Score (0-100)
                           │
                           ▼
         ┌────────────────────────────────┐
         │   LLM Service Client           │
         │   (llmService.ts)              │
         │                                │
         │ • Health checks                │
         │ • Availability cooldown        │
         │ • Error recovery               │
         │ • HTTP client (axios)          │
         └────────────┬───────────────────┘
                      │
                      │ HTTP POST /analyze
                      │ {
                      │   tool: "execute_pwsh",
                      │   arguments: {...},    # REDACTED
                      │   agent_id: "...",
                      │   context: {...}
                      │ }
                      │
                      ▼
         ┌────────────────────────────────────────┐
         │   FastAPI LLM Service                  │
         │   (fastapi_server.py)                  │
         │        :8000                          │
         │                                       │
         │  ┌──────────────────────────────────┐ │
         │  │  POST /analyze                   │ │
         │  │  • Request validation            │ │
         │  │  • Initialize SecurityAnalyzer  │ │
         │  │  • Call LLM                     │ │
         │  │  • Parse response               │ │
         │  │  • Return JSON                  │ │
         │  └──────────────────────────────────┘ │
         │                                       │
         │  ┌──────────────────────────────────┐ │
         │  │  Health Check & Status           │ │
         │  │  • Monitor Ollama               │ │
         │  │  • Track availability           │ │
         │  │  • Graceful degradation         │ │
         │  └──────────────────────────────────┘ │
         └────────────┬─────────────────────────┘
                      │
                      ▼
         ┌────────────────────────────────────────┐
         │   SecurityAnalyzer                     │
         │   (security_analyzer.py)               │
         │                                       │
         │  • Parse & validate LLM response    │
         │  • Create SecurityAnalysis object   │
         │  • Error recovery                  │
         │  • Return structured output        │
         └────────────┬─────────────────────────┘
                      │
                      ▼
         ┌────────────────────────────────────────┐
         │   Ollama LLM Runtime                   │
         │        :11434                         │
         │                                       │
         │  ┌──────────────────────────────────┐ │
         │  │  Model: qwen2.5:7b (or other)  │ │
         │  │  • Prompt: SYSTEM_SECURITY_... │ │
         │  │  • User: tool + args analysis  │ │
         │  │  • Output: JSON evaluation     │ │
         │  │  • Return: Risk score + reason │ │
         │  └──────────────────────────────────┘ │
         │                                       │
         └────────────┬─────────────────────────┘
                      │
        LLM Security Analysis (0-100)
                      │
         ┌────────────┴──────────────┐
         │                           │
         ▼                           ▼
    risk_score: 85              categories: [...]
    decision: "BLOCK"            reason: "..."
    confidence: 0.95             severity: "CRITICAL"
         │                           │
         └───────────────┬───────────┘
                         │
         ┌───────────────▼────────────────┐
         │   Score Combination            │
         │   final_score =                │
         │   det × 0.60 + llm × 0.40      │
         │                                │
         │   (80 × 0.60) + (85 × 0.40)    │
         │   = 48 + 34 = 82               │
         │                                │
         │   → Decision: REVIEW (82)      │
         └───────────────┬────────────────┘
                         │
         ┌───────────────▼───────────────────┐
         │   Decision Logic                  │
         │   ────────────────────────────    │
         │   Score → Thresholds:             │
         │   • < 30   → ALLOW                │
         │   • 30-84  → REVIEW               │
         │   • 85-100 → BLOCK                │
         └───────────────┬───────────────────┘
                         │
         ┌───────────────┼───────────────┐
         │               │               │
         ▼               ▼               ▼
      ALLOW          REVIEW           BLOCK
      (auto)         (queue)           (auto)
       │               │               │
       │               ▼               │
       │        Approval Request       │
       │        • Notify user          │
       │        • Queue for approval   │
       │        • Wait for decision    │
       │               │               │
       ▼               ▼               ▼
   ┌─────────────────────────────────────┐
   │   Approval Gate                     │
   │   ─────────────────────────────     │
   │   • Create approval request         │
   │   • Store in database               │
   │   • Notify approvers                │
   │   • Wait for approval or timeout    │
   └─────────────────────────────────────┘
       │
       ▼
   ┌─────────────────────────────────────┐
   │   Audit Logger                      │
   │   ─────────────────────────────     │
   │   • Tool call details               │
   │   • Deterministic findings          │
   │   • LLM analysis result             │
   │   • Combined score & sources        │
   │   • Final decision                  │
   │   • Approval status                 │
   │   • Timestamp & agent ID            │
   └─────────────────────────────────────┘
       │
       ▼
   ┌─────────────────────────────────────┐
   │   Database                          │
   │   ─────────────────────────────     │
   │   • audit_log table                 │
   │   • approval_request table          │
   │   • user_decision table             │
   └─────────────────────────────────────┘
       │
       ▼
   ┌─────────────────────────────────────┐
   │   Response to Agent                 │
   │   ─────────────────────────────     │
   │   {                                 │
   │     "decision": "ALLOW",            │
   │     "riskScore": 82,                │
   │     "riskLevel": "high",            │
   │     "message": "...",               │
   │     "llmAnalysis": {...},           │
   │     "scoreSources": [               │
   │       "deterministic",              │
   │       "llm_semantic"                │
   │     ]                               │
   │   }                                 │
   └─────────────────────────────────────┘
       │
       ▼
   Agent execution continues
   (or blocked/queued for approval)
```

## Data Flow Diagram

```
INPUT
  │
  ├─ tool: string
  ├─ args: {key: value, ...}
  ├─ agentId: string
  └─ context: {key: value, ...}
  │
  ▼
[SECRETS SCANNER]
  │
  ├─ Find patterns in args
  ├─ Redact discovered secrets
  ├─ Store findings
  └─ Return sanitized_args
  │
  ▼
[DETERMINISTIC RISK ASSESSMENT]
  │
  ├─ Base tool score (10-80)
  ├─ Apply heuristic checks
  ├─ Domain allowlist (if applicable)
  ├─ File path analysis
  ├─ Command pattern matching
  └─ Sum findings → det_score (0-100)
  │
  ├─ PARALLEL ────────────────────┐
  │                               │
  ▼                               ▼
[LLM ANALYSIS REQUEST]      [PARALLEL: Keep det_score]
  │
  ├─ Create LLM service client
  ├─ Check Ollama availability
  ├─ POST to /analyze
  │  {
  │    tool,
  │    arguments: sanitized_args,  ← REDACTED!
  │    agent_id,
  │    context
  │  }
  │
  ▼
[OLLAMA LLM INFERENCE]
  │
  ├─ Load model (if not cached)
  ├─ Execute prompt:
  │  - System: SYSTEM_SECURITY_PROMPT
  │  - User: build_user_prompt(...)
  ├─ Parse JSON response
  └─ Return: risk_score, decision, categories, reason, confidence
  │
  ▼
[SCORE COMBINATION]
  │
  ├─ det_score (from det. analysis)
  ├─ llm_score (from LLM analysis)
  ├─ Combine: final = (det × 0.60) + (llm × 0.40)
  └─ Clamp to [0, 100]
  │
  ▼
[DECISION LOGIC]
  │
  ├─ Check blocked patterns (hard block)
  ├─ Check approval mode (auto/strict/audit)
  ├─ Compare final_score to thresholds
  ├─ Determine decision (allow/review/block)
  └─ Determine approval status
  │
  ▼
[APPROVAL GATE]
  │
  ├─ If review_needed:
  │  ├─ Create ApprovalRequest
  │  ├─ Insert to database
  │  ├─ Notify approvers
  │  └─ decision = "require_approval"
  │
  ├─ Else if allow:
  │  ├─ Create ApprovalRequest (for audit)
  │  ├─ Auto-approve
  │  └─ decision = "allow"
  │
  └─ Else if block:
     ├─ Create ApprovalRequest (for audit)
     ├─ Auto-block
     └─ decision = "block"
  │
  ▼
[AUDIT LOGGER]
  │
  ├─ Record tool call
  ├─ Record both scores
  ├─ Record findings (det + LLM)
  ├─ Record decision
  ├─ Record approval status
  ├─ Record sources (deterministic + llm)
  └─ Write to database
  │
  ▼
OUTPUT
  {
    "toolCallId": uuid,
    "decision": "allow" | "require_approval" | "block",
    "riskScore": 0-100,
    "riskLevel": "safe" | "low" | "medium" | "high" | "critical",
    "message": "Human-readable message",
    "llmAnalysis": {
      "risk_score": 0-100,
      "decision": "ALLOW" | "REVIEW" | "BLOCK",
      "severity": "LOW" | "MEDIUM" | "HIGH" | "CRITICAL",
      "categories": ["category1", "category2", ...],
      "reason": "Detailed explanation",
      "confidence": 0.0-1.0,
      "model": "qwen2.5:7b",
      "llm_available": true
    },
    "scoreSources": ["deterministic", "llm_semantic"]
  }
```

## Component Interaction Diagram

```
┌─────────────────┐
│ Agent           │
│ (Kiro/Claude)   │
└────────┬────────┘
         │ call_tool()
         │
         ▼
┌──────────────────────────────────┐
│ Backend Server                   │ ◄────┐
│ ├─ /inspect endpoint            │      │
│ ├─ SecretsScanner               │      │
│ ├─ RiskDetector                 │      │
│ ├─ Interceptor                  │      │
│ ├─ ApprovalGate                 │      │
│ └─ AuditLogger                  │      │
└─────────┬──────────────┬─────────┘      │
          │              │                 │
   [Health Check]  [Analyze Request]       │
          │              │                 │
          ▼              ▼                 │
┌──────────────────────────────────┐      │
│ LLM Service (FastAPI)            │      │
│ ├─ /health endpoint              │      │
│ ├─ /analyze endpoint             │      │
│ └─ /status endpoint              │      │
└─────────┬──────────────┬─────────┘      │
          │              │                 │
    [Ollama Check]  [SecurityAnalyzer]     │
          │              │                 │
          ▼              ▼                 │
┌──────────────────────────────────┐      │
│ Ollama (LLM Runtime)             │      │
│ ├─ API: localhost:11434          │      │
│ ├─ Model: qwen2.5:7b             │      │
│ └─ Inference Engine              │      │
└─────────┬──────────────┬─────────┘      │
          │              │                 │
    [Status OK]    [Risk Analysis]         │
          │              │                 │
          └──────┬───────┘                 │
                 │ Response                 │
                 │ (risk_score, decision)   │
                 │                          │
                 └──────────────────────────┘
```

## Error Handling & Fallback Flow

```
Tool Call Request
    │
    ▼
Try Deterministic Analysis
    │
    ├─ Success ─┐
    │           │
    ├─ Error ──→ Log & Continue
    │           │
    ▼           │
Try LLM Analysis│
    │           │
    ├─ Ollama Available?
    │    │
    │    ├─ YES ─┐
    │    │       │
    │    │       ├─ Try LLM Call
    │    │       │    │
    │    │       │    ├─ Success ─┐
    │    │       │    │           │
    │    │       │    ├─ Error ──→ Log, Mark unavailable
    │    │       │    │           │
    │    │       │    ▼           │
    │    │       │ Use Fallback   │
    │    │       │ (null score)   │
    │    │       │                │
    │    │       ◄────────────────┘
    │    │
    │    └─ NO ──→ Skip LLM, Use Fallback
    │            (null score)
    │
    ▼
Combine Scores
  │
  ├─ det_score × 0.60
  │ (always available)
  │
  ├─ llm_score × 0.40
  │ (null if LLM unavailable)
  │
  ▼
Decision Logic
  │
  ├─ (uses only det_score if llm_score is null)
  │
  ▼
Response
  {
    "decision": "allow|review|block",
    "riskScore": 0-100,
    "llmAnalysis": {
      "llm_available": true|false,
      ...
    }
  }
```

## State Machine: Decision Logic

```
┌─────────────────────────────────────────────────┐
│ Evaluate Tool Call                              │
└──────────────────┬──────────────────────────────┘
                   │
                   ▼
        ┌──────────────────────┐
        │ Check Blocked Pattern│
        └──────────┬───────────┘
                   │
         ┌─────────┴────────────┐
         │                      │
         YES                    NO
         │                      │
         ▼                      ▼
      BLOCK              ┌──────────────────┐
         │               │ Check Approval   │
         │               │ Mode             │
         │               └────────┬─────────┘
         │                        │
         │               ┌────────┼────────┐
         │               │        │        │
         │            AUDIT    STRICT   AUTO
         │               │        │        │
         │               ▼        ▼        ▼
         │            ALLOW  REQUIRE   ┌──────────┐
         │                          │   │Compare   │
         │                          │   │Score to  │
         │                          │   │Threshold│
         │                          │   └────┬─────┘
         │                          │        │
         │                          │   ┌────┴───────┐
         │                          │   │             │
         │                          │ < BLOCK      >= REVIEW
         │                          │ THRESHOLD    THRESHOLD
         │                          │   │             │
         │                          │   ▼             ▼
         │                          │  BLOCK      ┌────────┐
         │                          │             │Compare │
         │                          │             │to Review│
         │                          │             │Threshold
         │                          │             └────┬──┘
         │                          │                  │
         │                          │          ┌───────┴──────┐
         │                          │          │              │
         │                          │      >= REVIEW      < REVIEW
         │                          │      THRESHOLD      THRESHOLD
         │                          │          │              │
         │                          │          ▼              ▼
         │                          └─→  REQUIRE APPROVAL  ALLOW
         │
         ▼
     ┌─────────────────────────────────────┐
     │ Execute Decision                    │
     │ • Create Approval Request (if needed)
     │ • Log to Audit Trail                │
     │ • Return Response                   │
     └─────────────────────────────────────┘
```

## Database Schema

```
┌─────────────────────────────────┐
│      audit_log                  │
├─────────────────────────────────┤
│ id (UUID, PK)                   │
│ toolCallId (UUID, FK)           │
│ tool (string)                   │
│ agentId (string)                │
│ sessionId (string)              │
│ riskScore (int)                 │
│ riskLevel (string)              │
│ decision (ENUM)                 │
│ approvalStatus (ENUM)           │
│ riskFindings (JSON)             │
│ secretFindings (JSON)           │
│ sanitizedArgsSnapshot (JSON)    │
│ createdAt (timestamp)           │
│ resolvedAt (timestamp)          │
└─────────────────────────────────┘
         │
         │ references
         │
         ▼
┌─────────────────────────────────┐
│   approval_request              │
├─────────────────────────────────┤
│ id (UUID, PK)                   │
│ toolCallId (UUID, FK)           │
│ toolCall (JSON)                 │
│ inspection (JSON)               │
│ status (ENUM)                   │
│ createdAt (timestamp)           │
│ resolvedAt (timestamp)          │
│ resolvedBy (string)             │
│ rejectionReason (text)          │
│ timeoutMs (int)                 │
└─────────────────────────────────┘
         │
         │ references
         │
         ▼
┌─────────────────────────────────┐
│    user_decision                │
├─────────────────────────────────┤
│ id (UUID, PK)                   │
│ requestId (UUID, FK)            │
│ userId (string)                 │
│ approved (boolean)              │
│ rejectionReason (text)          │
│ decidedAt (timestamp)           │
└─────────────────────────────────┘
```

## Configuration Hierarchy

```
┌─────────────────────────────────────────┐
│ Environment Variables (Highest Priority)│
├─────────────────────────────────────────┤
│ APPROVAL_MODE=auto                      │
│ ENABLE_LLM=true                         │
│ LLM_API_URL=http://127.0.0.1:8000       │
│ OLLAMA_BASE_URL=http://localhost:11434  │
│ OLLAMA_MODEL=qwen2.5:7b                 │
└─────────────────────────────────────────┘
             │
             ▼ (if not set in env)
┌─────────────────────────────────────────┐
│ .env Files (Default Overrides)          │
├─────────────────────────────────────────┤
│ backend/.env                            │
│ llm/.env                                │
└─────────────────────────────────────────┘
             │
             ▼ (if not set)
┌─────────────────────────────────────────┐
│ Configuration Files                     │
├─────────────────────────────────────────┤
│ backend/agentshield.config.yaml         │
│ llm/config.py (LLMConfig class)         │
└─────────────────────────────────────────┘
             │
             ▼ (if not set)
┌─────────────────────────────────────────┐
│ Built-in Defaults                       │
├─────────────────────────────────────────┤
│ APPROVAL_MODE: "auto"                   │
│ ENABLE_LLM: true                        │
│ LLM_API_PORT: 8000                      │
│ LLM_API_HOST: 127.0.0.1                 │
│ OLLAMA_MODEL: "qwen2.5:7b"              │
│ OLLAMA_TIMEOUT: 60                      │
│ LLM_TEMPERATURE: 0                      │
└─────────────────────────────────────────┘
```

---

See other documentation files for:
- Setup instructions: `QUICKSTART_LLM.md`
- Complete guide: `LLM_INTEGRATION_GUIDE.md`
- Implementation details: `LLM_IMPLEMENTATION_SUMMARY.md`
- Deployment options: `DEPLOYMENT_GUIDE.md`
