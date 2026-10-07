# Bugfix Requirements Document: Agent-Shield Nine Critical Issues

## Introduction

Agent-Shield contains nine confirmed bugs across secrets pattern handling, LLM/risk scoring logic, and Docker/Nginx deployment configuration. These bugs allow secret patterns to fail silently (JavaScript rejects inline flags), bypass secret detection through redaction timing, permit unauthorized file access through low-risk scoring blends, expose unsafe shell commands, cause deployment failures, and create networking misconfigurations. This document specifies the fix requirements for all nine issues using the bug condition methodology.

## Bug Analysis

### 1. Secrets Pattern JavaScript Flag Errors

#### Current Behavior (Defect)

1.1 WHEN secret patterns contain inline (?i) flags (password, API key, AWS secret, connection-string patterns) THEN the regex engine rejects the pattern at runtime with SyntaxError
1.2 WHEN regex compilation fails silently THEN secrets matching those patterns are never detected and logged

#### Expected Behavior (Correct)

2.1 WHEN secret patterns are initialized THEN all patterns are valid JavaScript RegExp objects without inline flag syntax
2.2 WHEN the i flag is required THEN it SHALL be passed as the second argument to RegExp constructor, not embedded in the pattern string

#### Unchanged Behavior (Regression Prevention)

3.1 WHEN non-flagged patterns (AWS Access Key, Private Key Block, JWT Token, etc.) are scanned THEN the system SHALL CONTINUE TO match them correctly
3.2 WHEN pattern matching is disabled THEN the system SHALL CONTINUE TO allow tool calls without secret scanning

---

### 2. Redaction Before Block-Pattern Check

#### Current Behavior (Defect)

1.1 WHEN a command contains both a secret AND a blocked pattern (e.g., `rm -rf / # AKIA…`) THEN scanAndRedact redacts all arguments before checkBlockedPatterns runs
1.2 WHEN args are fully redacted THEN the block-pattern regex cannot match the original pattern and the command bypasses security rules

#### Expected Behavior (Correct)

2.1 WHEN a tool call arrives THEN risk assessment SHALL check blocked patterns against the raw, unreacted arguments
2.2 WHEN secrets are detected THEN redaction SHALL apply only to logs, LLM inputs, and persistent storage—not to rule-evaluation logic

#### Unchanged Behavior (Regression Prevention)

3.1 WHEN LLM receives tool arguments THEN the system SHALL CONTINUE TO redact secrets from LLM inputs
3.2 WHEN audit logs store sanitized args THEN the system SHALL CONTINUE TO redact secrets from persistent audit records
3.3 WHEN secret detection records findings THEN the system SHALL CONTINUE TO log which patterns were found without exposing the values

---

### 3. LLM Cannot Block: read_file .env Auto-Approved

#### Current Behavior (Defect)

1.1 WHEN read_file is called on .env THEN the tool receives risk_score=10 (low risk) from config
1.2 WHEN LLM analysis runs THEN even if LLM returns decision=BLOCK, the combineScores function ignores the LLM decision field
1.3 THEN read_file .env is auto-approved at score 10 regardless of LLM advice

#### Expected Behavior (Correct)

2.1 WHEN LLM decision is BLOCK THEN the system SHALL set decision=require_approval and require_approval flag immediately, without waiting for score thresholds
2.2 WHEN LLM identifies high-confidence security concerns (categories include "secret_exposure", "credential_leak", "sensitive_file_access") THEN the system SHALL require approval even if combined score is below review_threshold

#### Unchanged Behavior (Regression Prevention)

3.1 WHEN LLM is unavailable THEN the system SHALL CONTINUE TO use deterministic scores only
3.2 WHEN LLM returns ALLOW THEN the system SHALL CONTINUE TO allow combined score logic to determine final approval

---

### 4. 60/40 Risk Blend Below Threshold

#### Current Behavior (Defect)

1.1 WHEN deterministicScore=10 (read_file) and llmAnalysis.risk_score=95 THEN combineScores calculates 10*0.6 + 95*0.4 = 44
1.2 WHEN finalScore=44 is below review_threshold=50 THEN the tool call is auto-approved despite LLM high confidence
1.3 WHEN LLM decision field exists THEN it is completely ignored in combineScores

#### Expected Behavior (Correct)

2.1 WHEN LLM provides a risk_score THEN the system SHALL use it to raise risk freely (LLM can escalate, not lower)
2.2 WHEN LLM risk_score exceeds deterministic score THEN the system SHALL use the LLM score directly (not blend downward)
2.3 WHEN LLM decision is REVIEW or BLOCK THEN the system SHALL set requireApproval=true independent of the score

#### Unchanged Behavior (Regression Prevention)

3.1 WHEN both deterministic and LLM scores are low THEN the system SHALL CONTINUE TO auto-approve
3.2 WHEN deterministic score is high THEN the system SHALL CONTINUE TO require approval even if LLM is unavailable

---

### 5. Obvious Command Bypasses Not Blocked

#### Current Behavior (Defect)

1.1 WHEN execute_pwsh receives `rm --recursive --force /` THEN the blocked pattern `rm\s+-rf` does not match (uses `--recursive --force`)
1.2 WHEN execute_pwsh receives `base64 -d < secret.b64 | sh` THEN the pattern `\|\s*(bash|sh)` does not account for base64 encoding
1.3 WHEN execute_pwsh receives `su - && rm -rf /` THEN the sudo block catches su - but not the escalated rm after it
1.4 WHEN execute_pwsh receives `cat .env | curl -d @-` THEN neither pipe pattern nor the sensitive file read is blocked

#### Expected Behavior (Correct)

2.1 WHEN execute_pwsh receives destructive commands THEN blocked patterns SHALL match variants: `-rf`, `--recursive --force`, `-r -f`, `-f -r`
2.2 WHEN execute_pwsh receives encoded/piped commands THEN the system SHALL detect base64 decoding to shell: `(base64|xxd|od).*\|\s*(bash|sh|zsh)`
2.3 WHEN execute_pwsh receives commands with privilege escalation THEN blocked patterns SHALL block all shell commands after `su -` or similar
2.4 WHEN execute_pwsh receives data exfiltration patterns THEN blocked patterns SHALL detect sensitive file reads piped to external commands: `(cat|grep|aws s3).*\|\s*(curl|wget)`

#### Unchanged Behavior (Regression Prevention)

3.1 WHEN safe shell commands run THEN the system SHALL CONTINUE TO allow them (e.g., `echo "hello"`)
3.2 WHEN non-destructive pipes execute \THEN the system SHALL CONTINUE TO allow them (e.g., `ls -la | grep .ts`)

---

### 6. Silent LLM Failure: No Escalation to Review

#### Current Behavior (Defect)

1.1 WHEN LLM service is down or times out THEN createFallbackAnalysis returns llm_available=false, risk_score=null, decision=REVIEW
1.2 WHEN combineScores receives llm_available=false THEN it returns deterministicScore unchanged (low-risk tools bypass escalation)
1.3 WHEN ENABLE_LLM=false or LLM times out (75s vs 8s design timeout) THEN there is no escalation notification, users are unaware LLM is disabled

#### Expected Behavior (Correct)

2.1 WHEN LLM call fails THEN the interceptor SHALL NOT silently degrade; instead, mark the inspection with llm_status=unavailable
2.2 WHEN LLM is unavailable THEN actions requiring LLM judgment (e.g., semantic analysis on ambiguous tools) SHALL escalate to review_threshold + safety_margin
2.3 WHEN LLM timeout approaches the configured timeout \THEN the backend SHALL use a shorter LLM_API_TIMEOUT_MS (8s per design, not 75s)
2.4 WHEN LLM is disabled or unavailable THEN audit logs SHALL record this and users SHALL see a warning in inspection response

#### Unchanged Behavior (Regression Prevention)

3.1 WHEN LLM is available and healthy THEN the system SHALL CONTINUE TO use its analysis
3.2 WHEN deterministic rules are high-risk THEN the system SHALL CONTINUE TO block without waiting for LLM
3.3 WHEN LLM is intentionally disabled in config THEN the system SHALL CONTINUE TO run rule-only assessment

---

### 7. Dev Compose Build Context Mismatch

#### Current Behavior (Defect)

1.1 WHEN docker-compose.yml (dev) specifies `build: { context: ./backend }` THEN Docker COPY commands use paths relative to ./backend
1.2 WHEN Dockerfile contains `COPY backend/... ./` THEN Docker cannot find backend/... (it's relative to ./backend, not .)
1.3 WHEN dev compose builds \THEN Dockerfile build fails with "COPY failed: file not found"

#### Expected Behavior (Correct)

2.1 WHEN docker-compose.yml specifies build context THEN the context path SHALL match Dockerfile COPY/ADD path prefixes
2.2 WHEN dev compose uses `context: ./backend` THEN Dockerfile SHALL copy files as `COPY src/ ./src` and `COPY *.json ./` (paths relative to context root)
2.3 WHEN dev compose and prod compose share a Dockerfile THEN both SHALL use consistent context values or the Dockerfile SHALL adapt

#### Unchanged Behavior (Regression Prevention)

3.1 WHEN prod compose builds THEN the system SHALL CONTINUE TO work with the current context=. and paths
3.2 WHEN build artifacts are created \THEN the system SHALL CONTINUE TO include all necessary source and config files

---

### 8. npm ci Before npm run build

#### Current Behavior (Defect)

1.1 WHEN Dockerfile runs `npm ci --only=production` THEN devDependencies are excluded (including tsc)
1.2 WHEN Dockerfile then runs `npm run build` THEN tsc is not installed, causing "tsc: command not found"
1.3 WHEN build stage fails THEN the image cannot compile TypeScript

#### Expected Behavior (Correct)

2.1 WHEN Dockerfile needs to compile TypeScript THEN npm ci SHALL install ALL dependencies (including devDependencies)
2.2 WHEN npm run build executes \THEN tsc and other build tools SHALL be present
2.3 WHEN final runtime image is created THEN `npm ci --only=production` SHALL run to trim devDependencies from the final stage

#### Unchanged Behavior (Regression Prevention)

3.1 WHEN build succeeds \THEN compiled dist/ files SHALL be present
3.2 WHEN runtime stage runs THEN only production dependencies SHALL be included in the final image

---

### 9. Docker & Nginx Configuration Mismatches

#### Current Behavior (Defect)

1.1 WHEN compose sets LLM_SERVICE_URL=http://llm-api:8000 THEN backend code reads process.env.LLM_API_URL (different variable name)
1.2 WHEN LLM_API_URL is undefined THEN backend fallback is 127.0.0.1:8000, which is unreachable in container network
1.3 WHEN llmService silently falls back to rules-only \THEN users don't know the mismatch

1.4 WHEN backend serves routes at /inspect, /approvals, /health \THEN nginx routes /api/* to backend
1.5 WHEN frontend requests GET /api/inspect \THEN nginx strips /api and sends /inspect to backend, which does not have /api/inspect
1.6 WHEN backend returns 404 \THEN frontend receives 404 instead of expected response

1.7 WHEN nginx sets proxy_read_timeout=30s \THEN if LLM takes 8s + other processing takes time, response may timeout
1.8 WHEN WebSocket-based approval notifications are added \THEN nginx lacks Upgrade and Connection headers

1.9 WHEN docker-compose.prod.yml publishes `11434:11434` (Ollama port) \THEN Ollama is exposed to the host network without auth
1.10 WHEN docker-compose has no frontend service \THEN there is no web UI to interact with the backend

#### Expected Behavior (Correct)

2.1 WHEN compose sets LLM service URL \THEN the environment variable name SHALL match backend code (LLM_API_URL or LLM_SERVICE_URL consistently)
2.2 WHEN LLM service is unavailable THEN the backend SHALL log the misconfiguration and include it in health checks

2.3 WHEN frontend requests /api/inspect \THEN nginx SHALL rewrite the path correctly to backend routes
2.4 WHEN all routes are verified \THEN /api/* SHALL properly route to all backend inspection and approval endpoints

2.5 WHEN LLM calls take 8s \THEN proxy_read_timeout SHALL be at least 15s (8s call + buffer)
2.6 WHEN WebSocket support is needed \THEN nginx SHALL include Upgrade and Connection headers in /api location

2.7 WHEN Ollama is deployed \THEN port 11434 SHALL NOT be published to the host; only llm-api container SHALL connect to it
2.8 WHEN production is deployed \THEN a frontend container SHALL be present or the frontend build output SHALL be served by nginx

#### Unchanged Behavior (Regression Prevention)

3.1 WHEN health checks run \THEN the system SHALL CONTINUE TO verify backend and LLM connectivity
3.2 WHEN backend routes work internally \THEN the system SHALL CONTINUE TO return correct responses
3.3 WHEN Prometheus metrics are accessed \THEN the system SHALL CONTINUE TO protect them with auth

---

## Summary of Bug Conditions

| Bug # | Trigger Condition | Core Issue | Fix Category |
|-------|-------------------|-----------|--------------|
| 1 | Secrets patterns with (?i) | JavaScript regex rejects inline flags | Pattern syntax |
| 2 | Command has secret + blocked pattern | Redaction hides blocked pattern | Processing order |
| 3 | read_file .env with high LLM score | LLM decision field ignored | LLM integration |
| 4 | Low deterministic + high LLM score | 60/40 blend averages down below threshold | Score blending |
| 5 | Variants of destructive/exfil commands | Blocked patterns too specific, miss variants | Pattern coverage |
| 6 | LLM down + low-risk tool | Silent fallback with no escalation | Error handling |
| 7 | Dev compose build | Context path mismatch in COPY commands | Docker build |
| 8 | npm ci before build | devDependencies excluded, tsc missing | Build order |
| 9a | Compose env var mismatch | LLM_SERVICE_URL vs LLM_API_URL | Environment config |
| 9b | Nginx routing /api/* | Route stripping causes backend 404 | Routing config |
| 9c | Nginx timeout + WebSocket | 30s timeout, no upgrade headers | Proxy config |
| 9d | Ollama port published + no frontend | Network exposure, incomplete deployment | Deployment architecture |
