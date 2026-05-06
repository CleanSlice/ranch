-- AlterTable
ALTER TABLE "Agent" ADD COLUMN     "allowedOrigins" TEXT[] DEFAULT ARRAY[]::TEXT[];
