import { Injectable } from '@nestjs/common';
import { ISettingGateway } from '#/setting/domain';
import { IUserSecretGateway } from '../domain/secret.gateway';
import { IUserSecretListData } from '../domain/secret.types';
import { AwsUserSecretGateway } from './awsSecret.gateway';
import { FileUserSecretGateway } from './fileSecret.gateway';

/**
 * Composite provider — picks AWS Secrets Manager or S3 file backend based
 * on the same `secret_provider` setting that agent/secret uses, so both
 * scopes share one backend choice. Switching the setting flips both
 * stores at once.
 */
@Injectable()
export class UserSecretGateway extends IUserSecretGateway {
  constructor(
    private settings: ISettingGateway,
    private aws: AwsUserSecretGateway,
    private file: FileUserSecretGateway,
  ) {
    super();
  }

  async list(userId: string): Promise<IUserSecretListData> {
    return (await this.isAws())
      ? this.aws.list(userId)
      : this.file.list(userId);
  }

  async get(userId: string, key: string): Promise<string | null> {
    return (await this.isAws())
      ? this.aws.get(userId, key)
      : this.file.get(userId, key);
  }

  async set(userId: string, key: string, value: string): Promise<void> {
    return (await this.isAws())
      ? this.aws.set(userId, key, value)
      : this.file.set(userId, key, value);
  }

  async delete(userId: string, key: string): Promise<void> {
    return (await this.isAws())
      ? this.aws.delete(userId, key)
      : this.file.delete(userId, key);
  }

  private async isAws(): Promise<boolean> {
    const setting = await this.settings.findByKey(
      'integrations',
      'secret_provider',
    );
    const value =
      typeof setting?.value === 'string' ? setting.value.toLowerCase() : '';
    return value === 'aws';
  }
}
