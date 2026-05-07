import { Module } from '@nestjs/common';
import { TemplateModule } from '#/agent/template/template.module';
import { TemplateFileModule } from '#/agent/templateFile/templateFile.module';
import { McpServerModule } from '#/mcpServer/mcpServer.module';
import { SkillModule } from '#/skill/skill.module';
import { PaddockScenarioModule } from '#/paddock/scenario/scenario.module';
import { TemplateInstallController } from './templateInstall.controller';
import { TemplateExportController } from './templateExport.controller';
import { TemplateInstallService } from './domain/templateInstall.service';
import { TemplateExportService } from './domain/templateExport.service';
import { IManifestGateway } from './domain/manifest.gateway';
import { IArchiveGateway } from './domain/archive.gateway';
import { IGitGateway } from './domain/git.gateway';
import { ManifestGateway } from './data/manifest.gateway';
import { ArchiveGateway } from './data/archive.gateway';
import { GitGateway } from './data/git.gateway';

@Module({
  imports: [
    TemplateModule,
    TemplateFileModule,
    McpServerModule,
    SkillModule,
    PaddockScenarioModule,
  ],
  controllers: [TemplateInstallController, TemplateExportController],
  providers: [
    TemplateInstallService,
    TemplateExportService,
    { provide: IManifestGateway, useClass: ManifestGateway },
    { provide: IArchiveGateway, useClass: ArchiveGateway },
    { provide: IGitGateway, useClass: GitGateway },
  ],
  exports: [TemplateInstallService, TemplateExportService],
})
export class TemplateInstallModule {}
