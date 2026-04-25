import { Module } from '@nestjs/common';
import { SkillController } from './skill.controller';
import { ISkillGateway } from './domain/skill.gateway';
import { SkillGateway } from './data/skill.gateway';
import { SkillMapper } from './data/skill.mapper';
import { GithubSearch } from './data/github.search';
import { SettingModule } from '#/setting/setting.module';

@Module({
  imports: [SettingModule],
  controllers: [SkillController],
  providers: [
    SkillMapper,
    GithubSearch,
    {
      provide: ISkillGateway,
      useClass: SkillGateway,
    },
  ],
  exports: [ISkillGateway],
})
export class SkillModule {}
