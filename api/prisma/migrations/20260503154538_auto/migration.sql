-- AlterTable
ALTER TABLE "Template" ADD COLUMN     "paddockConfig" JSONB NOT NULL DEFAULT '{}';

-- CreateTable
CREATE TABLE "PaddockEvaluation" (
    "id" TEXT NOT NULL,
    "agentId" TEXT NOT NULL,
    "templateId" TEXT,
    "status" TEXT NOT NULL DEFAULT 'running',
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt" TIMESTAMP(3),
    "passRate" DOUBLE PRECISION,
    "scenarioCount" INTEGER NOT NULL DEFAULT 0,
    "passCount" INTEGER NOT NULL DEFAULT 0,
    "failCount" INTEGER NOT NULL DEFAULT 0,
    "partialCount" INTEGER NOT NULL DEFAULT 0,
    "skippedCount" INTEGER NOT NULL DEFAULT 0,
    "judgeConfig" JSONB NOT NULL,
    "scenariosSnapshot" JSONB NOT NULL,
    "reportS3Key" TEXT,
    "errorMessage" TEXT,

    CONSTRAINT "PaddockEvaluation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PaddockEvaluationResult" (
    "id" TEXT NOT NULL,
    "evaluationId" TEXT NOT NULL,
    "scenarioId" TEXT NOT NULL,
    "verdict" TEXT NOT NULL,
    "finalScore" DOUBLE PRECISION NOT NULL,
    "agreement" DOUBLE PRECISION NOT NULL,
    "dimensionScores" JSONB NOT NULL,
    "judges" JSONB NOT NULL,
    "failureReasons" TEXT[],

    CONSTRAINT "PaddockEvaluationResult_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PaddockScenario" (
    "id" TEXT NOT NULL,
    "templateId" TEXT,
    "agentId" TEXT,
    "category" TEXT NOT NULL,
    "difficulty" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "expectedBehavior" TEXT NOT NULL,
    "messages" JSONB NOT NULL,
    "successCriteria" JSONB NOT NULL,
    "setup" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PaddockScenario_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "PaddockEvaluation_agentId_idx" ON "PaddockEvaluation"("agentId");

-- CreateIndex
CREATE INDEX "PaddockEvaluation_templateId_idx" ON "PaddockEvaluation"("templateId");

-- CreateIndex
CREATE INDEX "PaddockEvaluation_status_idx" ON "PaddockEvaluation"("status");

-- CreateIndex
CREATE INDEX "PaddockEvaluationResult_evaluationId_idx" ON "PaddockEvaluationResult"("evaluationId");

-- CreateIndex
CREATE INDEX "PaddockScenario_templateId_idx" ON "PaddockScenario"("templateId");

-- CreateIndex
CREATE INDEX "PaddockScenario_agentId_idx" ON "PaddockScenario"("agentId");

-- AddForeignKey
ALTER TABLE "PaddockEvaluation" ADD CONSTRAINT "PaddockEvaluation_agentId_fkey" FOREIGN KEY ("agentId") REFERENCES "Agent"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PaddockEvaluationResult" ADD CONSTRAINT "PaddockEvaluationResult_evaluationId_fkey" FOREIGN KEY ("evaluationId") REFERENCES "PaddockEvaluation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PaddockScenario" ADD CONSTRAINT "PaddockScenario_templateId_fkey" FOREIGN KEY ("templateId") REFERENCES "Template"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PaddockScenario" ADD CONSTRAINT "PaddockScenario_agentId_fkey" FOREIGN KEY ("agentId") REFERENCES "Agent"("id") ON DELETE CASCADE ON UPDATE CASCADE;
