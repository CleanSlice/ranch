/*
  Warnings:

  - You are about to drop the column `entityTypes` on the `Knowledge` table. All the data in the column will be lost.
  - You are about to drop the column `relationshipTypes` on the `Knowledge` table. All the data in the column will be lost.

*/
-- AlterTable
ALTER TABLE "Knowledge" DROP COLUMN "entityTypes",
DROP COLUMN "relationshipTypes";
