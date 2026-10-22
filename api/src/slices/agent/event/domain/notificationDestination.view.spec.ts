import { NotificationDestinationService } from './notificationDestination.service';
import { IAgentEventGateway } from './agentEvent.gateway';
import { INotificationDestination } from './agentEvent.types';
import { INotifier, ISlackBotNotifier } from './notifier';
import { IInfraConfigGateway } from '#/setting/domain/infraConfig.gateway';
import { ApiInstanceService } from '#/setting/domain/apiInstance.service';

function createService(destination: INotificationDestination | null) {
  const liveCount = jest.fn(async () => 1);
  const service = new NotificationDestinationService(
    {
      getDestination: async () => destination,
    } as unknown as IAgentEventGateway,
    {} as INotifier,
    {} as ISlackBotNotifier,
    { getEnvironment: async () => null } as unknown as IInfraConfigGateway,
    { liveCount } as unknown as ApiInstanceService,
  );
  return { service, liveCount };
}

const webhookRow = {
  kind: 'webhook',
  webhookUrl: 'https://hooks.slack.com/services/T/B/secret',
  botToken: null,
  channelId: null,
  hint: 'cret',
  updatedBy: 'user-1',
  updatedAt: new Date('2026-10-20T10:00:00Z'),
  lastDeliveryAt: null,
  lastDeliveryOk: null,
  lastDeliveryError: null,
} as unknown as INotificationDestination;

describe('NotificationDestinationService view — API replicas (CLEAN-140)', () => {
  it('tells how many copies of the API are alive, destination or not', async () => {
    const none = createService(null);
    none.liveCount.mockResolvedValue(2);
    expect((await none.service.view()).apiReplicas).toBe(2);

    const some = createService(webhookRow);
    expect((await some.service.view()).apiReplicas).toBe(1);
  });
});
