export interface IS3FileLocation {
  bucket: string;
  key: string;
}

export interface IS3UploadInput extends IS3FileLocation {
  body: Buffer;
  contentType: string;
}

export interface IS3StoredFile extends IS3FileLocation {
  uri: string;
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
