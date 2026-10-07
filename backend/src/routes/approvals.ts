import { Router, Request, Response } from "express";
import {
  listApprovalRequests,
  getApprovalRequest,
  resolveApproval,
} from "../approvalGate";
import { asyncHandler } from "../middleware/asyncHandler";
import { ErrorFactory } from "../errors/ErrorFactory";
import { requireRole } from "../middleware/authorization";
import type { AuthenticatedRequest } from "../middleware/authorization";
import type { ApprovalStatus } from "../types";

const router = Router();

/**
 * GET /approvals
 * List approval requests. Optional ?status=pending|approved|rejected|timeout
 */
router.get(
  "/",
  asyncHandler(async (_req: Request, res: Response) => {
    const status = _req.query.status as ApprovalStatus | undefined;
    const limit = Math.min(Number(_req.query.limit ?? 50), 200);
    const requests = await listApprovalRequests(status, limit);
    res.json({ count: requests.length, requests });
  })
);

/**
 * GET /approvals/:id
 */
router.get(
  "/:id",
  asyncHandler(async (req: Request, res: Response) => {
    const request = await getApprovalRequest(req.params.id);
    if (!request) {
      throw ErrorFactory.notFound("Approval request");
    }
    res.json(request);
  })
);

/**
 * POST /approvals/:id/approve
 * Body: { resolvedBy: string }
 */
router.post(
  "/:id/approve",
  requireRole("admin", "approver"),
  asyncHandler(async (req: Request, res: Response) => {
    const resolvedBy = (req as AuthenticatedRequest).user?.id;
    if (!resolvedBy) {
      throw ErrorFactory.invalidInput('"resolvedBy" is required');
    }
    const updated = await resolveApproval({
      requestId: req.params.id,
      approved: true,
      resolvedBy,
    });
    res.json({ message: "Approved", request: updated });
  })
);

/**
 * POST /approvals/:id/reject
 * Body: { resolvedBy: string, rejectionReason?: string }
 */
router.post(
  "/:id/reject",
  requireRole("admin", "approver"),
  asyncHandler(async (req: Request, res: Response) => {
    const { rejectionReason } = req.body as {
      rejectionReason?: string;
    };
    const resolvedBy = (req as AuthenticatedRequest).user?.id;
    if (!resolvedBy) {
      throw ErrorFactory.invalidInput('"resolvedBy" is required');
    }
    const updated = await resolveApproval({
      requestId: req.params.id,
      approved: false,
      resolvedBy,
      rejectionReason,
    });
    res.json({ message: "Rejected", request: updated });
  })
);

export default router;
