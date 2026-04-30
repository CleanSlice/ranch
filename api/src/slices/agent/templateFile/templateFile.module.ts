import { Module } from '@nestjs/common';
import { TemplateModule } from '#/agent/template/template.module';
import { SettingModule } from '#/setting/setting.module';
import { TemplateFileController } from './templateFile.controller';
import { ITemplateFileGateway } from './domain/templateFile.gateway';
import { S3TemplateFileGateway } from './data/templateFile.gateway';

@Module({
  imports: [TemplateModule, SettingModule],
  controllers: [TemplateFileController],
  providers: [
    {
      provide: ITemplateFileGateway,
      useClass: S3TemplateFileGateway,
    },
  ],
  exports: [ITemplateFileGateway],
})
export class TemplateFileModule {}
