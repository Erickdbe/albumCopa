import type { Prisma } from "../generated/client/index.js";

/**
 * Completes a listing sale: moves money between the two clubs' balances,
 * transfers the player, records the historical Transfer row, and marks the
 * listing SOLD. Takes a transaction client rather than opening its own —
 * callers (the API's buy-now path, the worker's expiry sweep) each need
 * this wrapped together with their own guard/read, so the transaction
 * boundary belongs to them, not to this helper.
 */
export async function resolveListingSale(
  tx: Prisma.TransactionClient,
  listingId: string,
  buyerClubId: string,
  price: number
): Promise<void> {
  const listing = await tx.transferListing.findUniqueOrThrow({ where: { id: listingId } });
  const buyerClub = await tx.club.findUniqueOrThrow({ where: { id: buyerClubId } });

  if (!buyerClub.userId) {
    throw new Error(`Buyer club ${buyerClubId} has no owner — cannot resolve sale`);
  }

  await tx.club.update({ where: { id: buyerClubId }, data: { balance: { decrement: price } } });
  await tx.club.update({ where: { id: listing.sellerClubId }, data: { balance: { increment: price } } });
  await tx.player.update({ where: { id: listing.playerId }, data: { clubId: buyerClubId } });
  await tx.transfer.create({
    data: {
      playerId: listing.playerId,
      fromClubId: listing.sellerClubId,
      toClubId: buyerClubId,
      type: "PURCHASE",
      value: price,
      status: "COMPLETED",
      initiatedByUserId: buyerClub.userId,
      completedAt: new Date(),
    },
  });
  await tx.transferListing.update({ where: { id: listingId }, data: { status: "SOLD" } });
}
