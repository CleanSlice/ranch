import { Module } from '@nestjs/common';
import { SettingModule } from '#/setting/setting.module';
import { IUserBrowserStateGateway } from './domain/browserState.gateway';
import { UserBrowserStateGateway } from './data/browserState.gateway';

/**
 * Per-user browser storageState — sibling to `user/secret`. No controller
 * of its own: the integration slice owns the user-facing REST surface and
 * calls IUserBrowserStateGateway directly. Keeps this slice focused on
 * storage and key derivation.
 */
@Module({
  imports: [SettingModule],
  providers: [
    {
      provide: IUserBrowserStateGateway,
      useClass: UserBrowserStateGateway,
    },
  ],
  exports: [IUserBrowserStateGateway],
})
export class UserBrowserStateModule {}
