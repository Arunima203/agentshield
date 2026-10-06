import { Router, Request, Response } from "express";
import { queryAuditLog, getAuditStats, pruneOldEntries } from "../auditLogger";
import { getConfig } from "../config";

const router = Router();

/**
 * GET /audit
 * Query params: tool, decision, agentId, since, limit
 */
router.get("/", async (req: Request, res: Response) => {
  const startTime = req.query.since as string | undefined;
  const endTime = new Date().toISOString();
  const limit = req.query.limit ? Math.min(Number(req.query.limit), 500) : 100;

  const entries = await queryAuditLog(
    req.query.agentId as string | undefined,
    startTime,
    endTime,
    limit
  );

  res.json({ count: entries.length, entries });
});

/**
 * GET /audit/stats
 */
router.get("/stats", async (_req: Request, res: Response) => {
  // Last 24 hours
  const endTime = new Date().toISOString();
  const startTime = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();

  const stats = await getAuditStats(startTime, endTime);
  res.json(stats);
});

/**
 * DELETE /audit/prune
 */
router.delete("/prune", async (_req: Request, res: Response) => {
  const config = getConfig();
  const retentionDays = config.audit.retention_days || 90;
  const deleted = await pruneOldEntries(retentionDays);
  res.json({ message: `Pruned ${deleted} entries older than ${retentionDays} days` });
});

export default router;
