-- CreateTable
CREATE TABLE "Match" (
    "id" TEXT NOT NULL,
    "gamemode" INTEGER NOT NULL,
    "playerCount" INTEGER NOT NULL,
    "averageOS" DOUBLE PRECISION NOT NULL,
    "score" INTEGER NOT NULL,
    "startTime" TIMESTAMP(3) NOT NULL,
    "durationMinutes" INTEGER NOT NULL,
    "bigBattle" BOOLEAN NOT NULL DEFAULT false,
    "comeback" BOOLEAN NOT NULL DEFAULT false,
    "backAndForth" BOOLEAN NOT NULL DEFAULT false,
    "stomp" BOOLEAN NOT NULL DEFAULT false,
    "guerillaFighters" BOOLEAN NOT NULL DEFAULT false,
    "carpalTunnel" BOOLEAN NOT NULL DEFAULT false,
    "spaceRace" BOOLEAN NOT NULL DEFAULT false,
    "earlyBombing" BOOLEAN NOT NULL DEFAULT false,
    "nailBiter" BOOLEAN NOT NULL DEFAULT false,
    "afusRush" BOOLEAN NOT NULL DEFAULT false,
    "nukeRush" BOOLEAN NOT NULL DEFAULT false,
    "gantryRush" BOOLEAN NOT NULL DEFAULT false,
    "orbitalCannons" BOOLEAN NOT NULL DEFAULT false,
    "techSpread" BOOLEAN NOT NULL DEFAULT false,
    "goliathDuel" BOOLEAN NOT NULL DEFAULT false,
    "commanderAttack" BOOLEAN NOT NULL DEFAULT false,
    "windyDay" BOOLEAN NOT NULL DEFAULT false,
    "legionMatch" BOOLEAN NOT NULL DEFAULT false,
    "upset" BOOLEAN NOT NULL DEFAULT false,
    "peanutGallery" BOOLEAN NOT NULL DEFAULT false,
    "series" JSONB NOT NULL,
    "teamAFacts" JSONB NOT NULL,
    "teamBFacts" JSONB NOT NULL,
    "analysis" JSONB NOT NULL,
    "processedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Match_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Match_gamemode_idx" ON "Match"("gamemode");

-- CreateIndex
CREATE INDEX "Match_playerCount_idx" ON "Match"("playerCount");

-- CreateIndex
CREATE INDEX "Match_averageOS_idx" ON "Match"("averageOS");

-- CreateIndex
CREATE INDEX "Match_score_idx" ON "Match"("score");

-- CreateIndex
CREATE INDEX "Match_startTime_idx" ON "Match"("startTime");

-- CreateIndex
CREATE INDEX "Match_bigBattle_idx" ON "Match"("bigBattle");

-- CreateIndex
CREATE INDEX "Match_comeback_idx" ON "Match"("comeback");

-- CreateIndex
CREATE INDEX "Match_backAndForth_idx" ON "Match"("backAndForth");

-- CreateIndex
CREATE INDEX "Match_stomp_idx" ON "Match"("stomp");

-- CreateIndex
CREATE INDEX "Match_guerillaFighters_idx" ON "Match"("guerillaFighters");

-- CreateIndex
CREATE INDEX "Match_carpalTunnel_idx" ON "Match"("carpalTunnel");

-- CreateIndex
CREATE INDEX "Match_spaceRace_idx" ON "Match"("spaceRace");

-- CreateIndex
CREATE INDEX "Match_earlyBombing_idx" ON "Match"("earlyBombing");

-- CreateIndex
CREATE INDEX "Match_nailBiter_idx" ON "Match"("nailBiter");

-- CreateIndex
CREATE INDEX "Match_afusRush_idx" ON "Match"("afusRush");

-- CreateIndex
CREATE INDEX "Match_nukeRush_idx" ON "Match"("nukeRush");

-- CreateIndex
CREATE INDEX "Match_gantryRush_idx" ON "Match"("gantryRush");

-- CreateIndex
CREATE INDEX "Match_orbitalCannons_idx" ON "Match"("orbitalCannons");

-- CreateIndex
CREATE INDEX "Match_techSpread_idx" ON "Match"("techSpread");

-- CreateIndex
CREATE INDEX "Match_goliathDuel_idx" ON "Match"("goliathDuel");

-- CreateIndex
CREATE INDEX "Match_commanderAttack_idx" ON "Match"("commanderAttack");

-- CreateIndex
CREATE INDEX "Match_windyDay_idx" ON "Match"("windyDay");

-- CreateIndex
CREATE INDEX "Match_legionMatch_idx" ON "Match"("legionMatch");

-- CreateIndex
CREATE INDEX "Match_upset_idx" ON "Match"("upset");

-- CreateIndex
CREATE INDEX "Match_peanutGallery_idx" ON "Match"("peanutGallery");
