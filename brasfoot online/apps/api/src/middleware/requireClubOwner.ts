import { prisma, type Club } from "@brfut/db";
import { asyncHandler } from "./asyncHandler.js";

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      club?: Club;
    }
  }
}

/** Must run after requireAuth (needs req.user). Loads the club from
 * req.params.clubId once and attaches it as req.club so the route handler
 * doesn't have to fetch it again.
 *
 * Wrapped in asyncHandler for the same reason every async route handler is:
 * Express 4 doesn't catch rejections from async middleware either, so an
 * unhandled error here would crash the process just like the bug fixed
 * earlier for route handlers. */
export const requireClubOwner = asyncHandler(async (req, res, next) => {
  const club = await prisma.club.findUnique({ where: { id: req.params.clubId } });

  if (!club) {
    res.status(404).json({ error: "Club not found" });
    return;
  }
  if (club.userId !== req.user?.sub) {
    res.status(403).json({ error: "You do not manage this club" });
    return;
  }

  req.club = club;
  next();
});
