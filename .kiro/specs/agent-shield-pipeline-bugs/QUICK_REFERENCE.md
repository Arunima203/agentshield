# AgentShield Pipeline Bugs - Quick Reference

## Overview Table

| # | Bug | Category | Severity | Tech Stack | Effort | Impact |
|---|-----|----------|----------|-----------|--------|--------|
| 1 | WebSocket Real-Time | Real-time | HIGH | Socket.io + Redis | 1 day | 100x latency improvement |
| 2 | Timeout Sweep Locking | Distribution | HIGH | Redis Lock + DB Txn | 4h | Zero race conditions |
| 3 | Routes/Inspect Errors | Error Handling | HIGH | Error Factory + Middleware | 2h | 100% exception coverage |
| 4 | Interceptor Errors | Error Handling | HIGH | Try-catch + Fallback | 2h | Safe error defaults |
| 5 | Pool Exhaustion | Performance | HIGH | Pool Monitor + Timeouts | 3h | Prevents service outage |
| 6 | Timeout Enforcement | Performance | HIGH | PostgreSQL statement_timeout | 30m | Cancels hanging queries |
| 7 | Idempotent Logging | Data Integrity | MEDIUM | Unique constraint | 15m | Zero duplicates |
| 8 | CORS Config | Security | MEDIUM | Env-based config | 30m | Production ready |
| 9 | Health Checks | Observability | MEDIUM | Extended /health | 1h | Automated monitoring |
| 10 | Dockerfiles & Nginx | Deployment | CRITICAL | Docker + Nginx | 1.5h | Containerizable |

## Implementation Order

```
Week 1:
  Phase 1 (2h): Docker setup → Production blockage resolved
  Phase 2 (6h): Error handling → Service stability guaranteed
  Phase 3 (7h): Database & distribution → Data integrity assured
  
Week 2:
  Phase 4 (1h): Real-time → User experience improved
  Phase 5 (2h): Configuration & monitoring → Production ready
  Testing (8h): Comprehensive validation
```

## Key Files Created

```
.kiro/specs/agent-shield-pipeline-bugs/
  ├── technical-design.md (Comprehensive 2000+ line design)
  ├── IMPLEMENTATION_GUIDE.md (Step-by-step per bug)
  ├── ARCHITECTURE_DECISIONS.md (Rationale and tradeoffs)
  ├── QUICK_REFERENCE.md (This file)
  └── .config.kiro (Spec configuration)
```

## Database Changes

```sql
-- Bug #5, #6: Statement timeout
ALTER DATABASE agentshield SET statement_timeout = '30s';

-- Bug #2: Timeout tracking
ALTER TABLE approval_requests ADD COLUMN resolved_at TIMESTAMP;
ALTER TABLE audit_log ADD COLUMN updated_at TIMESTAMP DEFAULT NOW();

-- Bug #7: Prevent duplicates
ALTER TABLE audit_log ADD CONSTRAINT uq_audit_tool_call_id UNIQUE (tool_call_id);

-- Bug #4: Track errors
ALTER TABLE audit_log ADD COLUMN error_message VARCHAR;
ALTER TABLE audit_log ADD COLUMN is_failed_inspection BOOLEAN DEFAULT FALSE;

-- Bug #2, #5, #6: Query optimization
CREATE INDEX idx_approval_status_created ON approval_requests(status, created_at) WHERE status='pending';
CREATE INDEX idx_audit_tool_call_id ON audit_log(tool_call_id);
CREATE INDEX idx_approvals_status_created ON approval_requests(status, created_at DESC) WHERE status != 'resolved';
```

## Environment Variables

### Development (.env.local)
```bash
# Bug #1: Real-time
REDIS_URL=redis://localhost:6379
FRONTEND_URL=http://localhost:3000

# Bug #5, #6: Connection Pool
DB_POOL_SIZE=20
DB_POOL_MIN=5
DB_STATEMENT_TIMEOUT_MS=30000
DB_QUERY_TIMEOUT_MS=30000

# Bug #8: CORS
ALLOWED_ORIGINS=http://localhost:3000,http://127.0.0.1:3000

# Bug #2: Timeout sweep
TIMEOUT_SWEEP_INTERVAL=60000
TIMEOUT_SWEEP_LOCK_TTL=30000
```

### Production (.env.production)
```bash
# Bug #1: Real-time
REDIS_URL=redis://redis-cluster:6379
FRONTEND_URL=https://agentshield.yourdomain.com

# Bug #5, #6: Connection Pool
DB_POOL_SIZE=50
DB_POOL_MIN=10
DB_STATEMENT_TIMEOUT_MS=30000
DB_QUERY_TIMEOUT_MS=30000

# Bug #8: CORS
ALLOWED_ORIGINS=https://agentshield.yourdomain.com,https://staging.yourdomain.com

# Bug #2: Timeout sweep
TIMEOUT_SWEEP_INTERVAL=60000
TIMEOUT_SWEEP_LOCK_TTL=30000
```

## Dependencies to Add

```json
{
  "dependencies": {
    "socket.io": "^4.7.0",
    "redis": "^4.6.0",
    "cors": "^2.8.5"
  },
  "devDependencies": {
    "jest": "^29.0.0",
    "@types/jest": "^29.0.0",
    "ts-jest": "^29.0.0",
    "supertest": "^6.0.0"
  }
}
```

## Code Patterns Used

### Error Handling (Bugs #3, #4)
```typescript
import { asyncHandler } from '../middleware/asyncHandler';
import { ErrorFactory } from '../errors/ErrorFactory';

router.post('/', asyncHandler(async (req, res) => {
  if (!req.body.tool) {
    throw ErrorFactory.invalidInput('tool is required');
  }
  const result = await process(req.body);
  res.json(result);
}));
```

### Distributed Locking (Bug #2)
```typescript
const lockValue = await lockManager.acquireLock('resource', 30000);
if (!lockValue) {
  logger.debug('Lock held, skipping');
  return;
}

try {
  // Do work
  await db.transaction(async (tx) => { /* ... */ });
} finally {
  await lockManager.releaseLock('resource', lockValue);
}
```

### Real-Time Events (Bug #1)
```typescript
// Backend
await eventBus.publishApprovalCreated(approval);

// Frontend
const events = useRealtimeEvents<ApprovalRequest>('approval:created', 'approvals');
return events.map(e => <ApprovalCard approval={e} />);
```

### Health Checks (Bug #9)
```typescript
app.get('/health', async (req, res) => {
  const health = await getHealthStatus();
  res.status(health.status === 'ok' ? 200 : 503).json(health);
});
```

## Performance Targets

| Operation | Target | Current |
|-----------|--------|---------|
| Tool inspection | <500ms p99 | 500ms |
| Real-time events | <100ms | 5000ms ✗ |
| Database query | <100ms p99 | 50ms ✓ |
| Health check | <500ms | N/A ✓ |
| Timeout sweep | 60s periodic | Race condition ✗ |

## Testing Commands

```bash
# Run all tests
npm test

# Run specific bug tests
npm test -- BugFix1  # WebSocket
npm test -- BugFix2  # Timeout sweep
npm test -- BugFix3  # Routes errors
npm test -- BugFix4  # Interceptor errors
npm test -- BugFix5  # Pool exhaustion
npm test -- BugFix6  # Timeout enforcement
npm test -- BugFix7  # Idempotent logging
npm test -- BugFix8  # CORS
npm test -- BugFix9  # Health checks
npm test -- BugFix10 # Dockerfiles

# Watch mode
npm test -- --watch

# Coverage report
npm test -- --coverage
```

## Deployment Checklist

### Pre-Deployment
- [ ] All tests pass (coverage >70%)
- [ ] Code review approved
- [ ] Database migration tested in staging
- [ ] Backup created
- [ ] Rollback plan documented

### Deployment
- [ ] Blue-green deployment prepared
- [ ] Monitoring alerts configured
- [ ] Stakeholders notified
- [ ] Support team briefed

### Post-Deployment
- [ ] Monitor error rate (< 1%)
- [ ] Monitor latency (p99 < 2s)
- [ ] Monitor resource usage
- [ ] Collect feedback

## Troubleshooting Guide

### WebSocket Not Working
```bash
# Check Redis
redis-cli ping

# Check Socket.io logs
grep "Socket.io" logs/app.log

# Check browser console for CORS errors
# Verify firewall allows WebSocket upgrade
```

### Timeout Sweep Not Working
```bash
# Check Redis lock
redis-cli GET agentshield:lock:approval-timeout-sweep

# Check logs
grep "TimeoutSweep" logs/app.log

# Verify database connectivity
psql -U agentshield -d agentshield -c "SELECT 1"
```

### Pool Exhaustion
```bash
# Check pool metrics
curl http://localhost:3000/metrics | grep db_pool_connections

# Check PostgreSQL connections
psql -U agentshield -d agentshield -c "SELECT count(*) FROM pg_stat_activity WHERE datname='agentshield'"

# Check slow queries
psql -U agentshield -d agentshield -c "SELECT * FROM pg_stat_statements ORDER BY mean_exec_time DESC LIMIT 10"
```

### CORS Issues
```bash
# Test preflight
curl -X OPTIONS -H "Origin: https://yourdomain.com" \
  -H "Access-Control-Request-Method: POST" \
  http://localhost:3000/api/audit

# Check allowed origins
echo $ALLOWED_ORIGINS
```

## Success Criteria

After implementing all bugs, the system should:

✅ **Availability**
- No unhandled exceptions (< 1 per 1M requests)
- Health check accurate
- Auto-restart on failure

✅ **Performance**
- Real-time events < 100ms
- API endpoints < 500ms p99
- Zero hanging queries (30s timeout)

✅ **Reliability**
- Zero duplicate audit entries
- Timeout sweep never misses expiration
- Distributed locks prevent race conditions

✅ **Observability**
- All errors logged with context
- Prometheus metrics for monitoring
- Health check shows service degradation

✅ **Deployability**
- Docker images build successfully
- Docker Compose starts all services
- Kubernetes deployment ready

## Next Steps

1. **Review** - Team reviews technical design
2. **Plan** - Schedule implementation across 2 weeks
3. **Develop** - Follow implementation guide per bug
4. **Test** - Run test suite (aim for >90% coverage)
5. **Stage** - Deploy to staging environment for 48h
6. **Production** - Gradual rollout (1 replica at a time)
7. **Monitor** - Watch metrics for 7 days
8. **Document** - Update runbooks and architecture docs

## Links to Detailed Docs

- **Full Technical Design:** `technical-design.md` (2000+ lines)
- **Step-by-Step Guide:** `IMPLEMENTATION_GUIDE.md` (Per-bug instructions)
- **Architecture Rationale:** `ARCHITECTURE_DECISIONS.md` (Why these choices)
- **Quick Reference:** This file

## Contact & Support

For questions on specific bugs:
- Bug #1-2: Real-time + Distribution → @platform-team
- Bug #3-6: Error handling + Performance → @backend-team
- Bug #7-9: Data Integrity + Observability → @database-team
- Bug #10: Deployment → @devops-team

---

**Last Updated:** October 6, 2026  
**Status:** Ready for implementation  
**Estimated Timeline:** 6-8 engineering days  
**Production Target:** 2 weeks from start
