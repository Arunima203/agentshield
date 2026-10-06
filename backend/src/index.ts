import "dotenv/config";
import { createApp } from "./app";
import { loadConfig } from "./config";
import { initDatabase } from "./database";
import { sweepTimeouts } from "./approvalGate";
import { initializeDefaultUsers } from "./initUsers";
import { logger } from "./logger";

const CTX = "Bootstrap";

async function main(): Promise<void> {
  // 1. Load config
  const config = loadConfig();
  logger.info(CTX, `Config loaded (version=${config.version})`);

  // 2. Initialize database with migrations
  await initDatabase();

  // 3. Initialize default users
  await initializeDefaultUsers();

  // 4. Start approval-timeout sweep every 60 s
  setInterval(async () => {
    const swept = await sweepTimeouts();
    if (swept > 0) {
      logger.info(CTX, `Swept ${swept} timed-out approval requests`);
    }
  }, 60_000);

  // 5. Start HTTP server
  const app = createApp();
  const port = parseInt(process.env.PORT ?? "3000", 10);
  const host = process.env.HOST ?? "localhost";

  app.listen(port, host, () => {
    logger.info(CTX, `AgentShield listening on http://${host}:${port}`);
    logger.info(CTX, `Approval mode : ${process.env.APPROVAL_MODE ?? "auto"}`);
    logger.info(CTX, `Risk thresholds — block: ${config.risk.block_threshold}, review: ${config.risk.review_threshold}`);
    logger.info(CTX, "────────────────────────────────────────────────");
    logger.info(CTX, "  POST /auth/login               authenticate user");
    logger.info(CTX, "  POST /auth/refresh             refresh access token");
    logger.info(CTX, "  GET  /auth/verify              verify access token");
    logger.info(CTX, "  POST /auth/logout              logout (acknowledgment)");
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
  });
}

main().catch((err) => {
  logger.error(CTX, "Fatal startup error", err);
  process.exit(1);
});
