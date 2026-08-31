import { Module } from '@nestjs/common';
import { ConfigModule } from '../config/config.module';
import { KnowledgeModule } from '../knowledge/knowledge.module';
import { SourceModule } from '../source/source.module';
import { InstanceModule } from '../instance/instance.module';
import { MigrationService } from './domain/migration.service';

@Module({
  imports: [ConfigModule, KnowledgeModule, SourceModule, InstanceModule],
  providers: [MigrationService],
  exports: [MigrationService],
})
export class MigrationModule {}
