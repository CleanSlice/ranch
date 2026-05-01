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
    const setting = await this.settings.findByKey('integrations', 'secret_provider');
    const value =
      typeof setting?.value === 'string' ? setting.value.toLowerCase() : '';
    const provider = value === 'aws' ? 'aws' : 'file';
    return provider === 'aws' ? this.aws.list(agentId) : this.file.list(agentId);
  }
}
