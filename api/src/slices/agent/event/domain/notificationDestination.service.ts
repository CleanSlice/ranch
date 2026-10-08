import {
  BadRequestException,
  ConflictException,
  Injectable,
} from '@nestjs/common';
import { IAgentEventGateway } from './agentEvent.gateway';
import {
  INotificationDestination,
  INotificationDestinationView,
} from './agentEvent.types';
import { INotifier } from './notifier';
import { renderTest } from './notificationText';

const SLACK_HOST = 'hooks.slack.com';
const SLACK_PATH_PREFIX = '/services/';
const HINT_LENGTH = 4;

export interface ITestDeliveryResult {
  delivered: boolean;
  error: string | null;
}

/**
 * Where the team is told. The address is a secret: it goes in through
 * `save`, is read back only by the notifier, and every answer this service
 * gives about it is a view without it.
 */
@Injectable()
export class NotificationDestinationService {
  constructor(
    private readonly gateway: IAgentEventGateway,
    private readonly notifier: INotifier,
  ) {}

  async view(): Promise<INotificationDestinationView> {
    return this.toView(await this.gateway.getDestination());
  }

  async save(
    rawUrl: string,
    userId: string,
  ): Promise<INotificationDestinationView> {
    const webhookUrl = this.validate(rawUrl);
    const saved = await this.gateway.saveDestination({
      webhookUrl,
      hint: webhookUrl.slice(-HINT_LENGTH),
      updatedBy: userId,
    });
    return this.toView(saved);
  }

  async remove(): Promise<void> {
    await this.gateway.removeDestination();
  }

  /** One clearly labelled message, straight to the destination, awaited. */
  async sendTest(): Promise<ITestDeliveryResult> {
    const destination = await this.gateway.getDestination();
    if (!destination) {
      throw new ConflictException('No notification destination is set');
    }
    const result = await this.notifier.send(
      destination.webhookUrl,
      renderTest(),
    );
    const error = result.ok ? null : result.error;
    await this.gateway.recordDelivery(new Date(), result.ok, error);
    return { delivered: result.ok, error };
  }

  /**
   * The admin console's own address, for the link in a message. Read the way
   * shareLink.tool and the MCP OAuth service read it; null when the API was
   * not told — a guessed address in an alarm is worse than no link.
   */
  consoleUrl(): string | null {
    const raw = process.env.ADMIN_URL ?? process.env.ADMIN_BASE_URL;
    const trimmed = raw?.trim().replace(/\/+$/, '');
    return trimmed ? trimmed : null;
  }

  /**
   * Only a Slack incoming webhook is accepted. The API will POST to whatever
   * is saved here, so an open field would let an owner — or anyone holding an
   * owner's session — aim it at an address inside the cluster.
   */
  private validate(rawUrl: string): string {
    let url: URL;
    try {
      url = new URL(rawUrl.trim());
    } catch {
      throw new BadRequestException('The address is not a valid URL');
    }
    if (
      url.protocol !== 'https:' ||
      url.hostname !== SLACK_HOST ||
      !url.pathname.startsWith(SLACK_PATH_PREFIX)
    ) {
      throw new BadRequestException(
        `The address must be a Slack incoming webhook: https://${SLACK_HOST}${SLACK_PATH_PREFIX}…`,
      );
    }
    return url.toString();
  }

  private toView(
    destination: INotificationDestination | null,
  ): INotificationDestinationView {
    const consoleLinks = this.consoleUrl() !== null;
    if (!destination) {
      return {
        configured: false,
        kind: null,
        hint: null,
        updatedBy: null,
        updatedAt: null,
        consoleLinks,
        lastDelivery: null,
      };
    }
    return {
      configured: true,
      kind: destination.kind,
      hint: destination.hint,
      updatedBy: destination.updatedBy,
      updatedAt: destination.updatedAt,
      consoleLinks,
      lastDelivery:
        destination.lastDeliveryAt && destination.lastDeliveryOk !== null
          ? {
              at: destination.lastDeliveryAt,
              ok: destination.lastDeliveryOk,
              error: destination.lastDeliveryError,
            }
          : null,
    };
  }
}
