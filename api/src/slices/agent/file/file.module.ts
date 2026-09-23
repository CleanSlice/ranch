import { Module, forwardRef } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { JwtModule } from '@nestjs/jwt';
import { AgentModule } from '#/agent/agent/agent.module';
import { SettingModule } from '#/setting/setting.module';
import { BridleModule } from '#/bridle/bridle.module';
import { FileController } from './file.controller';
import { FileImportController } from './fileImport.controller';
import { FileTool } from './file.tool';
import { WorkspaceArchiveService } from './domain/workspaceArchive.service';
import { IFileGateway } from './domain/file.gateway';
import { S3FileGateway } from './data/file.gateway';
import { OpenLinkService } from './domain/openLink.service';
import { SyncGuardService } from './domain/syncGuard.service';
import { TranscriptReaderService } from './domain/transcriptReader.service';

// AgentModule must be a forwardRef here because BridleModule (which imports
// FileModule) is now also imported by AgentModule, creating
// AgentModule → BridleModule → FileModule → AgentModule.
@Module({
  imports: [
    forwardRef(() => AgentModule),
    SettingModule,
    forwardRef(() => BridleModule),
    // "Open full" links (CLEAN-112): short-lived JWTs minted and verified
    // here with the same secret every other slice uses.
    JwtModule.registerAsync({
      imports: [ConfigModule],
      useFactory: (config: ConfigService) => ({
        secret: config.get('JWT_SECRET', 'dev-secret-change-me'),
        signOptions: { expiresIn: '24h' },
      }),
      inject: [ConfigService],
    }),
  ],
  controllers: [FileController, FileImportController],
  providers: [
    {
      provide: IFileGateway,
      useClass: S3FileGateway,
    },
    OpenLinkService,
    SyncGuardService,
    TranscriptReaderService,
    // Workspace import (CLEAN-112): validate → stage → plan → apply.
    WorkspaceArchiveService,
    // MCP tools of this slice (CLEAN-109): discovered by the registry.
    FileTool,
  ],
  exports: [IFileGateway, TranscriptReaderService, WorkspaceArchiveService],
})
export class FileModule {}
