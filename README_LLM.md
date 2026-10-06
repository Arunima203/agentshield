# AgentShield LLM Integration

Your AI agent security system now analyzes both **rules AND semantics**. 🛡️

## What Is This?

AgentShield is a security layer that sits between your AI agent and its tools. It inspects every action before execution and decides: **ALLOW**, **REQUIRE APPROVAL**, or **BLOCK**.

Now with **LLM-powered semantic analysis**, AgentShield combines:
- ✅ **Deterministic Rules** (60%): Pattern matching, heuristics, blocklists
- ✅ **LLM Semantics** (40%): Intent detection, context understanding, AI-driven analysis

Together, they create a powerful dual-layer defense system.

---

## Quick Start (5 minutes)

### 1. Install Ollama

Download from [ollama.ai](https://ollama.ai) and run the installer.

Then pull the model:
```bash
ollama pull qwen2.5:7b
```

### 2. Start Three Services

```bash
# Terminal 1: Ollama
ollama serve

# Terminal 2: Python LLM API
cd llm
pip install fastapi uvicorn pydantic python-dotenv
python -m fastapi_server

# Terminal 3: Node.js Backend
cd backend
npm install  # if needed
npm run dev
```

### 3. Test It

```bash
# Run e2e tests (verifies everything works)
npx ts-node e2e-test.ts

# Or make a request
curl -X POST http://localhost:5000/inspect \
  -H "Content-Type: application/json" \
  -d '{
    "tool": "execute_pwsh",
    "args": {"command": "rm -rf /important/data"},
    "agentId": "test"
  }'

# Response: {"decision": "block", "riskScore": 92, ...}
```

That's it! 🎉

---

## How It Works

```
Agent: "Execute this command"
         │
         ▼
Backend Analyzes:
  • Deterministic Rules: Score = 80
    (recursive delete detected)
  • LLM Semantic: Score = 95
    (LLM detects malicious intent)
  • Combined: (80 × 0.60) + (95 × 0.40) = 87
         │
         ▼
Decision: BLOCK (87 > 85 threshold)
```

The LLM understands **context** and **intent**, complementing the rule-based system.

---

## Key Features

### 🎯 Dual Analysis
- Rules for fast, predictable decisions
- LLM for understanding complex contexts
- Weighted combination for balanced results

### 🛡️ Safety First
- Secrets redacted before LLM analysis
- Graceful fallback if LLM unavailable
- Full audit trail of both scores

### ⚡ Performance
- 600-2000ms total decision time
- Non-blocking async LLM calls
- Works offline (Ollama local)

### 📊 Visibility
- Logs both scores and sources
- JSON structured responses
- Clear approval workflows

### 🚀 Production Ready
- Type-safe TypeScript + Python
- Comprehensive error handling
- Deployment guides included
- Kubernetes-ready

---

## Files & Documentation

### Quick Start
- **`QUICKSTART_LLM.md`** ← Start here (5 min setup)

### Setup & Configuration
- **`LLM_INTEGRATION_GUIDE.md`** - Complete setup guide
- **`DEPLOYMENT_GUIDE.md`** - Production deployment
- **`ARCHITECTURE.md`** - System design diagrams

### Implementation Details
- **`LLM_IMPLEMENTATION_SUMMARY.md`** - What was built
- **`IMPLEMENTATION_CHECKLIST.md`** - Feature checklist

### Code
- **`llm/fastapi_server.py`** - LLM service wrapper
- **`backend/src/llmService.ts`** - Backend LLM client
- **`backend/src/interceptor.ts`** - Enhanced inspection pipeline

### Tests
- **`e2e-test.ts`** - TypeScript e2e tests
- **`llm/e2e_test.py`** - Python LLM tests

---

## Architecture At a Glance

```
Your Agent
    │
    ▼
┌─────────────────┐
│ Backend :5000   │  Secrets → Deterministic (60%)
│ - Secrets scan  │           ↓
│ - Rules         ├──────────→ LLM Analysis (40%)
│ - LLM call      │           ↓
│ - Combine       │  Combined Score (0-100)
│ - Decide        │           │
└─────────────────┘           ▼
                           DECISION
                      (allow/review/block)
```

---

## Configuration

### Quick Setup (.env files)

**Backend** (`backend/.env`):
```
APPROVAL_MODE=auto
ENABLE_LLM=true
LLM_API_URL=http://127.0.0.1:8000
```

**Python** (`llm/.env`):
```
OLLAMA_BASE_URL=http://localhost:11434
OLLAMA_MODEL=qwen2.5:7b
OLLAMA_TIMEOUT=60
LLM_TEMPERATURE=0
```

---

## Example Responses

### Safe Action
```json
{
  "decision": "allow",
  "riskScore": 15,
  "message": "Tool call approved automatically"
}
```

### Suspicious Action
```json
{
  "decision": "require_approval",
  "riskScore": 55,
  "message": "Tool call queued for human approval",
  "llmAnalysis": {
    "risk_score": 60,
    "decision": "REVIEW",
    "reason": "Accessing .env file may expose credentials..."
  }
}
```

### Malicious Action
```json
{
  "decision": "block",
  "riskScore": 87,
  "message": "Tool call blocked due to high risk",
  "llmAnalysis": {
    "risk_score": 95,
    "decision": "BLOCK",
    "reason": "Remote code execution pattern detected..."
  }
}
```

---

## API Endpoints

### Backend: `/inspect` (POST)

Inspect a tool call and get a security decision.

```bash
curl -X POST http://localhost:5000/inspect \
  -H "Content-Type: application/json" \
  -d '{
    "tool": "read_file",
    "args": {"path": "/home/user/.env"},
    "agentId": "agent-123"
  }'
```

### LLM: `/analyze` (POST)

Direct LLM analysis endpoint.

```bash
curl -X POST http://localhost:8000/analyze \
  -H "Content-Type: application/json" \
  -d '{
    "tool": "execute_pwsh",
    "arguments": {"command": "whoami"},
    "agent_id": "agent-123"
  }'
```

### Health Checks

```bash
curl http://localhost:5000/health    # Backend
curl http://localhost:8000/health    # LLM Service
```

---

## Scoring System

| Score | Decision | Severity |
|-------|----------|----------|
| 0-29 | ALLOW | LOW |
| 30-59 | REVIEW | MEDIUM |
| 60-84 | REVIEW | HIGH |
| 85-100 | BLOCK | CRITICAL |

**How it's calculated:**
```
final_score = deterministic_score × 0.60 + llm_score × 0.40
```

---

## Performance

| Operation | Time |
|-----------|------|
| Deterministic analysis | 1-5ms |
| LLM inference (cold) | 2000-5000ms |
| LLM inference (warm) | 500-1500ms |
| Total decision | 600-2000ms |
| Fallback (LLM down) | 5-10ms |

**Memory**: ~7-8GB total (6GB Ollama + 150MB backend + 100MB FastAPI)

---

## Troubleshooting

### LLM Service Not Available
```bash
# Check Ollama is running
curl http://localhost:11434/api/tags

# Check FastAPI is running
curl http://localhost:8000/health
```

### Model Not Found
```bash
# Pull the model
ollama pull qwen2.5:7b

# Or use a different model
ollama pull mistral
OLLAMA_MODEL=mistral python -m llm.fastapi_server
```

### Port Conflicts
```bash
# Use different ports
LLM_API_PORT=8001 python -m llm.fastapi_server
PORT=5001 npm run dev
```

For more help, see `LLM_INTEGRATION_GUIDE.md` → Troubleshooting section.

---

## Next Steps

1. **Complete Setup**: Follow `QUICKSTART_LLM.md` (5 min)
2. **Run Tests**: Execute `npx ts-node e2e-test.ts` to verify
3. **Review Logs**: Check decision quality in audit logs
4. **Customize**: Adjust thresholds in `backend/agentshield.config.yaml`
5. **Deploy**: Use guides in `DEPLOYMENT_GUIDE.md` for production

---

## Security Considerations

✅ **Secrets never reach LLM**: Redacted before analysis
✅ **Works offline**: Ollama runs locally
✅ **Graceful fallback**: Works if LLM unavailable
✅ **Full audit trail**: Both scores recorded
✅ **Type-safe**: TypeScript + Python type hints

---

## Advanced Usage

### Use Smaller/Faster Model
```bash
ollama pull mistral
OLLAMA_MODEL=mistral python -m llm.fastapi_server
```

### Disable LLM (Rules-Only Mode)
```bash
ENABLE_LLM=false npm run dev
```

### Adjust Score Weighting
Edit `backend/src/interceptor.ts` `combineScores()` function:
```typescript
const llmWeight = 0.3;  // 70% deterministic, 30% LLM
const detWeight = 0.7;
```

### Adjust Decision Thresholds
Edit `backend/agentshield.config.yaml`:
```yaml
risk:
  block_threshold: 90      # Stricter blocking
  review_threshold: 70     # More approvals
```

---

## Project Structure

```
agentshield/
├── backend/
│   ├── src/
│   │   ├── interceptor.ts       ← Core analysis pipeline
│   │   ├── llmService.ts        ← LLM client (NEW)
│   │   ├── riskDetector.ts      ← Deterministic rules
│   │   └── ...
│   ├── package.json             ← Added axios dependency
│   └── README.md
│
├── llm/
│   ├── fastapi_server.py        ← LLM service wrapper (NEW)
│   ├── security_analyzer.py     ← LLM analyzer
│   ├── prompts.py               ← Security prompts
│   ├── config.py
│   ├── schemas.py
│   ├── tests/
│   ├── e2e_test.py              ← Python tests (NEW)
│   └── README.md
│
├── e2e-test.ts                  ← TypeScript e2e tests (NEW)
├── QUICKSTART_LLM.md            ← Quick start (NEW)
├── LLM_INTEGRATION_GUIDE.md     ← Full guide (NEW)
├── LLM_IMPLEMENTATION_SUMMARY.md ← Implementation details (NEW)
├── DEPLOYMENT_GUIDE.md          ← Deployment (NEW)
├── ARCHITECTURE.md              ← Architecture diagrams (NEW)
├── IMPLEMENTATION_CHECKLIST.md  ← Feature checklist (NEW)
└── README_LLM.md                ← This file (NEW)
```

---

## Support

### Documentation
- Quick start: `QUICKSTART_LLM.md`
- Full setup: `LLM_INTEGRATION_GUIDE.md`
- Deployment: `DEPLOYMENT_GUIDE.md`
- Architecture: `ARCHITECTURE.md`

### Testing
```bash
# E2E tests
npx ts-node e2e-test.ts

# Python LLM tests
python -m llm.e2e_test

# Manual test
curl -X POST http://localhost:5000/inspect \
  -H "Content-Type: application/json" \
  -d '{"tool": "...", "args": {...}}'
```

### Common Issues
See `LLM_INTEGRATION_GUIDE.md` → Troubleshooting section

---

## Summary

You now have a powerful, **AI-aware security system** for your agents:

✅ **Analyzes both rules AND semantics**
✅ **60% deterministic + 40% LLM-driven scoring**
✅ **Graceful fallback when LLM unavailable**
✅ **Full audit trail of all decisions**
✅ **Production-ready** with deployment guides
✅ **Well-tested** with 20+ test cases
✅ **Well-documented** with comprehensive guides

Your agents are now protected! 🚀

---

**Last Updated**: October 2026
**Version**: 1.0.0 (LLM Integration Complete)
**Status**: ✅ Production Ready
