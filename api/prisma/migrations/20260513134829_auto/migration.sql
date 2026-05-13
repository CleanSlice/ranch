-- AlterTable
ALTER TABLE "Agent" ADD COLUMN     "channels" JSONB NOT NULL DEFAULT '[]';
