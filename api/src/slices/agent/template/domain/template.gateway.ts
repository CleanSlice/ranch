import {
  ITemplateData,
  ICreateTemplateData,
  IUpdateTemplateData,
} from './template.types';

export abstract class ITemplateGateway {
  abstract findAll(): Promise<ITemplateData[]>;
  abstract findById(id: string): Promise<ITemplateData | null>;
  abstract create(data: ICreateTemplateData): Promise<ITemplateData>;
  abstract update(
    id: string,
    data: IUpdateTemplateData,
  ): Promise<ITemplateData>;
  abstract touch(id: string): Promise<ITemplateData>;
  abstract delete(id: string): Promise<void>;
}
