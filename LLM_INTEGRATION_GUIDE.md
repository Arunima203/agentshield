# AgentShield LLM Integration Guide

## Overview

This guide explains how to set up and test the complete AgentShield system with LLM-based semantic analysis integrated into the Node.js backend.

### Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                      AI Agent Request                        │
└────────────────────────┬────────────────────────────────────┘
                         │
                         ▼
         ┌───────────────────────────────────┐
         │  Node.js Backend (interceptor.ts) │
         └────────────┬──────────────────────┘
                      │
         ┌────────────┴──────────────┐
         │                           │
         ▼                           ▼
    ┌──────────────┐         ┌─────────────────┐
    │ Deterministic│         │ LLM Semantic    │
    │ Rule Engine  │         │ Analysis        │
    │              │         │ (FastAPI)       │
    │ • Blocked    │         │                 │
    │   patterns   │         │ • Ollama        │
    │ • Tool rules │         │ • SecurityAnalz │
    │ • Secrets    │         │                 │
    └──────┬───────┘         └────────┬────────┘
           │                          │
           └──────────────┬───────────┘
                          │
            Score: 60% det + 40% LLM
                          │
                          ▼
         ┌───────────────────────────────────┐
         │    Combined Risk Score (0-100)    │
         └────────────────┬──────────────────┘
                          │
         ┌────────────────┴──────────────────┐
         │                                   │
         ▼                                   ▼
    ┌─────────────┐                  ┌─────────────┐
    │   Allow     │                  │   Require   │
    │             │                  │ Approval    │
    └─────────────┘                  └─────────────┘
```

## Prerequisites

### System Requirements
- **Node.js**: v18+
- **Python**: 3.8+
- **Ollama**: Local LLM runtime
- **RAM**: 8GB+ (for running Ollama models)

### Installation

#### 1. Install Ollama

Download and install from [ollama.ai](https://ollama.ai)

```bash
# macOS / Linux
curl -fsSL https://ollama.ai/install.sh | sh

# Windows
# Download from https://ollama.ai/download
```

#### 2. Pull the LLM Model

```bash
ollama pull qwen2.5:7b
```

> **Note**: This is a ~5GB download. Alternative models:
> - `ollama pull mistral` (7B, faster)
> - `ollama pull neural-chat` (7B)

#### 3. Backend Dependencies

```bash
cd backend
npm install axios  # Added to package.json, but install just in case
npm install
```

#### 4. Python Dependencies

```bash
pip install fastapi uvicorn pydantic python-dotenv
```

## Setup & Running

### Step 1: Start Ollama

```bash
ollama serve
```

Expected output:
```
2024-01-15 10:23:45 - INFO - Ollama is listening on 127.0.0.1:11434
```

### Step 2: Start Python FastAPI LLM Service

In a new terminal:

```bash
cd llm
python -m fastapi_server
```

Or with custom settings:

```bash
OLLAMA_BASE_URL=http://localhost:11434 \
OLLAMA_MODEL=qwen2.5:7b \
LLM_API_PORT=8000 \
python -m llm.fastapi_server
```

Expected output:
```
INFO:     Uvicorn running on http://127.0.0.1:8000
INFO:     Application startup complete
```

Visit [http://localhost:8000/docs](http://localhost:8000/docs) for interactive API documentation.

### Step 3: Start Node.js Backend

In another terminal:

```bash
cd backend
npm run dev
```

Expected output:
```
[Interceptor] Initialized
[LLMService] Initialized LLMService: http://127.0.0.1:8000
Server running on port 5000
```

### Step 4: Test the Integration

#### Option A: TypeScript E2E Test

```bash
npx ts-node e2e-test.ts
```

This will run 10 comprehensive test cases and validate the combined scoring system.

#### Option B: Python LLM Test

```bash
python -m llm.e2e_test
```

This will test the SecurityAnalyzer directly with various security scenarios.

#### Option C: Manual API Test

```bash
# Test the LLM API directly
curl -X POST http://localhost:8000/analyze \
  -H "Content-Type: application/json" \
  -d '{
    "tool": "execute_pwsh",
    "arguments": {"command": "rm -rf /important/data"},
    "agent_id": "test-agent"
  }'

# Test the backend inspect endpoint
curl -X POST http://localhost:5000/inspect \
  -H "Content-Type: application/json" \
  -d '{
    "tool": "read_file",
    "args": {"path": "/home/user/.env"},
    "agentId": "test-agent",
    "sessionId": "test-session"
  }'
```

## Configuration

### Backend Environment Variables

```bash
# Backend (backend/.env)
APPROVAL_MODE=auto              # auto | strict | audit
ENABLE_LLM=true                 # Enable/disable LLM analysis
LLM_API_URL=http://127.0.0.1:8000  # Python FastAPI endpoint
```

### Python Environment Variables

```bash
# Python LLM (llm/.env)
OLLAMA_BASE_URL=http://localhost:11434
OLLAMA_MODEL=qwen2.5:7b
OLLAMA_TIMEOUT=60
LLM_TEMPERATURE=0               # 0 = deterministic, 1 = creative
LLM_API_PORT=8000
LLM_API_HOST=127.0.0.1
```

## Scoring System

### Deterministic Score (60% weight)

Combines multiple rule-based checks:

1. **Base Tool Score**: Default risk per tool (configured in `config.yaml`)
   - Safe tools (read operations): 10-20
   - Medium tools (data queries): 30-50
   - Dangerous tools (shell, file write): 60-80

2. **Heuristic Checks** (added per finding):
   - Destructive shell pattern: +30
   - Recursive delete: +30
   - Remote code execution (curl|bash): +50
   - System path write: +40
   - SSH key modification: +20
   - Hidden file write: +10

3. **Secret Findings**: +20 per detected secret

4. **Domain Allowlist Violation**: +60 (if enabled)

**Formula**: `det_score = min(100, base_score + heuristic_findings + secret_findings)`

### LLM Semantic Score (40% weight)

The Python SecurityAnalyzer uses the LLM to understand context:

1. **Prompt Injection Detection**: Identifies attempts to override instructions
2. **Intent Analysis**: Determines if the action is malicious despite benign syntax
3. **Context Understanding**: Considers the full request, not just patterns
4. **Confidence Scoring**: 0.0 (uncertain) to 1.0 (confident)

**Risk Decision Matrix**:
- 0-29: LOW (ALLOW)
- 30-59: MEDIUM (REVIEW)
- 60-84: HIGH (REVIEW)
- 85-100: CRITICAL (BLOCK)

### Combined Score

```
final_score = deterministic_score * 0.60 + llm_score * 0.40
```

Example:
- Deterministic: 70 (pattern match + heuristics)
- LLM: 85 (detects malicious intent)
- **Final: 76** (HIGH, REVIEW)

## API Endpoints

### Backend `/inspect` (POST)

Analyzes a tool call with combined scoring.

**Request:**
```json
{
  "tool": "execute_pwsh",
  "args": {"command": "rm -rf /data"},
  "agentId": "agent-123",
  "sessionId": "session-456"
}
```

**Response:**
```json
{
  "toolCallId": "uuid-...",
  "decision": "block",
  "riskScore": 92,
  "riskLevel": "critical",
  "riskFindings": [
    {
      "rule": "destructive-shell",
      "reason": "Command contains recursive force-delete pattern",
      "score": 30
    }
  ],
  "secretsDetected": false,
  "message": "Tool call blocked due to high risk (score: 92)",
  "llmAnalysis": {
    "risk_score": 95,
    "severity": "CRITICAL",
    "decision": "BLOCK",
    "categories": ["destructive_command", "filesystem_destruction"],
    "reason": "This command would recursively delete an entire directory, causing data loss...",
    "confidence": 0.98,
    "model": "qwen2.5:7b",
    "llm_available": true
  },
  "scoreSources": ["deterministic", "llm_semantic"]
}
```

### LLM API `/analyze` (POST)

Analyzes action using the LLM service.

**Request:**
```json
{
  "tool": "execute_pwsh",
  "arguments": {"command": "rm -rf /data"},
  "agent_id": "agent-123",
  "context": {"sessionId": "session-456"}
}
```

**Response:**
```json
{
  "risk_score": 95,
  "severity": "CRITICAL",
  "decision": "BLOCK",
  "categories": ["destructive_command", "filesystem_destruction"],
  "reason": "This command represents a critical security risk...",
  "safe_alternative": "Verify the path and use rm with confirmation: rm -i /path",
  "confidence": 0.98,
  "model": "qwen2.5:7b",
  "llm_available": true
}
```

### LLM API `/health` (GET)

Check service and Ollama availability.

**Response:**
```json
{
  "status": "healthy",
  "llm": {
    "available": true,
    "base_url": "http://localhost:11434",
    "model": "qwen2.5:7b"
  }
}
```

## Troubleshooting

### Ollama Connection Failed

**Error**: `LLM service is currently unavailable`

**Solution**:
```bash
# Check if Ollama is running
ollama serve

# Verify connectivity
curl http://localhost:11434/api/tags

# If port 11434 is already in use, find and kill the process
lsof -i :11434
```

### Model Not Found

**Error**: `OllamaModelNotFoundError`

**Solution**:
```bash
# Pull the model
ollama pull qwen2.5:7b

# List available models
ollama list

# Use alternative model
OLLAMA_MODEL=mistral python -m llm.fastapi_server
```

### Backend Can't Connect to LLM Service

**Error**: `LLMService unavailable: http://127.0.0.1:8000/health`

**Solution**:
```bash
# Check if FastAPI is running
curl http://localhost:8000/health

# Verify LLM_API_URL environment variable
echo $LLM_API_URL

# Make sure FastAPI server started successfully
python -m llm.fastapi_server
```

### Test Failures: Score Out of Range

**Cause**: LLM responses vary based on model and input. Exact scores are non-deterministic.

**Solution**:
- Widen `expectedRiskRange` in test cases
- LLM confidence varies with model size (7B < 13B < 70B)
- Test semantics (decision type) rather than exact scores

## Performance Tuning

### Response Time

Typical latencies:

| Component | Latency |
|-----------|---------|
| Deterministic rules | 1-5ms |
| LLM analysis (cold) | 2000-5000ms |
| LLM analysis (warm) | 500-1500ms |
| Total `/inspect` | 600-2000ms |

### Optimization Tips

1. **Use Smaller Models**: `mistral` (7B) faster than `qwen2.5:7b`
2. **Increase Context Window**: Adjust `OLLAMA_TIMEOUT` if needed
3. **Cache LLM Responses**: For identical tool calls (future enhancement)
4. **Async Dispatch**: Run LLM analysis in background for non-blocking decisions

### Memory Usage

- **Ollama + qwen2.5:7b**: ~6-8GB
- **Ollama + mistral**: ~5-7GB
- **Backend + FastAPI**: ~200MB

## Security Considerations

### 1. Secret Redaction

All secrets detected in arguments are redacted before LLM analysis:

```python
# Before LLM
{"api_key": "sk-1234567890abcdef", "path": "/home/user"}

# Sanitized for LLM
{"api_key": "[REDACTED_SECRET]", "path": "/home/user"}
```

### 2. LLM Isolation

The LLM never receives:
- Actual secret values
- User credentials
- Database passwords
- Private keys

### 3. Fallback Safety

If Ollama is unavailable:
- Backend uses deterministic scoring only
- Decision still made based on rules
- LLM response: `{ "llm_available": false }`

## Advanced Usage

### Custom Models

```bash
# Use a different model
ollama pull neural-chat
OLLAMA_MODEL=neural-chat python -m llm.fastapi_server
```

### Batch Analysis

```python
from llm.security_analyzer import SecurityAnalyzer

analyzer = SecurityAnalyzer()

actions = [
    {"tool": "read_file", "args": {"path": "/etc/passwd"}},
    {"tool": "fs_write", "args": {"path": "/tmp/test.txt", "text": "hello"}},
    {"tool": "execute_pwsh", "args": {"command": "whoami"}},
]

for action in actions:
    result = await analyzer.analyze_action(
        tool=action["tool"],
        arguments=action["args"]
    )
    print(f"{action['tool']}: {result.decision}")
```

### Integration with Kiro

To use AgentShield in Kiro:

1. Configure MCP server for backend API
2. Add pre-execution hook to call `/inspect`
3. Block execution if decision is "block"
4. Queue for approval if decision is "require_approval"

## Next Steps

1. **Monitor Production**: Set up logging and alerts
2. **Fine-tune Thresholds**: Adjust `config.yaml` based on real usage
3. **Collect Feedback**: Track false positives/negatives
4. **Iterate Models**: Test newer/larger models as they become available
5. **Add More Checks**: Extend security patterns based on threats

## Support

For issues or questions:

1. Check the [troubleshooting](#troubleshooting) section
2. Review logs:
   - Backend: `tail -f backend/logs/app.log`
   - Python: Check console output from `python -m llm.fastapi_server`
   - Ollama: Check Ollama logs
3. Run diagnostics: `npx ts-node e2e-test.ts` or `python -m llm.e2e_test`

## References

- [Ollama Documentation](https://github.com/ollama/ollama)
- [FastAPI Documentation](https://fastapi.tiangolo.com)
- [AgentShield Backend README](backend/README.md)
- [AgentShield LLM README](llm/README.md)
