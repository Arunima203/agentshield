# Agent-Shield Pipeline Bugs - Bugfix Requirements

## Introduction

Agent-Shield is a real-time AI security pipeline that intercepts LLM tool calls, performs risk analysis, and manages human approval workflows. The system has 10 critical bugs spanning real-time updates, distributed systems reliability, error handling, security, and performance concerns. This bugfix spec addresses these issues systematically using the bug condition methodology to ensure fixes are validated without introducing regressions.

**Impact Summary:**
- **Security**: Production environment misconfiguration (CORS), incomplete JWT refresh, missing error context
- **Reliability**: Stale data in approval workflows, single-instance timeout sweeps, database pool exhaustion risks
- **Performance**: Missing distributed timeout handling, undeduped audit logging
- **Maintainability**: Inconsistent error formats, incomplete health checks

---

## Bug Analysis

### Category 1: Real-Time Updates & WebSocket

#### Bug #1: No WebSocket/Real-Time Approval Updates

**Current Behavior (Defect)**

1.1 WHEN an approver loads the approval dashboard and another approver resolves an approval THEN the first approver's browser continues to show the stale approval status until they manually refresh the page
1.2 WHEN a new approval request is created THEN approvers are not notified in real-time and must manually check the dashboard or wait for a page refresh to see it
1.3 WHEN the approval status changes (approved/rejected/timeout) THEN the UI state becomes inconsistent with the backend until a manual refresh occurs

**Expected Behavior (Correct)**

2.1 WHEN an approver's UI is open THEN the system SHALL establish a WebSocket connection that receives real-time updates when ANY approval status changes
2.2 WHEN a new approval request is created THEN the system SHALL broadcast a real-time notification event to all connected approvers within 100ms
2.3 WHEN an approval is resolved THEN the system SHALL immediately push the updated approval status to all connected clients and trigger UI updates without requiring manual refresh

**Unchanged Behavior (Regression Prevention)**

3.1 WHEN an approver is not viewing the dashboard THEN the system SHALL CONTINUE TO function normally (no persistent WebSocket required when offline)
3.2 WHEN WebSocket connection is temporarily unavailable THEN the system SHALL CONTINUE TO support standard HTTP polling as a fallback
3.3 WHEN an approval is created or resolved THEN the system SHALL CONTINUE TO persist all data to the audit log
3.4 WHEN using non-WebSocket clients (curl, Postman) THEN the system SHALL CONTINUE TO provide full API functionality via HTTP

---

### Category 2: Distributed Systems & Clustering

#### Bug #2: Approval Timeout Sweep Not Distributed

**Current Behavior (Defect)**

1.4 WHEN running multiple backend instances in a cluster THEN the approval timeout sweep only runs on one instance, leaving other instances unaware of timeout events
1.5 WHEN an approval times out on instance A THEN instance B continues serving the approval as "pending" until it reloads from the database
1.6 WHEN multiple instances attempt to process the same timeout THEN there is no deduplication, risking duplicate timeout entries or race conditions in the audit log

**Expected Behavior (Correct)**

2.4 WHEN running in a clustered setup THEN the system SHALL use a distributed locking mechanism (Redis, etcd, or database-level lock) to ensure only one instance runs the timeout sweep at a time
2.5 WHEN an approval times out THEN the system SHALL update the approval_requests table atomically and broadcast the timeout event to all instances via a pub/sub mechanism or database trigger
2.6 WHEN the timeout sweep completes on one instance THEN all instances SHALL be notified and update their in-memory cache within 1 second

**Unchanged Behavior (Regression Prevention)**

3.5 WHEN running on a single instance THEN the system SHALL CONTINUE TO process timeouts correctly without requiring a distributed lock
3.6 WHEN an approval is manually resolved THEN the system SHALL CONTINUE TO prevent timeout sweep from overwriting the manual resolution
3.7 WHEN the database is unavailable THEN the system SHALL CONTINUE TO gracefully degrade (not crash the timeout sweep)

---

### Category 3: Error Handling & Standardization

#### Bug #3: Error Handling Gaps - Missing Try-Catch Blocks

**Current Behavior (Defect)**

1.7 WHEN `resolveApproval()` in approvalGate.ts encounters an unexpected database error THEN the error propagates to the caller without proper logging or error context
1.8 WHEN the LLM service times out during `inspect()` in interceptor.ts THEN the timeout error is not caught, leaving the request hanging or returning a raw axios error instead of a standardized response
1.9 WHEN `sweepTimeouts()` in approvalGate.ts encounters a database write error for a specific approval THEN the sweep stops entirely, abandoning remaining pending timeouts

**Expected Behavior (Correct)**

2.7 WHEN `resolveApproval()` encounters an error THEN the system SHALL catch the error, log it with full context (requestId, error type, stack trace), and return a standardized error response with appropriate HTTP status code
2.8 WHEN the LLM service times out during risk analysis THEN the system SHALL catch the timeout, log it, and return a 504 (Gateway Timeout) response with a fallback risk analysis
2.9 WHEN `sweepTimeouts()` encounters an error processing a specific approval THEN the system SHALL log the error for that approval, skip it, and continue processing remaining approvals without stopping

**Unchanged Behavior (Regression Prevention)**

3.8 WHEN `resolveApproval()` successfully resolves an approval THEN the system SHALL CONTINUE TO return the correct HTTP 200 response with the updated request
3.9 WHEN `inspect()` successfully completes THEN the system SHALL CONTINUE TO return the correct decision (allow/require_approval/block) with the proper HTTP status code
3.10 WHEN `sweepTimeouts()` successfully processes timeouts THEN the system SHALL CONTINUE TO update the database and audit log as before

---

#### Bug #5: Missing Error Response Standardization

**Current Behavior (Defect)**

1.10 WHEN different endpoints return errors THEN error response formats are inconsistent: some return `{ error: "message" }`, others return `{ message: "error" }`, and some return raw exception objects
1.11 WHEN a client receives an error response THEN the error structure is unpredictable, making client-side error handling brittle and inconsistent
1.12 WHEN debugging production errors THEN inconsistent error formats make it difficult to parse and correlate errors across logs

**Expected Behavior (Correct)**

2.10 WHEN any endpoint encounters an error THEN the system SHALL return a standardized error response with format: `{ error: { code: "ERROR_CODE", message: "Human-readable message", details: {} }, requestId: "uuid" }`
2.11 WHEN an endpoint returns an error response THEN the system SHALL include the HTTP status code in the response body and match it to standard error codes (400, 401, 403, 404, 409, 500, 503, 504)
2.12 WHEN a new error condition is added THEN the system SHALL enforce using the standardized error format through a centralized error factory function

**Unchanged Behavior (Regression Prevention)**

3.11 WHEN an endpoint returns a successful response THEN the system SHALL CONTINUE TO return the response in its current format without modification
3.12 WHEN clients parse error responses THEN existing error handling for `{ error: "message" }` format SHALL CONTINUE TO work (backward compatible initially)

---

### Category 4: Security & Authentication

#### Bug #4: CORS Restricted to Localhost

**Current Behavior (Defect)**

1.13 WHEN a production frontend on domain `https://production.agentshield.com` makes a request to the backend THEN the CORS policy blocks the request with error: "CORS: origin not allowed"
1.14 WHEN a frontend is deployed on a different domain or subdomain THEN all API calls fail regardless of authentication or authorization
1.15 WHEN the system is deployed behind a load balancer or proxy THEN the origin header may be rewritten, causing CORS failures even for legitimate requests

**Expected Behavior (Correct)**

2.13 WHEN the backend is deployed in production THEN the system SHALL accept requests from configured allowed origins (read from environment variable: `ALLOWED_ORIGINS`)
2.14 WHEN a request comes from an allowed origin THEN the system SHALL return proper CORS headers (Access-Control-Allow-Origin, Access-Control-Allow-Credentials) and allow the request
2.15 WHEN a request comes from an origin NOT in the allowed list THEN the system SHALL reject it with a 403 Forbidden response and NOT execute the request

**Unchanged Behavior (Regression Prevention)**

3.13 WHEN running in development mode THEN the system SHALL CONTINUE TO allow localhost and 127.0.0.1 for local testing
3.14 WHEN a non-browser client (curl, Postman, server-to-server) makes a request without an Origin header THEN the system SHALL CONTINUE TO allow it as before
3.15 WHEN the ALLOWED_ORIGINS environment variable is not set THEN the system SHALL default to localhost only (fail-safe default)

---

#### Bug #9: JWT Token Refresh Logic Incomplete

**Current Behavior (Defect)**

1.16 WHEN a user's JWT token expires THEN the next API request returns a 401 Unauthorized error with message "Token expired"
1.17 WHEN a 401 Token Expired error occurs THEN the client receives the error but has no way to automatically refresh the token; the user must manually log in again
1.18 WHEN an approval action takes longer than the token expiry time THEN the approval fails mid-operation, leaving the system in an inconsistent state (approval partially processed)

**Expected Behavior (Correct)**

2.16 WHEN a user's JWT token is about to expire (within 5 minutes) THEN the system SHALL issue a new token before the current one expires, either proactively or on-demand
2.17 WHEN a token expiry error occurs on an API request THEN the client SHALL be able to call a token refresh endpoint to obtain a new token without requiring manual login
2.18 WHEN a long-running operation (approval, analysis) exceeds the token lifetime THEN the system SHALL implement internal token refresh to prevent mid-operation failures

**Unchanged Behavior (Regression Prevention)**

3.16 WHEN a user logs out THEN the system SHALL CONTINUE TO invalidate their token (no refresh allowed)
3.17 WHEN authentication is disabled (dev mode) THEN the system SHALL CONTINUE TO work without requiring tokens
3.18 WHEN a token is manually revoked (e.g., password change) THEN the system SHALL CONTINUE TO reject refresh attempts for that token

---

### Category 5: Performance & Resource Management

#### Bug #6: Database Connection Pooling Not Validated

**Current Behavior (Defect)**

1.19 WHEN the system experiences high load (> 20 concurrent requests) THEN connections from the database pool are not returned properly, leading to connection exhaustion
1.20 WHEN the connection pool is exhausted THEN subsequent requests hang or timeout, causing cascading failures and potential system lockup
1.21 WHEN connections are held beyond their lifecycle THEN the pool configuration (max=20, idle timeout=30s) is not validated, and there is no monitoring of pool state

**Expected Behavior (Correct)**

2.19 WHEN the system experiences high load THEN each request SHALL properly acquire and release a database connection from the pool within the configured limits
2.20 WHEN the connection pool reaches 95% capacity THEN the system SHALL emit a warning log and trigger connection pool health check
2.21 WHEN the connection pool is fully exhausted THEN the system SHALL return a 503 Service Unavailable response instead of hanging indefinitely

**Unchanged Behavior (Regression Prevention)**

3.19 WHEN database queries complete normally THEN the system SHALL CONTINUE TO return correct data and release connections as before
3.20 WHEN the system is idle THEN connections SHALL CONTINUE TO be cleaned up based on the idle timeout (30s)
3.21 WHEN the database is offline THEN the system SHALL CONTINUE TO gracefully report database unavailability

---

#### Bug #7: LLM Service Timeout Not Enforced in All Paths

**Current Behavior (Defect)**

1.22 WHEN the LLM service endpoint (`/analyze`) is slow or unresponsive THEN some code paths check for timeout (75 seconds) but others do not, creating race conditions
1.23 WHEN `llmService.analyze()` is called from `inspect()` THEN the timeout is respected, but when called from background processes the timeout may not be enforced
1.24 WHEN the LLM service becomes unresponsive THEN the system may wait indefinitely in some paths, consuming resources and blocking approvals

**Expected Behavior (Correct)**

2.22 WHEN the LLM service is called from any code path THEN the system SHALL enforce a maximum timeout of 75 seconds (configurable via `LLM_API_TIMEOUT_MS`)
2.23 WHEN the LLM service times out THEN the system SHALL return a fallback analysis with message "LLM service timeout" and risk decision based on rule-based scoring
2.24 WHEN a long-running LLM analysis is in progress THEN the system SHALL monitor it and cancel it if it exceeds the timeout threshold

**Unchanged Behavior (Regression Prevention)**

3.22 WHEN the LLM service responds within the timeout THEN the system SHALL CONTINUE TO use the LLM response for decision-making
3.23 WHEN the LLM service is unavailable THEN the system SHALL CONTINUE TO fallback to rule-based scoring
3.24 WHEN a tool call is approved before LLM times out THEN the system SHALL CONTINUE TO allow execution

---

#### Bug #8: Audit Logging Duplicates - Write Operations Not Deduped

**Current Behavior (Defect)**

1.25 WHEN an approval is resolved THEN the audit log receives multiple duplicate entries for the same event (approval_resolved event written 2-3 times)
1.26 WHEN `updateAuditApproval()` is called from both `resolveApproval()` and `sweepTimeouts()` THEN duplicate audit entries are written without deduplication
1.27 WHEN the audit log grows large THEN storage and query performance suffer due to duplicate entries that clutter historical records

**Expected Behavior (Correct)**

2.25 WHEN an approval is resolved THEN the system SHALL write exactly one audit entry for the resolution event to the audit log
2.26 WHEN `updateAuditApproval()` is called multiple times for the same approval and same status THEN the system SHALL deduplicate and write only one entry
2.27 WHEN auditing write operations THEN the system SHALL use an idempotent key (e.g., approval_id + operation_type + timestamp_bucket) to prevent duplicates

**Unchanged Behavior (Regression Prevention)**

3.25 WHEN different operations occur (e.g., created, then resolved) THEN the system SHALL CONTINUE TO write separate audit entries for each operation
3.26 WHEN audit logging is enabled THEN the system SHALL CONTINUE TO provide a complete audit trail of all approval lifecycle events
3.27 WHEN querying audit logs THEN the system SHALL CONTINUE TO return entries in the correct chronological order

---

### Category 6: System Monitoring & Health

#### Bug #10: Health Check Endpoints Incomplete - Missing Database Health Verification

**Current Behavior (Defect)**

1.28 WHEN the `/health` endpoint is called THEN it returns a basic response without checking database connectivity
1.29 WHEN the database is unavailable or corrupted THEN the health check still returns status "ok", giving a false positive for system readiness
1.30 WHEN orchestration systems (Kubernetes) rely on the health check for liveness/readiness probes THEN they do not properly detect database failures and may route traffic to unhealthy instances

**Expected Behavior (Correct)**

2.28 WHEN the `/health` endpoint is called THEN the system SHALL verify database connectivity by executing a simple test query (SELECT 1)
2.29 WHEN the database is unavailable THEN the health check SHALL return status "degraded" or "unhealthy" and HTTP 503 (Service Unavailable)
2.30 WHEN used for Kubernetes readiness probes THEN the health check response SHALL accurately reflect whether the instance is ready to handle requests (database must be accessible)

**Unchanged Behavior (Regression Prevention)**

3.28 WHEN the database is healthy \THEN the system SHALL CONTINUE TO return status "ok" and HTTP 200
3.29 WHEN querying other health checks (LLM service, memory, disk) \THEN the system SHALL CONTINUE TO return their status as before
3.30 WHEN the health check passes \THEN the system SHALL CONTINUE TO allow normal request handling

---

## Summary by Category

| Category | Bugs | Impact | Criticality |
|----------|------|--------|------------|
| Real-Time Updates | #1 | Stale data, delayed approvals | High |
| Distributed Systems | #2 | Race conditions in clusters | High |
| Error Handling | #3, #5 | Poor observability, inconsistent APIs | Medium-High |
| Security | #4, #9 | Production misconfiguration, incomplete auth | High |
| Performance | #6, #7, #8 | Resource exhaustion, slow operations | High |
| Monitoring | #10 | False health status, cluster misconfiguration | Medium |

**Total Impact Points:** 10 bugs spanning 6 categories affecting security, reliability, performance, and maintainability.

