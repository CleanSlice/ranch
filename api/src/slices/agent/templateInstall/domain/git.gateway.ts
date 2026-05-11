import { IExtractedArchive } from './templateInstall.types';

export abstract class IGitGateway {
  // Clone a remote git repository into a temp directory and return the
  // same `IExtractedArchive` shape that `extractZip` returns. Caller must
  // invoke `cleanup` regardless of success.
  //
  // Implementation must reject non-https/ssh URLs at the input boundary
  // (no `file://`, no shell-meta strings) to prevent abuse.
  abstract clone(url: string, ref?: string): Promise<IExtractedArchive>;
}
