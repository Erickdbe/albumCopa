import { prisma, resolveListingSale } from "@brfut/db";

const POLL_INTERVAL_MS = 10_000;

/**
 * Sweeps transfer listings whose deadline has passed. This is a time-based
 * check, not something triggered by a discrete job, so it's a setInterval
 * poller (same pattern as apps/realtime/src/poller.ts) rather than a BullMQ
 * queue — nothing "enqueues" a listing's expiry, time just arrives.
 */
export function startMarketResolver(): NodeJS.Timeout {
  return setInterval(async () => {
    const expired = await prisma.transferListing.findMany({
      where: { status: "OPEN", endsAt: { lte: new Date() } },
      take: 50,
    });

    for (const listing of expired) {
      try {
        await prisma.$transaction(async (tx) => {
          // Atomically claim this listing for processing (guards against a
          // concurrent sweep tick, or a buy-now bid, handling it first).
          const guard = await tx.transferListing.updateMany({
            where: { id: listing.id, status: "OPEN", endsAt: { lte: new Date() } },
            data: { status: "EXPIRED" },
          });
          if (guard.count === 0) return;

          // resolveListingSale unconditionally overwrites status to SOLD at
          // the end, so marking EXPIRED above first is fine — it's just the
          // claim step. No bidder means EXPIRED is the correct final state.
          if (listing.currentBidderClubId) {
            await resolveListingSale(tx, listing.id, listing.currentBidderClubId, Number(listing.currentBid));
          }
        });
        console.log(
          `[market-resolver] resolved listing ${listing.id} (${listing.currentBidderClubId ? "sold" : "expired, no bids"})`
        );
      } catch (err) {
        console.error(`[market-resolver] failed to resolve listing ${listing.id}:`, err);
      }
    }
  }, POLL_INTERVAL_MS);
}
