-- CreateTable
CREATE TABLE "McpServer" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "url" TEXT NOT NULL,
    "transport" TEXT NOT NULL DEFAULT 'streamableHttp',
    "authType" TEXT NOT NULL DEFAULT 'none',
    "authValue" TEXT,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "builtIn" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "McpServer_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "_McpServerToTemplate" (
    "A" TEXT NOT NULL,
    "B" TEXT NOT NULL,

    CONSTRAINT "_McpServerToTemplate_AB_pkey" PRIMARY KEY ("A","B")
);

-- CreateIndex
CREATE UNIQUE INDEX "McpServer_name_key" ON "McpServer"("name");

-- CreateIndex
CREATE INDEX "McpServer_name_idx" ON "McpServer"("name");

-- CreateIndex
CREATE INDEX "_McpServerToTemplate_B_index" ON "_McpServerToTemplate"("B");

-- AddForeignKey
ALTER TABLE "_McpServerToTemplate" ADD CONSTRAINT "_McpServerToTemplate_A_fkey" FOREIGN KEY ("A") REFERENCES "McpServer"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "_McpServerToTemplate" ADD CONSTRAINT "_McpServerToTemplate_B_fkey" FOREIGN KEY ("B") REFERENCES "Template"("id") ON DELETE CASCADE ON UPDATE CASCADE;
