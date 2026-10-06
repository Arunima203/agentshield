import { Router, Request, Response } from "express";
import {
  listApprovalRequests,
  getApprovalRequest,
  resolveApproval,
} from "../approvalGate";
import { AuthenticatedRequest, requireRole } from "../middleware/jwtAuth";
import type { ApprovalStatus } from "../types";

const router = Router();
const approvalAccess = requireRole("admin", "approver");

/**
 * GET /approvals
 * List approval requests. Optional ?status=pending|approved|rejected|timeout
 */
router.get("/", approvalAccess, async (_req: Request, res: Response) => {
  const status = _req.query.status as ApprovalStatus | undefined;
  const limit = Math.min(Number(_req.query.limit ?? 50), 200);
  const requests = await listApprovalRequests(status, limit);
  res.json({ count: requests.length, requests });
});

/**
 * GET /approvals/:id
 */
router.get("/:id", approvalAccess, async (req: Request, res: Response) => {
  const request = await getApprovalRequest(req.params.id);
  if (!request) {
    res.status(404).json({ error: "Approval request not found" });
    return;
  }
  res.json(request);
});

/**
 * POST /approvals/:id/approve
 * The approver identity is taken from the authenticated token.
 */
router.post("/:id/approve", approvalAccess, async (req: Request, res: Response) => {
  try {
    const approver = (req as AuthenticatedRequest).user!;
    const updated = await resolveApproval({ requestId: req.params.id, approved: true, resolvedBy: approver.email });
    res.json({ message: "Approved", request: updated });
  } catch (err) {
    res.status(400).json({ error: err instanceof Error ? err.message : String(err) });
  }
});

/**
 * POST /approvals/:id/reject
 * Body: { rejectionReason?: string }
 */
router.post("/:id/reject", approvalAccess, async (req: Request, res: Response) => {
  const { rejectionReason } = req.body as { rejectionReason?: string };
  try {
    const approver = (req as AuthenticatedRequest).user!;
    const updated = await resolveApproval({
      requestId: req.params.id,
      approved: false,
      resolvedBy: approver.email,
      rejectionReason,
    });
    res.json({ message: "Rejected", request: updated });
  } catch (err) {
    res.status(400).json({ error: err instanceof Error ? err.message : String(err) });
  }
});

export default router;
