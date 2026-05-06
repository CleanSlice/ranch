-- CreateTable
CREATE TABLE "_SkillToTemplate" (
    "A" TEXT NOT NULL,
    "B" TEXT NOT NULL,

    CONSTRAINT "_SkillToTemplate_AB_pkey" PRIMARY KEY ("A","B")
);

-- CreateIndex
CREATE INDEX "_SkillToTemplate_B_index" ON "_SkillToTemplate"("B");

-- AddForeignKey
ALTER TABLE "_SkillToTemplate" ADD CONSTRAINT "_SkillToTemplate_A_fkey" FOREIGN KEY ("A") REFERENCES "Skill"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "_SkillToTemplate" ADD CONSTRAINT "_SkillToTemplate_B_fkey" FOREIGN KEY ("B") REFERENCES "Template"("id") ON DELETE CASCADE ON UPDATE CASCADE;
