import { Router, Request, Response } from "express";
import { queryAuditLog, getAuditStats, pruneOldEntries } from "../auditLogger";
import { asyncHandler } from "../middleware/asyncHandler";

const router = Router();

/**
 * GET /audit
 * Query params: tool, decision, agentId, since, limit, offset
 */
router.get(
  "/",
  asyncHandler(async (req: Request, res: Response) => {
    const entries = await queryAuditLog({
      tool: req.query.tool as string | undefined,
      decision: req.query.decision as string | undefined,
      agentId: req.query.agentId as string | undefined,
      since: req.query.since as string | undefined,
      limit: req.query.limit
        ? Math.min(Number(req.query.limit), 500)
        : 50,
      offset: req.query.offset ? Number(req.query.offset) : 0,
    });
    res.json({ count: entries.length, entries });
  })
);

/**
 * GET /audit/stats
 */
router.get(
  "/stats",
  asyncHandler(async (_req: Request, res: Response) => {
    const stats = await getAuditStats();
    res.json(stats);
  })
);

/**
 * DELETE /audit/prune
 */
router.delete(
  "/prune",
  asyncHandler(async (_req: Request, res: Response) => {
    const deleted = await pruneOldEntries();
    res.json({ message: `Pruned ${deleted} entries` });
  })
);

export default router;
