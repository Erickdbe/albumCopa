-- AlterTable
ALTER TABLE "leagues" ADD COLUMN     "is_private" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "owner_id" TEXT;

-- AddForeignKey
ALTER TABLE "leagues" ADD CONSTRAINT "leagues_owner_id_fkey" FOREIGN KEY ("owner_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

