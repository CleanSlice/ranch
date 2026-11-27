-- Additive (CLEAN-271): the value of a setting the Owner approved for the
-- Ranch assistant, kept only while the live value differs from it. Empty
-- after this migration on purpose: the settings an installation holds now
-- are the ones its assistant runs on, so they are the approved ones, and no
-- row means "approved = live". An installation with no assistant yet needs
-- nothing either: a change by anybody but the Owner is recorded from the
-- first one, whether or not an assistant exists to be served it.

-- CreateTable
CREATE TABLE "AssistantSettingPin" (
    "group" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "present" BOOLEAN NOT NULL,
    "valueType" TEXT NOT NULL DEFAULT 'string',
    "value" TEXT NOT NULL DEFAULT '',
    "changedById" TEXT,
    "changedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AssistantSettingPin_pkey" PRIMARY KEY ("group","name")
);
