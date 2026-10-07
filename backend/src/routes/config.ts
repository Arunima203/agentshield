import { Router, Request, Response } from "express";
import { getConfig, reloadConfig } from "../config";
import { asyncHandler } from "../middleware/asyncHandler";

const router = Router();

/**
 * GET /config
 * Return the currently active configuration.
 */
router.get(
  "/",
  asyncHandler(async (_req: Request, res: Response) => {
    const config = getConfig();
    res.json(config);
  })
);

/**
 * POST /config/reload
 * Force-reload the config file from disk.
 */
router.post(
  "/reload",
  asyncHandler(async (_req: Request, res: Response) => {
    const config = reloadConfig();
    res.json({ message: "Config reloaded", config });
  })
);

export default router;
