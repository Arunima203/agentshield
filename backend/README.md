# AgentShield — Backend

Local-first security layer for AI agents built with Node.js + TypeScript + Express.

## Setup

```bash
cd backend
cp .env.example .env
npm install
npm run build
npm start
```

Server starts at `http://localhost:3002` by default so it can run alongside the Next.js frontend.

## API Endpoints

| Method | Route | Description |
|--------|-------|-------------|
| POST | `/inspect` | Submit a tool call for inspection |
| GET | `/approvals` | List approval requests |
| POST | `/approvals/:id/approve` | Approve a pending tool call |
| POST | `/approvals/:id/reject` | Reject a pending tool call |
| GET | `/audit` | Query audit log |
| GET | `/audit/stats` | Aggregated stats |
| GET | `/config` | View active config |
| POST | `/config/reload` | Reload config from disk |
| GET | `/health` | Health check |

## Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `PORT` | `3002` | HTTP and WebSocket port |
| `AGENTSHIELD_API_KEY` | *(unset)* | API key auth (disabled if not set) |
| `APPROVAL_MODE` | `auto` | `auto / strict / audit` |
| `DB_PATH` | `./data/agentshield.db` | SQLite database path |
| `LOG_LEVEL` | `info` | `debug / info / warn / error` |

## Architecture

```
src/
├── index.ts          — entry point
├── app.ts            — Express setup
├── interceptor.ts    — main inspection pipeline
├── riskDetector.ts   — risk scoring
├── secretsScanner.ts — secret redaction
├── approvalGate.ts   — approval queue
├── auditLogger.ts    — SQLite audit log
├── config.ts         — YAML config loader
├── logger.ts         — console logger
├── types.ts          — TypeScript types
├── middleware/
│   ├── auth.ts
│   └── errorHandler.ts
└── routes/
    ├── inspect.ts
    ├── approvals.ts
    ├── audit.ts
    └── config.ts
```
