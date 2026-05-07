-- AlterTable
ALTER TABLE "Template" ADD COLUMN     "manifestJson" JSONB,
ADD COLUMN     "sourceType" TEXT,
ADD COLUMN     "sourceUrl" TEXT,
ADD COLUMN     "version" TEXT;
