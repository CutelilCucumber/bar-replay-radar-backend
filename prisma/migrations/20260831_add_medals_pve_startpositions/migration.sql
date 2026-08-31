-- AlterTable: Add medals JSON column and pve boolean column
ALTER TABLE "Match" ADD COLUMN "medals" JSONB,
ADD COLUMN "pve" BOOLEAN NOT NULL DEFAULT false;

-- CreateIndex: Add index on pve column
CREATE INDEX "Match_pve_idx" ON "Match"("pve");
