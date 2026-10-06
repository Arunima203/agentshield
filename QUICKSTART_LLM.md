# AgentShield LLM Integration — Quick Start

Get the full system running in 5 minutes.

## 1. Install Ollama

[Download](https://ollama.ai/download) and run the installer for your OS.

Then pull the model:

```bash
ollama pull qwen2.5:7b
```

(Takes 5-10 minutes, ~5GB download)

## 2. Start Services (3 terminals)

### Terminal 1: Ollama
```bash
ollama serve
```

### Terminal 2: Python LLM API
```bash
cd llm
pip install fastapi uvicorn pydantic python-dotenv
python -m fastapi_server
```

Visit [http://localhost:8000/docs](http://localhost:8000/docs) to test the API.

### Terminal 3: Node.js Backend
```bash
cd backend
npm install  # (if not already done)
npm run dev
```

## 3. Run Tests

### E2E Test (All Services)
```bash
npx ts-node e2e-test.ts
```

### LLM Only
```bash
python -m llm.e2e_test
```

## 4. Try It Out

### Make a Request
```bash
curl -X POST http://localhost:5000/inspect \
  -H "Content-Type: application/json" \
  -d '{
    "tool": "execute_pwsh",
    "args": {"command": "rm -rf /important/data"},
    "agentId": "test-agent",
    "sessionId": "test-session"
  }'
```

### Expected Response
```json
{
  "decision": "block",
  "riskScore": 92,
  "riskLevel": "critical",
  "message": "Tool call blocked due to high risk (score: 92)",
  "llmAnalysis": {
    "risk_score": 95,
    "decision": "BLOCK",
    "categories": ["destructive_command", "filesystem_destruction"],
    "reason": "This command would recursively delete..."
  }
}
```

## 5. Configuration

Create `backend/.env`:
```
APPROVAL_MODE=auto
ENABLE_LLM=true
LLM_API_URL=http://127.0.0.1:8000
```

Create `llm/.env`:
```
OLLAMA_BASE_URL=http://localhost:11434
OLLAMA_MODEL=qwen2.5:7b
OLLAMA_TIMEOUT=60
LLM_TEMPERATURE=0
LLM_API_PORT=8000
```

## Scoring Explained

```
Deterministic (60%)        LLM Semantic (40%)       Final Score
     ↓                           ↓                        ↓
    70 ← Rules              × 85 ← Ollama         = 76 (REVIEW)
      (patterns +            (understanding
       heuristics)            + intent)
```

## Troubleshooting

| Issue | Fix |
|-------|-----|
| `LLM unavailable` | Check Ollama is running: `curl http://localhost:11434/api/tags` |
| `Model not found` | Pull it: `ollama pull qwen2.5:7b` |
| `Port 8000 in use` | `lsof -i :8000` and kill process, or use `LLM_API_PORT=8001` |
| `Port 5000 in use` | Use `PORT=5001 npm run dev` |
| `Timeout` | Increase in env: `OLLAMA_TIMEOUT=120` |

## Next Steps

1. Review [LLM_INTEGRATION_GUIDE.md](LLM_INTEGRATION_GUIDE.md) for detailed docs
2. Adjust scoring weights and thresholds in `interceptor.ts`
3. Customize security rules in `backend/agentshield.config.yaml`
4. Add more test cases to `e2e-test.ts`

## Architecture at a Glance

```
Your Agent Request
        ↓
┌─────────────────────────────────┐
│ Node.js Backend (/inspect)      │
└─────────────────────────────────┘
        ↓
    ┌───┴────────────────┐
    ↓                    ↓
Deterministic Rules  LLM Analysis
(Pattern matching)   (FastAPI/Ollama)
    ↓                    ↓
    └────────┬───────────┘
             ↓
      Combined Score
             ↓
    ┌────────┴────────┐
    ↓                 ↓
  ALLOW          REQUIRE APPROVAL
                     ↓
                  BLOCK
```

## Key Features

✅ **Rule-based + AI-driven**: 60% deterministic patterns, 40% LLM semantics
✅ **Offline & Private**: Ollama runs locally, no cloud API calls
✅ **Fallback Safe**: Works without LLM (deterministic-only mode)
✅ **Fast**: Combined analysis in 600-2000ms
✅ **Production Ready**: Full audit logging and approval workflows

Enjoy! 🛡️
