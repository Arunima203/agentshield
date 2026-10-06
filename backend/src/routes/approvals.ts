import { Router, Request, Response } from "express";
import {
  listApprovalRequests,
  getApprovalRequest,
  resolveApproval,
} from "../approvalGate";
import type { ApprovalStatus } from "../types";

const router = Router();

/**
 * GET /approvals
 * List approval requests. Optional ?status=pending|approved|rejected|timeout
 */
router.get("/", async (_req: Request, res: Response) => {
  const status = _req.query.status as ApprovalStatus | undefined;
  const limit = Math.min(Number(_req.query.limit ?? 50), 200);
  const requests = await listApprovalRequests(status, limit);
  res.json({ count: requests.length, requests });
});

/**
 * GET /approvals/:id
 */
router.get("/:id", async (req: Request, res: Response) => {
  const request = await getApprovalRequest(req.params.id);
  if (!request) {
    res.status(404).json({ error: "Approval request not found" });
    return;
  }
  res.json(request);
});

/**
 * POST /approvals/:id/approve
 * Body: { resolvedBy: string }
 */
router.post("/:id/approve", async (req: Request, res: Response) => {
  const { resolvedBy } = req.body as { resolvedBy?: string };
  if (!resolvedBy) {
    res.status(400).json({ error: '"resolvedBy" is required' });
    return;
  }
  try {
    const updated = await resolveApproval({ requestId: req.params.id, approved: true, resolvedBy });
    res.json({ message: "Approved", request: updated });
  } catch (err) {
    res.status(400).json({ error: err instanceof Error ? err.message : String(err) });
  }
});

/**
 * POST /approvals/:id/reject
 * Body: { resolvedBy: string, rejectionReason?: string }
 */
router.post("/:id/reject", async (req: Request, res: Response) => {
  const { resolvedBy, rejectionReason } = req.body as {
    resolvedBy?: string;
    rejectionReason?: string;
  };
  if (!resolvedBy) {
    res.status(400).json({ error: '"resolvedBy" is required' });
    return;
  }
  try {
    const updated = await resolveApproval({
      requestId: req.params.id,
      approved: false,
      resolvedBy,
      rejectionReason,
    });
    res.json({ message: "Rejected", request: updated });
  } catch (err) {
    res.status(400).json({ error: err instanceof Error ? err.message : String(err) });
  }
});

export default router;
