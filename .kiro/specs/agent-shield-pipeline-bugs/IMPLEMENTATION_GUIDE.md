# AgentShield Pipeline Bugs - Implementation Guide

## Overview

This guide provides step-by-step instructions to fix all 10 bugs identified in the production readiness audit. Each bug has a defined root cause, implementation approach, and validation strategy.

---

## Recommended Implementation Order

### Phase 1: Critical Blockers (Production Blocking)
1. **Bug #10** - Create Dockerfiles + Nginx config (1.5 hours)
2. **Bug #3** - Routes/inspect error handling (2 hours)
3. **Bug #4** - Interceptor error handling (2 hours)

### Phase 2: Data Integrity & Distribution (High Priority)
4. **Bug #5** - Database connection pool exhaustion (3 hours)
5. **Bug #2** - Distributed timeout sweep locking (4 hours)

### Phase 3: Real-Time & Observability
6. **Bug #1** - WebSocket real-time updates (1 day)
7. **Bug #6** - Timeout enforcement (30 min)

### Phase 4: Configuration & Monitoring
8. **Bug #7** - Idempotent logging (15 min)
9. **Bug #8** - CORS misconfiguration (30 min)
10. **Bug #9** - Health checks incomplete (1 hour)

**Total Timeline:** 6-8 engineering days

---

## Bug #1: WebSocket Real-Time Updates

### Files to Create
- `backend/src/realtime/socketServer.ts` (150 lines)
- `backend/src/realtime/eventBus.ts` (100 lines)
- `app/hooks/useRealtimeEvents.ts` (80 lines)
- `app/lib/realtimeClient.ts` (50 lines)

### Files to Modify
- `backend/src/app.ts` - Add Socket.io setup
- `backend/src/approvalGate.ts` - Emit events
- `backend/src/auditLogger.ts` - Emit events
- `app/page.tsx` - Replace polling with real-time hook
- `backend/package.json` - Add socket.io, redis

### Dependencies to Add
```json
{
  "dependencies": {
    "socket.io": "^4.7.0",
    "socket.io-client": "^4.7.0",
    "redis": "^4.6.0"
  }
}
```

### Validation Checklist
- [ ] Socket.io server starts without errors
- [ ] Client connects and receives JWT auth
- [ ] Dashboard subscribes to approval/audit rooms
- [ ] New approval instantly appears in real-time (<100ms)
- [ ] No polling requests in network tab
- [ ] Fallback to polling if WebSocket unavailable
- [ ] Prometheus metrics track connected clients

### Testing
```bash
npm run test -- BugFix1
# Manual: Open dashboard, create approval, verify instant update
```

---

## Bug #2: Distributed Timeout Sweep

### Files to Create
- `backend/src/distributed/lockManager.ts` (150 lines)
- `backend/src/tasks/timeoutSweep.ts` (120 lines)

### Files to Modify
- `backend/src/index.ts` - Register timeout sweep task
- `backend/src/approvalGate.ts` - Remove old inline timeout sweep
- `backend/package.json` - Already has redis dependency

### Database Changes
```sql
ALTER TABLE approval_requests ADD COLUMN IF NOT EXISTS resolved_at TIMESTAMP;
ALTER TABLE audit_log ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP DEFAULT NOW();

CREATE INDEX idx_approval_status_created 
  ON approval_requests(status, created_at)
  WHERE status = 'pending';

CREATE INDEX idx_audit_tool_call_id 
  ON audit_log(tool_call_id);
```

### Validation Checklist
- [ ] Lock manager acquires/releases Redis locks
- [ ] Only one backend instance sweeps timeouts
- [ ] Expired approvals marked as timeout exactly once
- [ ] Audit log has no duplicate entries
- [ ] Real-time events emitted for timeout approvals
- [ ] Prometheus tracks lock acquisition time

### Testing
```bash
npm run test -- BugFix2
# Manual: Start 3 backends, create timeout, verify single entry in audit log
```

---

## Bug #3: Routes/Inspect Error Handling

### Files to Create
- `backend/src/errors/ErrorFactory.ts` (120 lines)
- `backend/src/middleware/asyncHandler.ts` (30 lines)

### Files to Modify
- `backend/src/routes/inspect.ts` - Add error handling
- `backend/src/app.ts` - Add global error handler
- `backend/src/types.ts` - Add error types

### Validation Checklist
- [ ] Invalid JSON body returns 400 error
- [ ] Missing 'tool' field returns 400 error
- [ ] Database unavailable returns 503 error
- [ ] Error response includes code + message
- [ ] Error logged with context
- [ ] Audit log captures failed inspection
- [ ] No unhandled exceptions in logs

### Testing
```bash
npm run test -- BugFix3
# Manual: 
# POST /inspect with invalid JSON → 400
# POST /inspect without 'tool' → 400
# Database down → 503
```

---

## Bug #4: Interceptor Error Handling

### Files to Modify
- `backend/src/interceptor.ts` - Wrap assessRisk in try-catch
- `backend/src/riskDetector.ts` - Add safeguards
- `backend/src/database.ts` - Add error log schema

### Database Changes
```sql
ALTER TABLE audit_log ADD COLUMN IF NOT EXISTS error_message VARCHAR;
ALTER TABLE audit_log ADD COLUMN IF NOT EXISTS is_failed_inspection BOOLEAN DEFAULT FALSE;
```

### Validation Checklist
- [ ] Missing tool config defaults to risk_score=30
- [ ] Invalid regex pattern doesn't crash assessment
- [ ] Config load failure defaults to risk_score=50
- [ ] Failed inspection logged with error_message
- [ ] Audit entry created for failed inspections
- [ ] Deterministic scoring never throws

### Testing
```bash
npm run test -- BugFix4
# Manual:
# Inspect with tool not in config → defaults to 30
# Corrupt config.yaml → defaults to 50
```

---

## Bug #5: Database Connection Pool Exhaustion

### Files to Create
- `backend/src/database/poolMonitor.ts` (150 lines)
- `backend/src/database/queryWithTimeout.ts` (80 lines)

### Files to Modify
- `backend/src/database.ts` - Configure pool + monitoring
- `backend/src/healthCheck.ts` - Add pool metrics
- `backend/src/monitoring.ts` - Add Prometheus metrics
- `backend/package.json` - Already has pg-promise

### Database Configuration
```typescript
const pgConfig = {
  max: 20,
  min: 5,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 5000,
  statement_timeout: 30000,  // PostgreSQL 30s timeout
  query_timeout: 30000,
};
```

### Environment Variables
```bash
DB_POOL_SIZE=20
DB_POOL_MIN=5
DB_STATEMENT_TIMEOUT_MS=30000
DB_QUERY_TIMEOUT_MS=30000
```

### Validation Checklist
- [ ] Pool metrics tracked and exposed to Prometheus
- [ ] Slow queries logged (>5s)
- [ ] Long-running queries canceled after 30s
- [ ] Connection timeout returns error after 5s
- [ ] Pool exhaustion triggers warning log
- [ ] Health check reports pool status
- [ ] /health endpoint includes pool metrics

### Testing
```bash
npm run test -- BugFix5
# Manual:
# Long-running query (>30s) → canceled
# Exhaust all 20 connections → next request times out after 5s
# Verify /health includes poolSize, available, waiting
```

---

## Bug #6: Timeout Enforcement (Query Timeouts)

### Files to Modify
- `backend/src/database.ts` - Already covered in Bug #5

### PostgreSQL Configuration
```sql
-- Set at database level
ALTER DATABASE agentshield SET statement_timeout = '30s';

-- Or per user
ALTER USER agentshield_user SET statement_timeout = '30s';

-- Monitor slow queries
CREATE EXTENSION IF NOT EXISTS pg_stat_statements;
```

### Validation Checklist
- [ ] Queries exceeding 30s are canceled by PostgreSQL
- [ ] Slow query log captures queries >5s
- [ ] No "query hang" issues in monitoring
- [ ] TIMEOUT errors properly handled in Node.js

### Testing
```bash
# Verify statement_timeout is set
psql -U agentshield -d agentshield -c "SHOW statement_timeout"
# Output: 30s

# Test timeout
psql -U agentshield -d agentshield -c "SELECT pg_sleep(60)"
# Should error: canceling statement due to statement timeout
```

---

## Bug #7: Idempotent Logging (Duplicate Audit Entries)

### Files to Modify
- None (schema only)

### Database Changes
```sql
-- Add unique constraint to prevent duplicate audit entries
ALTER TABLE audit_log 
  ADD CONSTRAINT uq_audit_tool_call_id UNIQUE (tool_call_id);
```

### Validation Checklist
- [ ] Duplicate inspect calls with same tool_call_id fail on insert
- [ ] Audit log has exactly 1 entry per tool_call
- [ ] Error handling gracefully handles constraint violation

### Testing
```typescript
describe('Idempotent Logging', () => {
  it('should prevent duplicate audit log entries', async () => {
    const toolCall = { id: 'test-123', tool: 'execute_pwsh', args: {} };
    
    // First insert succeeds
    await auditLogger.log(toolCall, result1);
    
    // Second insert with same tool_call_id fails
    await expect(
      auditLogger.log(toolCall, result2)
    ).rejects.toThrow('unique constraint');
  });
});
```

---

## Bug #8: CORS Misconfiguration

### Files to Modify
- `backend/src/app.ts` - Update cors() configuration

### Code Change
```typescript
// OLD: cors({ origin: /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/ })

// NEW:
cors({
  origin: (origin, callback) => {
    const allowed = [
      /^https:\/\/(agentshield\.yourdomain\.com|staging\.yourdomain\.com)$/,
      /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/,  // Dev
    ];
    if (!origin || allowed.some(p => p.test(origin))) {
      callback(null, true);
    } else {
      callback(new Error(`CORS: ${origin} not allowed`));
    }
  },
  credentials: true,
  methods: ['GET', 'POST', 'DELETE'],
  allowedHeaders: ['Content-Type', 'Authorization'],
  maxAge: 3600,
})
```

### Environment Variables
```bash
# .env.production
ALLOWED_ORIGINS=https://agentshield.yourdomain.com,https://staging.yourdomain.com
```

### Validation Checklist
- [ ] localhost requests work (dev)
- [ ] production.yourdomain.com requests work
- [ ] untrusted.com requests rejected
- [ ] Preflight OPTIONS requests succeed
- [ ] Authorization header passed through

### Testing
```bash
# Test localhost (should work)
curl -H "Origin: http://localhost:3000" http://localhost:5000/api/audit

# Test production (should work)
curl -H "Origin: https://agentshield.yourdomain.com" https://api.agentshield.com/api/audit

# Test untrusted (should fail)
curl -H "Origin: https://evil.com" https://api.agentshield.com/api/audit
# Should see CORS error
```

---

## Bug #9: Health Checks Incomplete

### Files to Modify
- `backend/src/healthCheck.ts` - Add LLM + database checks
- `backend/src/app.ts` - Update /health endpoint

### Code Change
```typescript
// OLD: app.get('/health', (_req, res) => { res.json({ status: 'ok' }); });

// NEW:
app.get('/health', async (req, res) => {
  const health = await getHealthStatus();
  const statusCode = health.status === 'ok' ? 200 : 503;
  res.status(statusCode).json(health);
});

// Returns:
// {
//   "status": "ok|degraded",
//   "database": { "healthy": true, "poolSize": 20, "available": 18 },
//   "llm": { "available": true, "responseTime": 150 },
//   "timestamp": "2024-01-01T00:00:00Z"
// }
```

### Validation Checklist
- [ ] /health returns database connection status
- [ ] /health returns LLM availability
- [ ] /health returns 200 if all healthy
- [ ] /health returns 503 if database down
- [ ] /health returns 503 if LLM unavailable
- [ ] Kubernetes readiness probe uses /health
- [ ] Response time <500ms

### Testing
```bash
# Healthy system
curl http://localhost:3000/health
# Returns: {"status":"ok", "database":{...}, "llm":{...}}

# Database down
# Kill PostgreSQL
curl http://localhost:3000/health
# Returns: 503 with status: "degraded"

# LLM down
# Kill Ollama
curl http://localhost:3000/health
# Returns: 503 with status: "degraded"
```

---

## Bug #10: Missing Dockerfiles & Nginx Config

### Files to Create
- `backend/Dockerfile`
- `llm/Dockerfile`
- `nginx/agentshield.conf`
- `nginx/ssl/README.md` (instructions)

### Backend Dockerfile
```dockerfile
FROM node:18-alpine

WORKDIR /app

# Install dependencies
COPY backend/package.json backend/package-lock.json ./
RUN npm install --production

# Copy source
COPY backend/src ./src
COPY backend/tsconfig.json ./
COPY backend/agentshield.config.yaml ./

# Build
RUN npm run build

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=5s --retries=3 \
  CMD node -e "require('http').get('http://localhost:3000/health', (r) => { if (r.statusCode !== 200) throw new Error(r.statusCode) })"

EXPOSE 3000

CMD ["node", "dist/index.js"]
```

### LLM Dockerfile
```dockerfile
FROM python:3.11-slim

WORKDIR /app

# Install dependencies
RUN pip install --no-cache-dir fastapi uvicorn ollama pydantic-settings

# Copy source
COPY llm/*.py ./

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=10s --retries=3 \
  CMD python -c "import urllib.request; urllib.request.urlopen('http://localhost:8000/health')"

EXPOSE 8000

CMD ["uvicorn", "fastapi_server:app", "--host", "0.0.0.0", "--port", "8000"]
```

### Nginx Configuration
```nginx
# nginx/agentshield.conf
upstream backend {
    server backend:3000;
    keepalive 64;
}

upstream llm {
    server llm-api:8000;
    keepalive 32;
}

server {
    listen 80;
    server_name _;
    
    client_max_body_size 1m;
    
    # Health check (no auth required)
    location /health {
        proxy_pass http://backend/health;
        access_log off;
    }

    # API routes
    location /api {
        proxy_pass http://backend;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Authorization $http_authorization;
        proxy_set_header Content-Type $http_content_type;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_read_timeout 30s;
        proxy_connect_timeout 5s;
    }

    # WebSocket support
    location /socket.io {
        proxy_pass http://backend/socket.io;
        proxy_http_version 1.1;
        proxy_buffering off;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "Upgrade";
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    }

    # Metrics (restricted to localhost)
    location /metrics {
        allow 127.0.0.1;
        allow 10.0.0.0/8;  # Docker network
        deny all;
        proxy_pass http://backend/metrics;
    }
}

server {
    listen 443 ssl http2;
    server_name agentshield.example.com;
    
    ssl_certificate /etc/nginx/ssl/cert.pem;
    ssl_certificate_key /etc/nginx/ssl/key.pem;
    ssl_session_timeout 1d;
    ssl_session_cache shared:SSL:50m;
    ssl_protocols TLSv1.2 TLSv1.3;
    ssl_ciphers HIGH:!aNULL:!MD5;
    
    # Same location blocks as above
}
```

### Validation Checklist
- [ ] Backend Docker image builds successfully
- [ ] LLM Docker image builds successfully
- [ ] docker-compose.prod.yml successfully starts all services
- [ ] Health check endpoint responds
- [ ] All API routes accessible through Nginx
- [ ] WebSocket connections work through Nginx
- [ ] SSL certificates valid
- [ ] Services restart automatically on failure

### Testing
```bash
# Build images
docker build -t agentshield-backend backend/
docker build -t agentshield-llm llm/

# Start production stack
docker-compose -f docker-compose.prod.yml up -d

# Verify health
curl http://localhost/health
curl http://localhost/api/audit

# Verify WebSocket
curl http://localhost/socket.io/?transport=polling
```

---

## Testing Framework Setup

### Install Test Dependencies
```bash
npm install --save-dev jest ts-jest @types/jest supertest @types/supertest
```

### Jest Configuration
```json
{
  "preset": "ts-jest",
  "testEnvironment": "node",
  "testMatch": ["**/__tests__/**/*.ts", "**/?(*.)+(spec|test).ts"],
  "collectCoverage": true,
  "collectCoverageFrom": ["src/**/*.ts", "!src/**/*.d.ts"],
  "coverageThreshold": {
    "global": {
      "branches": 70,
      "functions": 70,
      "lines": 70,
      "statements": 70
    }
  }
}
```

### Run Tests
```bash
npm test              # Run all tests
npm test -- BugFix1   # Run specific bug fix tests
npm test -- --watch   # Run in watch mode
npm test -- --coverage # Generate coverage report
```

---

## Validation Checklist (All Bugs)

### Pre-Deployment
- [ ] All 10 bugs have passing tests
- [ ] Code coverage >70%
- [ ] No console.error or warning in logs
- [ ] All environment variables documented
- [ ] Database migrations reversible
- [ ] Load tested to 1000 req/min
- [ ] Backup/restore tested

### During Deployment
- [ ] Blue-green deployment strategy in place
- [ ] Health checks pass on all services
- [ ] Database schema migration runs without errors
- [ ] No 5xx errors in first hour
- [ ] Audit trail verified for test calls

### Post-Deployment
- [ ] Monitor metrics for 24 hours
- [ ] No spikes in error rate
- [ ] Response times within SLA
- [ ] Alert thresholds tuned
- [ ] Runbook updated

---

## Troubleshooting

### WebSocket Connection Fails
```
Check:
1. Redis is running: redis-cli ping
2. Socket.io middleware: Check JWT token validity
3. Network: Verify firewall allows WebSocket upgrade
4. Fallback: Check polling is working
```

### Timeout Sweep Not Working
```
Check:
1. Redis lock acquired: redis-cli GET agentshield:lock:approval-timeout-sweep
2. Task running: grep "timeout sweep" logs
3. No database errors: Check postgresql logs
4. Multiple instances: Verify only one runs sweep
```

### CORS Errors
```
Check:
1. Origin matches allowed list: echo $ALLOWED_ORIGINS
2. Credentials header set: fetch(..., { credentials: 'include' })
3. Preflight OPTIONS working: curl -X OPTIONS -H "Origin: ..." http://api/
```

### Health Check Fails
```
Check:
1. Database connectivity: psql -U $DB_USER -d $DB_NAME -c "SELECT 1"
2. LLM availability: curl http://llm-api:8000/health
3. Connection pool: grep "pool exhausted" logs
```

---

## Rollback Procedures

### If Bug #1 Fails (WebSocket)
```bash
# Revert Socket.io setup, fallback to polling (already implemented)
git revert <websocket-commit>
# Polling will continue to work
```

### If Bug #2 Fails (Timeout Sweep)
```bash
# Disable timeout sweep, manually approve pending requests
# Restore previous timeout sweep (inline version)
git revert <timeout-sweep-commit>
# Create manual approval jobs
```

### If Bug #5 Fails (Pool Exhaustion)
```bash
# Reduce pool size to avoid exhaustion
# Increase query timeout to allow slower operations
git revert <pool-config-commit>
# Manually monitor pool metrics
```

---

## Documentation Updates

After implementing all bugs, update:
1. `README.md` - Add deployment instructions
2. `ARCHITECTURE.md` - Add real-time data flow
3. `API_DOCS.md` - Add /health endpoint docs
4. `TROUBLESHOOTING.md` - Add debugging guides
5. `DEPLOYMENT_GUIDE.md` - Add runbook

---

## Success Criteria

All bugs fixed when:
- ✅ Test suite passes (100%)
- ✅ No console errors in production
- ✅ All endpoints respond <500ms (p99)
- ✅ Zero unhandled exceptions per 1M requests
- ✅ Dashboard shows real-time events (<100ms)
- ✅ Approval timeout works reliably
- ✅ Database connection pool stable
- ✅ Health check accurately reflects service status
- ✅ CORS allows production origins
- ✅ Services deployable via Docker

---

## Timeline

| Week | Phase | Bugs | Status |
|------|-------|------|--------|
| Week 1 | Phase 1 | #10, #3, #4 | Implementation |
| Week 1 | Phase 2 | #5, #2 | Implementation |
| Week 2 | Phase 3 | #1, #6 | Implementation |
| Week 2 | Phase 4 | #7, #8, #9 | Implementation |
| Week 2 | Testing | All | Testing + Fixes |
| Week 3 | Staging | All | Deployment to Staging |
| Week 3 | Production | All | Gradual Production Rollout |

---

**Document Version:** 1.0  
**Last Updated:** October 6, 2026  
**Author:** AgentShield Development Team
