import { Router } from "express";
import { prisma } from "@brfut/db";
import { asyncHandler } from "../middleware/asyncHandler.js";

export const matchesRouter = Router();

matchesRouter.get(
  "/:matchId",
  asyncHandler(async (req, res) => {
    const { matchId } = req.params;
    const match = await prisma.match.findUnique({
      where: { id: matchId },
      include: { homeClub: true, awayClub: true },
    });

    if (!match) {
      res.status(404).json({ error: "Match not found" });
      return;
    }

    res.json(match);
  })
);
