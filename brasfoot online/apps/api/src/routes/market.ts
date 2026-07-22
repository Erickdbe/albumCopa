import { Router } from "express";
import { prisma, resolveListingSale, type ListingStatus } from "@brfut/db";
import { asyncHandler } from "../middleware/asyncHandler.js";
import { requireAuth } from "../auth/middleware.js";

export const marketRouter = Router();

const MIN_DURATION_HOURS = 1;
const MAX_DURATION_HOURS = 168; // 7 days
const LISTING_STATUSES: ListingStatus[] = ["OPEN", "SOLD", "EXPIRED", "CANCELLED"];

const listingInclude = {
  player: { select: { id: true, name: true, position: true, overall: true, potential: true } },
  sellerClub: { select: { id: true, name: true, shortName: true } },
} as const;

class BidRejectedError extends Error {}

async function findOwnClub(userId: string) {
  return prisma.club.findUnique({ where: { userId } });
}

marketRouter.get(
  "/listings",
  asyncHandler(async (req, res) => {
    const requestedStatus = typeof req.query.status === "string" ? req.query.status : "OPEN";
    if (!LISTING_STATUSES.includes(requestedStatus as ListingStatus)) {
      res.status(400).json({ error: `status must be one of: ${LISTING_STATUSES.join(", ")}` });
      return;
    }
    const status = requestedStatus as ListingStatus;
    const sellerClubId = typeof req.query.sellerClubId === "string" ? req.query.sellerClubId : undefined;

    const listings = await prisma.transferListing.findMany({
      where: {
        status,
        ...(sellerClubId ? { sellerClubId } : {}),
      },
      include: listingInclude,
      orderBy: { endsAt: "asc" },
    });

    res.json({ listings });
  })
);

marketRouter.get(
  "/listings/:id",
  asyncHandler(async (req, res) => {
    const listing = await prisma.transferListing.findUnique({
      where: { id: req.params.id },
      include: {
        ...listingInclude,
        bids: { orderBy: { amount: "desc" }, include: { bidderClub: { select: { id: true, name: true } } } },
      },
    });
    if (!listing) {
      res.status(404).json({ error: "Listing not found" });
      return;
    }
    res.json(listing);
  })
);

marketRouter.post(
  "/listings",
  requireAuth,
  asyncHandler(async (req, res) => {
    const { playerId, startingPrice, buyNowPrice, durationHours } = req.body ?? {};

    const sellerClub = await findOwnClub(req.user!.sub);
    if (!sellerClub) {
      res.status(404).json({ error: "You do not manage a club yet" });
      return;
    }

    if (typeof playerId !== "string") {
      res.status(400).json({ error: "playerId is required" });
      return;
    }
    if (typeof startingPrice !== "number" || startingPrice <= 0) {
      res.status(400).json({ error: "startingPrice must be a positive number" });
      return;
    }
    if (buyNowPrice !== undefined && buyNowPrice !== null && (typeof buyNowPrice !== "number" || buyNowPrice < startingPrice)) {
      res.status(400).json({ error: "buyNowPrice must be a number >= startingPrice" });
      return;
    }
    if (
      typeof durationHours !== "number" ||
      !Number.isInteger(durationHours) ||
      durationHours < MIN_DURATION_HOURS ||
      durationHours > MAX_DURATION_HOURS
    ) {
      res.status(400).json({ error: `durationHours must be an integer between ${MIN_DURATION_HOURS} and ${MAX_DURATION_HOURS}` });
      return;
    }

    const player = await prisma.player.findUnique({ where: { id: playerId } });
    if (!player || player.clubId !== sellerClub.id) {
      res.status(403).json({ error: "You do not own this player" });
      return;
    }

    const existing = await prisma.transferListing.findFirst({ where: { playerId, status: "OPEN" } });
    if (existing) {
      res.status(409).json({ error: "This player already has an open listing" });
      return;
    }

    const listing = await prisma.transferListing.create({
      data: {
        playerId,
        sellerClubId: sellerClub.id,
        startingPrice,
        buyNowPrice: buyNowPrice ?? null,
        endsAt: new Date(Date.now() + durationHours * 60 * 60 * 1000),
        status: "OPEN",
      },
      include: listingInclude,
    });

    res.status(201).json(listing);
  })
);

marketRouter.post(
  "/listings/:id/bids",
  requireAuth,
  asyncHandler(async (req, res) => {
    const { amount } = req.body ?? {};
    const listingId = req.params.id;

    if (typeof amount !== "number" || amount <= 0) {
      res.status(400).json({ error: "amount must be a positive number" });
      return;
    }

    const listing = await prisma.transferListing.findUnique({ where: { id: listingId } });
    if (!listing) {
      res.status(404).json({ error: "Listing not found" });
      return;
    }

    const bidderClub = await findOwnClub(req.user!.sub);
    if (!bidderClub) {
      res.status(404).json({ error: "You do not manage a club yet" });
      return;
    }
    if (bidderClub.id === listing.sellerClubId) {
      res.status(400).json({ error: "You cannot bid on your own listing" });
      return;
    }

    const currentPrice = listing.currentBid != null ? Number(listing.currentBid) : Number(listing.startingPrice);
    if (amount <= currentPrice) {
      res.status(400).json({ error: `Bid must be greater than the current price (${currentPrice})` });
      return;
    }
    if (Number(bidderClub.balance) < amount) {
      res.status(400).json({ error: "Insufficient balance" });
      return;
    }

    try {
      await prisma.$transaction(async (tx) => {
        // Atomic guard: only succeeds if this is still the best bid on a
        // still-open, still-live listing — the same "conditional WHERE"
        // pattern used for claiming a club, so two simultaneous bids can
        // never both think they won.
        const guardResult = await tx.transferListing.updateMany({
          where: {
            id: listingId,
            status: "OPEN",
            endsAt: { gt: new Date() },
            OR: [{ currentBid: null }, { currentBid: { lt: amount } }],
          },
          data: { currentBid: amount, currentBidderClubId: bidderClub.id },
        });

        if (guardResult.count === 0) {
          throw new BidRejectedError("Bid no longer valid — listing may have changed or expired");
        }

        await tx.bid.create({ data: { listingId, bidderClubId: bidderClub.id, amount } });

        if (listing.buyNowPrice != null && amount >= Number(listing.buyNowPrice)) {
          await resolveListingSale(tx, listingId, bidderClub.id, amount);
        }
      });
    } catch (err) {
      if (err instanceof BidRejectedError) {
        res.status(409).json({ error: err.message });
        return;
      }
      throw err;
    }

    const updated = await prisma.transferListing.findUniqueOrThrow({
      where: { id: listingId },
      include: listingInclude,
    });
    res.json(updated);
  })
);

marketRouter.delete(
  "/listings/:id",
  requireAuth,
  asyncHandler(async (req, res) => {
    const listing = await prisma.transferListing.findUnique({ where: { id: req.params.id } });
    if (!listing) {
      res.status(404).json({ error: "Listing not found" });
      return;
    }

    const club = await findOwnClub(req.user!.sub);
    if (!club || club.id !== listing.sellerClubId) {
      res.status(403).json({ error: "You do not own this listing" });
      return;
    }
    if (listing.currentBid != null) {
      res.status(409).json({ error: "Cannot cancel a listing that already has bids" });
      return;
    }

    await prisma.transferListing.update({ where: { id: listing.id }, data: { status: "CANCELLED" } });
    res.status(204).send();
  })
);
