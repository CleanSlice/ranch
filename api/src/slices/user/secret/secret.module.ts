import { Module } from '@nestjs/common';
import { SettingModule } from '#/setting/setting.module';
import { IUserSecretGateway } from './domain/secret.gateway';
import { UserSecretGateway } from './data/secret.gateway';
import { AwsUserSecretGateway } from './data/awsSecret.gateway';
import { FileUserSecretGateway } from './data/fileSecret.gateway';

/**
 * Per-user secret store — sibling to agent/secret. No controller of its
 * own: the integration slice owns the user-facing REST surface and calls
 * IUserSecretGateway directly. Keeps the secret slice focused on storage
 * and access control, not feature semantics.
 */
@Module({
  imports: [SettingModule],
  providers: [
    AwsUserSecretGateway,
    FileUserSecretGateway,
    {
      provide: IUserSecretGateway,
      useClass: UserSecretGateway,
    },
  ],
  exports: [IUserSecretGateway],
})
export class UserSecretModule {}
