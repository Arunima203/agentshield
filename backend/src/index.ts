import "dotenv/config";
import { createApp } from "./app";
import { loadConfig } from "./config";
import { getDb } from "./auditLogger";
import { seedDemoUsers } from "./routes/auth";
import { logger } from "./logger";
import { startTimeoutSweep } from "./tasks/timeoutSweep";
import { setupSocketIO, setGlobalIO } from "./realtime/socketServer";

const CTX = "Bootstrap";

async function main(): Promise<void> {
  if (process.env.NODE_ENV === "production") {
    const accessSecret = process.env.JWT_ACCESS_SECRET;
    const refreshSecret = process.env.JWT_REFRESH_SECRET;
    if (!accessSecret || accessSecret.length < 32 ||
        !refreshSecret || refreshSecret.length < 32 ||
        accessSecret === refreshSecret) {
      throw new Error("Production requires distinct JWT_ACCESS_SECRET and JWT_REFRESH_SECRET values of at least 32 characters");
    }
  }

  // 1. Load config
  const config = loadConfig();
  logger.info(CTX, `Config loaded (version=${config.version})`);

  // 2. Initialise database (runs migrations)
  await getDb();
  await seedDemoUsers();

  // 3. Create Express app
  const app = createApp();

  // 4. Setup Socket.io for real-time events
  const { httpServer, io } = setupSocketIO(app);
  setGlobalIO(io);
  logger.info(CTX, "Socket.io server initialized");

  // 5. Start background timeout sweep task with distributed locking
  startTimeoutSweep();

  // 6. Start HTTP/WebSocket server
  const port = parseInt(process.env.PORT ?? "3002", 10);
  const host = process.env.HOST ?? "0.0.0.0";

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
