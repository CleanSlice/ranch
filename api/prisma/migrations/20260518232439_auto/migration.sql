-- CreateTable
CREATE TABLE "IntegrationAccount" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "service" TEXT NOT NULL,
    "accountKey" TEXT NOT NULL,
    "mechanism" TEXT NOT NULL,
    "label" TEXT,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "IntegrationAccount_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "IntegrationAccount_userId_service_idx" ON "IntegrationAccount"("userId", "service");

-- CreateIndex
CREATE UNIQUE INDEX "IntegrationAccount_userId_service_accountKey_key" ON "IntegrationAccount"("userId", "service", "accountKey");
