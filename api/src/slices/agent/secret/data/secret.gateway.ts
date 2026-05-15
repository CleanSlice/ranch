import { Injectable } from '@nestjs/common';
import { ISettingGateway } from '#/setting/domain';
import { ISecretGateway } from '../domain/secret.gateway';
import { ISecretListData } from '../domain/secret.types';
import { AwsSecretGateway } from './awsSecret.gateway';
import { FileSecretGateway } from './fileSecret.gateway';

@Injectable()
export class SecretGateway extends ISecretGateway {
  constructor(
    private settings: ISettingGateway,
    private aws: AwsSecretGateway,
    private file: FileSecretGateway,
  ) {
    super();
  }

  async list(agentId: string): Promise<ISecretListData> {
    return (await this.isAws())
      ? this.aws.list(agentId)
      : this.file.list(agentId);
  }

  async set(agentId: string, key: string, value: string): Promise<void> {
    return (await this.isAws())
      ? this.aws.set(agentId, key, value)
      : this.file.set(agentId, key, value);
  }

  async delete(agentId: string, key: string): Promise<void> {
    return (await this.isAws())
      ? this.aws.delete(agentId, key)
      : this.file.delete(agentId, key);
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
