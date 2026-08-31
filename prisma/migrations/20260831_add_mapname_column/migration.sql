-- AlterTable: Add mapName column for internal filename (used for image URLs)
ALTER TABLE "Match" ADD COLUMN "mapName" TEXT;
