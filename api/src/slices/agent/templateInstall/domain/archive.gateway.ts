import { IExtractedArchive } from './templateInstall.types';

export abstract class IArchiveGateway {
  // Extract a zip buffer into a temp directory. Implementation must
  // reject zip-slip (`..`, absolute paths) and enforce a per-archive
  // size cap. Returned `cleanup` removes the temp dir; caller must
  // invoke it in try/finally.
  abstract extractZip(zip: Buffer): Promise<IExtractedArchive>;
}
