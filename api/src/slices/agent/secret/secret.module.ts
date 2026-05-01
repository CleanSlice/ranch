import { Module } from '@nestjs/common';
import { AgentModule } from '#/agent/agent/agent.module';
import { SettingModule } from '#/setting/setting.module';
import { SecretController } from './secret.controller';
import { ISecretGateway } from './domain';
import { SecretGateway } from './data/secret.gateway';
import { AwsSecretGateway } from './data/awsSecret.gateway';
import { FileSecretGateway } from './data/fileSecret.gateway';

@Module({
  imports: [AgentModule, SettingModule],
  controllers: [SecretController],
  providers: [
    AwsSecretGateway,
    FileSecretGateway,
    {
      provide: ISecretGateway,
      useClass: SecretGateway,
    },
  ],
  exports: [ISecretGateway],
})
export class SecretModule {}
