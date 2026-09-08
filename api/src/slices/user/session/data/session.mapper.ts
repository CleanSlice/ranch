import { Injectable } from '@nestjs/common';
import { Session } from '@prisma/client';
import { ICreateSessionData, ISessionData } from '../domain/session.types';

@Injectable()
export class SessionMapper {
  toEntity(record: Session): ISessionData {
    return {
      id: record.id,
      userId: record.userId,
      secretHash: record.secretHash,
      expiresAt: record.expiresAt,
      absoluteExpiresAt: record.absoluteExpiresAt,
      lastSeenAt: record.lastSeenAt,
      revokedAt: record.revokedAt,
      userAgent: record.userAgent,
      createdAt: record.createdAt,
      updatedAt: record.updatedAt,
    };
  }

  toCreate(data: ICreateSessionData) {
    return {
      id: `session-${crypto.randomUUID()}`,
      userId: data.userId,
      secretHash: data.secretHash,
      expiresAt: data.expiresAt,
      absoluteExpiresAt: data.absoluteExpiresAt,
      userAgent: data.userAgent ?? null,
    };
  }
}
