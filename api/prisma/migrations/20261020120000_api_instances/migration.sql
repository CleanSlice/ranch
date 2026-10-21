-- CLEAN-140: one row per live API process, so the drift sweep can tell
-- when more than one copy of the API is alive and the per-process bridle
-- hub cannot be trusted for "unreachable".
CREATE TABLE "ApiInstance" (
    "id" TEXT NOT NULL,
    "hostname" TEXT NOT NULL,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastSeenAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ApiInstance_pkey" PRIMARY KEY ("id")
);
