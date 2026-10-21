import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { hostname } from 'node:os';
import { IApiInstanceGateway } from './apiInstance.gateway';

/**
 * This process's presence among the API's copies (CLEAN-140).
 *
 * The bridle hub that knows which agents are connected lives in memory, per
 * process. With two copies of the API behind one Service, the copy that does
 * not hold an agent's socket sees "pod running, hub absent" and, after the
 * grace, writes `unreachable`; the other writes `running` back; every flip
 * is an incident and a Slack message. The API is single-process by design —
 * chat routing and MCP sessions live in memory too — so this does not make
 * several copies work together. It makes them visible: each registers a row
 * and refreshes it every 10 s, and anyone who must trust the hub asks
 * `liveCount()` first. A row is live for 30 s after its last heartbeat,
 * which also covers a rolling update, where the old and the new pod share
 * a minute.
 */
export const HEARTBEAT_MS = 10_000;
export const LIVE_WINDOW_MS = 30_000;
const PRUNE_AFTER_MS = 60 * 60_000;

@Injectable()
export class ApiInstanceService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(ApiInstanceService.name);
  /** This process's id: fresh on every boot, so a restart is a new row. */
  readonly id = randomUUID();
  private readonly host = hostname();
  private timer: NodeJS.Timeout | null = null;

  constructor(private readonly gateway: IApiInstanceGateway) {}

  async onModuleInit(): Promise<void> {
    await this.beat();
    this.timer = setInterval(() => {
      void this.beat();
    }, HEARTBEAT_MS);
    this.timer.unref?.();
  }

  async onModuleDestroy(): Promise<void> {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
    try {
      await this.gateway.remove(this.id);
    } catch (err) {
      this.logger.warn(
        `Could not remove this API instance's row on shutdown: ${(err as Error).message}`,
      );
    }
  }

  /** How many copies of the API have reported in during the last 30 s. */
  liveCount(): Promise<number> {
    return this.gateway.countLive(new Date(Date.now() - LIVE_WINDOW_MS));
  }

  private async beat(): Promise<void> {
    const now = Date.now();
    try {
      await this.gateway.heartbeat(this.id, this.host, new Date(now));
      await this.gateway.pruneBefore(new Date(now - PRUNE_AFTER_MS));
    } catch (err) {
      this.logger.warn(
        `API instance heartbeat failed: ${(err as Error).message}`,
      );
    }
  }
}
