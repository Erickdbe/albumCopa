import { Router } from "express";
import { Prisma, prisma } from "@brfut/db";
import type { TacticStyle } from "@brfut/shared-types";
import { asyncHandler } from "../middleware/asyncHandler.js";
import { requireAuth } from "../auth/middleware.js";
import { requireClubOwner } from "../middleware/requireClubOwner.js";

export const clubsRouter = Router();

const ALLOWED_FORMATIONS = ["4-4-2", "4-3-3", "3-5-2", "4-2-3-1", "5-3-2", "4-4-1-1", "3-4-3"];
const MENTALITIES: TacticStyle["mentality"][] = ["defensive", "balanced", "offensive"];

// Registered before "/:clubId" — otherwise Express would match "mine" as a clubId.
clubsRouter.get(
  "/mine",
  requireAuth,
  asyncHandler(async (req, res) => {
    const club = await prisma.club.findUnique({
      where: { userId: req.user!.sub },
      include: { players: true },
    });
    if (!club) {
      res.status(404).json({ error: "You do not manage a club yet" });
      return;
    }
    res.json(club);
  })
);

clubsRouter.get(
  "/:clubId",
  asyncHandler(async (req, res) => {
    const club = await prisma.club.findUnique({
      where: { id: req.params.clubId },
      include: { players: true },
    });
    if (!club) {
      res.status(404).json({ error: "Club not found" });
      return;
    }
    res.json(club);
  })
);

clubsRouter.post(
  "/:clubId/claim",
  requireAuth,
  asyncHandler(async (req, res) => {
    const club = await prisma.club.findUnique({ where: { id: req.params.clubId } });
    if (!club) {
      res.status(404).json({ error: "Club not found" });
      return;
    }

    try {
      // Conditional WHERE (id + userId: null) makes this atomic against two
      // users racing to claim the same club — only one UPDATE can match.
      // The unique constraint on Club.userId (see schema) makes "already
      // manages a club" atomic too, via the P2002 caught below, instead of
      // relying on a racy check-then-act.
      const result = await prisma.club.updateMany({
        where: { id: club.id, userId: null },
        data: { userId: req.user!.sub },
      });

      if (result.count === 0) {
        res.status(409).json({ error: "Club already has an owner" });
        return;
      }
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
        res.status(409).json({ error: "You already manage a club" });
        return;
      }
      throw err;
    }

    const updated = await prisma.club.findUniqueOrThrow({ where: { id: club.id } });
    res.json(updated);
  })
);

function isValidPercentage(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= 0 && value <= 100;
}

// balance/reputation are intentionally not editable here — those change
// only through game mechanics (matches, transfers), never direct API edits.
clubsRouter.patch(
  "/:clubId",
  requireAuth,
  requireClubOwner,
  asyncHandler(async (req, res) => {
    const { formation, tacticStyle } = req.body ?? {};
    const data: { formation?: string; tacticStyle?: TacticStyle } = {};

    if (formation !== undefined) {
      if (typeof formation !== "string" || !ALLOWED_FORMATIONS.includes(formation)) {
        res.status(400).json({ error: `formation must be one of: ${ALLOWED_FORMATIONS.join(", ")}` });
        return;
      }
      data.formation = formation;
    }

    if (tacticStyle !== undefined) {
      // Club.formation is the single source of truth for the formation —
      // tacticStyle.formation always mirrors it, using the value this same
      // request is setting (if any), so the two never drift out of sync.
      const nextFormation = data.formation ?? req.club!.formation;
      const current = (req.club!.tacticStyle as unknown as TacticStyle | null) ?? {
        formation: nextFormation,
        mentality: "balanced",
        pressing: 50,
        width: 50,
        tempo: 50,
      };
      const merged: TacticStyle = { ...current, ...tacticStyle, formation: nextFormation };

      if (!MENTALITIES.includes(merged.mentality)) {
        res.status(400).json({ error: `tacticStyle.mentality must be one of: ${MENTALITIES.join(", ")}` });
        return;
      }
      if (
        !isValidPercentage(merged.pressing) ||
        !isValidPercentage(merged.width) ||
        !isValidPercentage(merged.tempo)
      ) {
        res.status(400).json({ error: "tacticStyle.pressing/width/tempo must be integers 0-100" });
        return;
      }

      data.tacticStyle = merged;
    }

    if (Object.keys(data).length === 0) {
      res.status(400).json({ error: "Provide formation and/or tacticStyle to update" });
      return;
    }

    const updated = await prisma.club.update({
      where: { id: req.club!.id },
      data: { formation: data.formation, tacticStyle: data.tacticStyle as unknown as Prisma.InputJsonValue },
    });
    res.json(updated);
  })
);

// Squad management, tactics editing beyond formation/style, finances: next iteration.
