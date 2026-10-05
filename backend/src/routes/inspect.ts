import { Router, Request, Response } from "express";
import { inspect } from "../interceptor";
import type { InspectRequest } from "../types";

const router = Router();

/**
 * POST /inspect
 * Submit a tool call for inspection.
 */
router.post("/", async (req: Request, res: Response) => {
  const body = req.body as Partial<InspectRequest>;

  if (!body.tool || typeof body.tool !== "string") {
    res.status(400).json({ error: '"tool" (string) is required' });
    return;
  }

  if (!body.args || typeof body.args !== "object" || Array.isArray(body.args)) {
    res.status(400).json({ error: '"args" (object) is required' });
    return;
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
});

export default router;
