import {
  BadRequestException,
  ConflictException,
  Injectable,
} from '@nestjs/common';
import { IInfraConfigGateway } from '#/setting/domain/infraConfig.gateway';
import { ApiInstanceService } from '#/setting/domain/apiInstance.service';
import { IAgentEventGateway } from './agentEvent.gateway';
import {
  BOT_TOKEN_MAX_LENGTH,
  BOT_TOKEN_PATTERN,
  CHANNEL_ID_PATTERN,
  DestinationKindTypes,
  INotificationDestination,
  INotificationDestinationView,
  ISaveDestinationInput,
} from './agentEvent.types';
import { INotifier, ISlackBotNotifier } from './notifier';
import { renderTest } from './notificationText';

const SLACK_HOST = 'hooks.slack.com';
const SLACK_PATH_PREFIX = '/services/';
const HINT_LENGTH = 4;

export interface ITestDeliveryResult {
  delivered: boolean;
  error: string | null;
}

/**
 * Where the team is told. The secret — a webhook address or a bot token —
 * goes in through `save`, is read back only by the notifiers, and every
 * answer this service gives about it is a view without it.
 */
@Injectable()
export class NotificationDestinationService {
  constructor(
    private readonly gateway: IAgentEventGateway,
    private readonly notifier: INotifier,
    private readonly bot: ISlackBotNotifier,
    private readonly infra: IInfraConfigGateway,
    private readonly apiInstances: ApiInstanceService,
  ) {}

  async view(): Promise<INotificationDestinationView> {
    return this.toView(await this.gateway.getDestination());
  }

  /**
   * The installation's label for every message — the `environment` setting,
   * else RANCH_ENVIRONMENT — or null for none (CLEAN-167). A settings
   * outage must not stop a notification: it then goes out unlabelled.
   */
  async environment(): Promise<string | null> {
    try {
      return await this.infra.getEnvironment();
    } catch {
      return null;
    }
  }

  /** The kind in force right now; null when nothing is set. */
  async kind(): Promise<DestinationKindTypes | null> {
    return (await this.gateway.getDestination())?.kind ?? null;
  }

  async save(
    input: ISaveDestinationInput,
    userId: string,
  ): Promise<INotificationDestinationView> {
    const saved =
      input.kind === 'bot'
        ? await this.saveBot(input.botToken, input.channelId, userId)
        : await this.saveWebhook(input.webhookUrl, userId);
    return this.toView(saved);
  }

  private async saveWebhook(rawUrl: string, userId: string) {
    const webhookUrl = this.validateWebhook(rawUrl);
    return this.gateway.saveDestination({
      kind: 'webhook',
      webhookUrl,
      botToken: null,
      channelId: null,
      hint: webhookUrl.slice(-HINT_LENGTH),
      updatedBy: userId,
    });
  }

  private async saveBot(rawToken: string, rawChannel: string, userId: string) {
    const botToken = this.validateToken(rawToken);
    const channelId = this.validateChannel(rawChannel);
    return this.gateway.saveDestination({
      kind: 'bot',
      webhookUrl: null,
      botToken,
      channelId,
      hint: botToken.slice(-HINT_LENGTH),
      updatedBy: userId,
    });
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
    const cred = this.botCredentials(destination);
    const test = renderTest(await this.environment());
    const result = cred
      ? await this.bot.post(cred, test)
      : await this.notifier.send(destination.webhookUrl ?? '', test);
    const error = result.ok ? null : result.error;
    await this.gateway.recordDelivery(new Date(), result.ok, error);
    return { delivered: result.ok, error };
  }

  /** The bot's credentials when the destination is the bot, else null. */
  botCredentials(
    destination: INotificationDestination,
  ): { token: string; channelId: string } | null {
    if (
      destination.kind !== 'bot' ||
      !destination.botToken ||
      !destination.channelId
    ) {
      return null;
    }
    return { token: destination.botToken, channelId: destination.channelId };
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
  private validateWebhook(rawUrl: string): string {
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

  private validateToken(raw: string): string {
    const token = raw.trim();
    if (token.startsWith('xoxp-')) {
      throw new BadRequestException(
        'A bot token (xoxb-…) is needed, not a user token (xoxp-…): OAuth & Permissions → Bot User OAuth Token',
      );
    }
    if (token.length > BOT_TOKEN_MAX_LENGTH || !BOT_TOKEN_PATTERN.test(token)) {
      throw new BadRequestException(
        'The bot token must look like xoxb-… (OAuth & Permissions → Bot User OAuth Token)',
      );
    }
    return token;
  }

  private validateChannel(raw: string): string {
    const channelId = raw.trim();
    if (!CHANNEL_ID_PATTERN.test(channelId)) {
      throw new BadRequestException(
        'The channel id must look like C0… (channel → About → Channel ID), not the channel name',
      );
    }
    return channelId;
  }

  private async toView(
    destination: INotificationDestination | null,
  ): Promise<INotificationDestinationView> {
    const consoleLinks = this.consoleUrl() !== null;
    const environment = await this.environment();
    const apiReplicas = await this.apiInstances.liveCount();
    if (!destination) {
      return {
        configured: false,
        kind: null,
        hint: null,
        channelId: null,
        environment,
        apiReplicas,
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
      channelId: destination.kind === 'bot' ? destination.channelId : null,
      environment,
      apiReplicas,
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
