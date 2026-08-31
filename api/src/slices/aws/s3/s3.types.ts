export interface IS3FileLocation {
  bucket: string;
  key: string;
}

export interface IS3UploadInput extends IS3FileLocation {
  body: Buffer;
  contentType: string;
  /**
   * User-defined object metadata (stored as `x-amz-meta-*`). Values must be
   * US-ASCII — percent-encode anything else before passing it in.
   */
  metadata?: Record<string, string>;
}

export interface IS3StoredFile extends IS3FileLocation {
  uri: string;
}

/**
 * A downloaded object plus the parts of its S3 response a caller may need to
 * serve it back — the content type it was stored with and any user metadata.
 * `download()` remains available when only the bytes matter.
 */
export interface IS3DownloadedFile {
  body: Buffer;
  contentType?: string;
  metadata: Record<string, string>;
}

export class S3RepositoryError extends Error {
  constructor(
    message: string,
    public readonly bucket?: string,
    public readonly key?: string,
  ) {
    super(message);
    this.name = 'S3RepositoryError';
  }
}
