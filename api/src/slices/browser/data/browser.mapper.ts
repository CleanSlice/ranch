import { Injectable } from '@nestjs/common';
import type { BrowserSession } from '@prisma/client';
import {
  BrowserSessionStatusTypes,
  IBrowserSessionData,
  ICreateBrowserSessionData,
} from '../domain';

@Injectable()
export class BrowserMapper {
  toEntity(record: BrowserSession): IBrowserSessionData {
    return {
      id: record.id,
      userId: record.userId,
      accountKey: record.accountKey,
      status: record.status as BrowserSessionStatusTypes,
      lastUsedAt: record.lastUsedAt,
      createdAt: record.createdAt,
      updatedAt: record.updatedAt,
    };
  }

  toCreate(data: ICreateBrowserSessionData) {
    return {
      id: `browser-${crypto.randomUUID()}`,
      userId: data.userId,
      accountKey: data.accountKey,
      status: BrowserSessionStatusTypes.Idle,
      lastUsedAt: new Date(),
    };
  }
}
