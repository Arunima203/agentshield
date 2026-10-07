import { Router, Request, Response } from "express";
import { inspect } from "../interceptor";
import { asyncHandler } from "../middleware/asyncHandler";
import { ErrorFactory } from "../errors/ErrorFactory";
import type { InspectRequest } from "../types";

const router = Router();

/**
 * POST /inspect
 * Submit a tool call for inspection.
 */
router.post(
  "/",
  asyncHandler(async (req: Request, res: Response) => {
    const body = req.body as Partial<InspectRequest>;

    if (!body.tool || typeof body.tool !== "string") {
      throw ErrorFactory.invalidInput('"tool" (string) is required');
    }

    if (!body.args || typeof body.args !== "object" || Array.isArray(body.args)) {
      throw ErrorFactory.invalidInput('"args" (object) is required');
    }

    const result = await inspect({
      tool: body.tool,
      args: body.args,
      agentId: body.agentId,
      sessionId: body.sessionId,
      metadata: body.metadata,
    });

    const statusCode =
      result.decision === "allow"            ? 200 :
      result.decision === "require_approval" ? 202 :
      403;

    res.status(statusCode).json(result);
  })
);

export default router;
