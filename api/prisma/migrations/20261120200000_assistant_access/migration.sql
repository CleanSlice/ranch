-- Additive, then a one-way move (CLEAN-240): what the Ranch assistant offers
-- people becomes a setting of its own. AssistantRoleAccess: one row per role
-- the Owner has configured; no row means the default (Admin on + full, User
-- on + basic). AssistantAccountAccess: one row per account that differs from
-- its role.
--
-- Then the assistant leaves the agent access lists. An account that had it
-- Denied keeps it off, as an exception here. An account that had it Allowed,
-- or lost it only because some other agent was Allowed, has it on from now:
-- on is the default, so nothing is written for those. Every access entry that
-- names the assistant is deleted; `UserAgentAccess.limited` is left alone, so
-- an account whose only allowed agent was the assistant ends "limited with no
-- allowed entry" — it reaches no ordinary agent, as before, and still has the
-- assistant, as before. That step is not reversible.

-- CreateTable
CREATE TABLE "AssistantRoleAccess" (
    "role" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "level" TEXT NOT NULL,
    "custom" JSONB,
    "updatedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AssistantRoleAccess_pkey" PRIMARY KEY ("role")
);

-- CreateTable
CREATE TABLE "AssistantAccountAccess" (
    "userId" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "level" TEXT NOT NULL,
    "custom" JSONB,
    "updatedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AssistantAccountAccess_pkey" PRIMARY KEY ("userId")
);

-- Denied stays off. The level is the role's default, so switching the
-- assistant back on for the account gives it what its role gets.
INSERT INTO "AssistantAccountAccess" ("userId", "enabled", "level", "updatedAt")
SELECT e."userId",
       false,
       CASE WHEN u."role" = 'Admin' THEN 'full' ELSE 'basic' END,
       CURRENT_TIMESTAMP
FROM "UserAgentAccessEntry" e
JOIN "Agent" a ON a."id" = e."agentId"
JOIN "User" u ON u."id" = e."userId"
WHERE a."isAdmin" = true
  AND e."list" = 'denied'
  AND u."role" IN ('Admin', 'User')
ON CONFLICT ("userId") DO NOTHING;

-- The assistant is no longer a row in anybody's lists.
DELETE FROM "UserAgentAccessEntry" e
USING "Agent" a
WHERE a."id" = e."agentId"
  AND a."isAdmin" = true;
