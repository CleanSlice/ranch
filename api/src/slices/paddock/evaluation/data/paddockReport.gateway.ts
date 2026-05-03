import {
  Injectable,
  Logger,
  BadRequestException,
} from '@nestjs/common';
import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  ListObjectsV2Command,
  DeleteObjectsCommand,
  S3ServiceException,
} from '@aws-sdk/client-s3';
import { ISettingGateway } from '#/setting/domain';
import { IPaddockReportGateway } from '../domain/paddockReport.gateway';
import { IPaddockEvaluationReportData } from '../domain/evaluation.types';

@Injectable()
export class PaddockReportGateway extends IPaddockReportGateway {
  private readonly logger = new Logger(PaddockReportGateway.name);

  constructor(private settings: ISettingGateway) {
    super();
  }

  async saveReport(
    evaluationId: string,
    payload: IPaddockEvaluationReportData,
  ): Promise<string> {
    const { client, bucket } = await this.connect();
    const baseKey = this.basePrefix(evaluationId);

    const jsonKey = `${baseKey}report.json`;
    await client.send(
      new PutObjectCommand({
        Bucket: bucket,
        Key: jsonKey,
        Body: JSON.stringify(payload.json, null, 2),
        ContentType: 'application/json; charset=utf-8',
      }),
    );

    await client.send(
      new PutObjectCommand({
        Bucket: bucket,
        Key: `${baseKey}report.md`,
        Body: payload.md,
        ContentType: 'text/markdown; charset=utf-8',
      }),
    );

    return jsonKey;
  }

  async loadReport(
    evaluationId: string,
    key: string,
  ): Promise<IPaddockEvaluationReportData | null> {
    const { client, bucket } = await this.connect();
    const baseKey = this.basePrefix(evaluationId);

    try {
      const jsonRes = await client.send(
        new GetObjectCommand({ Bucket: bucket, Key: key }),
      );
      const jsonText = await jsonRes.Body?.transformToString('utf-8');
      const json = jsonText ? (JSON.parse(jsonText) as object) : {};

      const mdRes = await client.send(
        new GetObjectCommand({ Bucket: bucket, Key: `${baseKey}report.md` }),
      );
      const md = (await mdRes.Body?.transformToString('utf-8')) ?? '';

      return { json, md };
    } catch (err) {
      if (this.isNotFound(err)) return null;
      throw err;
    }
  }

  async saveSnapshot(
    evaluationId: string,
    snapshot: object,
  ): Promise<string> {
    const { client, bucket } = await this.connect();
    const key = `${this.basePrefix(evaluationId)}snapshot.json`;
    await client.send(
      new PutObjectCommand({
        Bucket: bucket,
        Key: key,
        Body: JSON.stringify(snapshot, null, 2),
        ContentType: 'application/json; charset=utf-8',
      }),
    );
    return key;
  }

  async saveTrace(
    evaluationId: string,
    scenarioId: string,
    trace: object,
  ): Promise<string> {
    const { client, bucket } = await this.connect();
    const key = `${this.basePrefix(evaluationId)}traces/${scenarioId}.json`;
    await client.send(
      new PutObjectCommand({
        Bucket: bucket,
        Key: key,
        Body: JSON.stringify(trace, null, 2),
        ContentType: 'application/json; charset=utf-8',
      }),
    );
    return key;
  }

  async loadTrace(
    evaluationId: string,
    scenarioId: string,
  ): Promise<object | null> {
    const { client, bucket } = await this.connect();
    const key = `${this.basePrefix(evaluationId)}traces/${scenarioId}.json`;
    try {
      const res = await client.send(
        new GetObjectCommand({ Bucket: bucket, Key: key }),
      );
      const text = await res.Body?.transformToString('utf-8');
      return text ? (JSON.parse(text) as object) : null;
    } catch (err) {
      if (this.isNotFound(err)) return null;
      throw err;
    }
  }

  async deleteForEvaluation(evaluationId: string): Promise<void> {
    try {
      const { client, bucket } = await this.connect();
      const prefix = this.basePrefix(evaluationId);
      let continuationToken: string | undefined;
      do {
        const list = await client.send(
          new ListObjectsV2Command({
            Bucket: bucket,
            Prefix: prefix,
            ContinuationToken: continuationToken,
          }),
        );
        const keys = (list.Contents ?? [])
          .map((o) => o.Key)
          .filter((k): k is string => Boolean(k));
        if (keys.length > 0) {
          await client.send(
            new DeleteObjectsCommand({
              Bucket: bucket,
              Delete: { Objects: keys.map((Key) => ({ Key })), Quiet: true },
            }),
          );
        }
        continuationToken = list.IsTruncated
          ? list.NextContinuationToken
          : undefined;
      } while (continuationToken);
    } catch (err) {
      this.logger.warn(
        `S3 cleanup failed for evaluation ${evaluationId}: ${(err as Error).message}`,
      );
    }
  }

  private basePrefix(evaluationId: string): string {
    return `paddock/evaluations/${evaluationId}/`;
  }

  private isNotFound(err: unknown): boolean {
    if (err instanceof S3ServiceException) {
      return err.name === 'NotFound' || err.name === 'NoSuchKey';
    }
    return false;
  }

  private async connect(): Promise<{ client: S3Client; bucket: string }> {
    const get = async (name: string): Promise<string> => {
      const setting = await this.settings.findByKey('integrations', name);
      const value = setting?.value;
      return typeof value === 'string' ? value : '';
    };
    const [bucket, region, accessKeyId, secretAccessKey, endpoint] =
      await Promise.all([
        get('s3_bucket'),
        get('aws_region'),
        get('aws_access_key_id'),
        get('aws_secret_access_key'),
        get('s3_endpoint'),
      ]);

    if (!bucket) {
      throw new BadRequestException(
        'S3 bucket is not configured (settings → integrations → s3_bucket)',
      );
    }
    if (!accessKeyId || !secretAccessKey) {
      throw new BadRequestException(
        'AWS credentials are not configured (settings → integrations)',
      );
    }
    const client = new S3Client({
      region: region || 'us-east-1',
      credentials: { accessKeyId, secretAccessKey },
      ...(endpoint ? { endpoint, forcePathStyle: true } : {}),
    });
    return { client, bucket };
  }
}
