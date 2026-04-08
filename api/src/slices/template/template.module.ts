import { Module } from '@nestjs/common';
import { TemplateController } from './template.controller';
import { ITemplateGateway } from './domain/template.gateway';
import { TemplateGateway } from './data/template.gateway';
import { TemplateMapper } from './data/template.mapper';

@Module({
  controllers: [TemplateController],
  providers: [
    TemplateMapper,
    {
      provide: ITemplateGateway,
      useClass: TemplateGateway,
    },
  ],
  exports: [ITemplateGateway],
})
export class TemplateModule {}
