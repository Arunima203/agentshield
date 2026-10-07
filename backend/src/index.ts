import "dotenv/config";
import { createApp } from "./app";
import { loadConfig } from "./config";
import { getDb } from "./auditLogger";
import { logger } from "./logger";
import { startTimeoutSweep } from "./tasks/timeoutSweep";
import { setupSocketIO, setGlobalIO } from "./realtime/socketServer";

const CTX = "Bootstrap";

async function main(): Promise<void> {
  // 1. Load config
  const config = loadConfig();
  logger.info(CTX, `Config loaded (version=${config.version})`);

  // 2. Initialise database (runs migrations)
  await getDb();

  // 3. Create Express app
  const app = createApp();

  // 4. Setup Socket.io for real-time events
  const { httpServer, io } = setupSocketIO(app);
  setGlobalIO(io);
  logger.info(CTX, "Socket.io server initialized");

  // 5. Start background timeout sweep task with distributed locking
  startTimeoutSweep();

  // 6. Start HTTP/WebSocket server
  const port = parseInt(process.env.PORT ?? "3000", 10);
  const host = process.env.HOST ?? "localhost";

  httpServer.listen(port, host, () => {
    logger.info(CTX, `AgentShield listening on http://${host}:${port}`);
    logger.info(CTX, `WebSocket endpoint: ws://${host}:${port}`);
    logger.info(CTX, `Approval mode : ${process.env.APPROVAL_MODE ?? "auto"}`);
    logger.info(CTX, `Risk thresholds — block: ${config.risk.block_threshold}, review: ${config.risk.review_threshold}`);
    logger.info(CTX, "────────────────────────────────────────────────");
    logger.info(CTX, "  POST /inspect                  inspect a tool call");
    logger.info(CTX, "  GET  /approvals                list pending approvals");
    logger.info(CTX, "  POST /approvals/:id/approve    approve a tool call");
    logger.info(CTX, "  POST /approvals/:id/reject     reject a tool call");
    logger.info(CTX, "  GET  /audit                    query audit log");
    logger.info(CTX, "  GET  /audit/stats              aggregated stats");
    logger.info(CTX, "  GET  /config                   view active config");
    logger.info(CTX, "  POST /config/reload            reload config from disk");
    logger.info(CTX, "  GET  /health                   health check");
    logger.info(CTX, "────────────────────────────────────────────────");
    logger.info(CTX, "  WS   /socket.io                real-time events (approvals, audit)");
    logger.info(CTX, "────────────────────────────────────────────────");
  });
}

main().catch((err) => {
  logger.error(CTX, "Fatal startup error", err);
  process.exit(1);
});
