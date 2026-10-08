import {
  AgentEventsService,
  type AgentEventPageDto,
  type AgentIncidentPageDto,
  type NotificationDestinationDto,
  type TestDeliveryDto,
} from '#api/data';
import { BaseGateway } from '#common/data/BaseGateway';
import { unwrapEnvelope } from '#common/data/unwrapEnvelope';
import { IAgentEventGateway } from '../domain/agentEvent.gateway';
import type {
  IAgentEventPage,
  IAgentIncidentPage,
  IListAgentEventsQuery,
  IListAgentIncidentsQuery,
  INotificationDestination,
  ITestDelivery,
} from '../domain/agentEvent.types';
import { AgentEventMapper } from './agentEvent.mapper';

interface HeyApiResult {
  data?: unknown;
  error?: unknown;
  response?: { status?: number };
}

/**
 * The generated client answers a failed request with `{ error }` rather than
 * throwing. Unchecked, a refused webhook address would come back as an empty
 * success — and the server's reason is exactly what the settings page shows
 * inline.
 */
function unwrapOrThrow(res: HeyApiResult, action: string): unknown {
  const err = res.error as { message?: string } | undefined;
  if (err !== undefined && err !== null) {
    const status = res.response?.status;
    if (err.message) throw new Error(err.message);
    if (status && status >= 400) throw new Error(`${action} failed: HTTP ${status}`);
    throw new Error(
      `${action} failed: could not reach the API. Check that the API is ` +
        'running and that the origin of this app is listed in CORS_ORIGIN.',
    );
  }
  return unwrapEnvelope(res.data);
}

/** The only place the console talks to the agent events API (CLEAN-139). */
export class AgentEventGateway extends BaseGateway implements IAgentEventGateway {
  private mapper = new AgentEventMapper();

  listEvents(query: IListAgentEventsQuery = {}): Promise<IAgentEventPage> {
    return this.execute(async () => {
      const res = await AgentEventsService.listAgentEvents({ query });
      return this.mapper.toEventPage(
        unwrapOrThrow(res, 'Loading events') as AgentEventPageDto | null,
      );
    });
  }

  listIncidents(query: IListAgentIncidentsQuery = {}): Promise<IAgentIncidentPage> {
    return this.execute(async () => {
      const res = await AgentEventsService.listAgentIncidents({ query });
      return this.mapper.toIncidentPage(
        unwrapOrThrow(res, 'Loading incidents') as AgentIncidentPageDto | null,
      );
    });
  }

  getDestination(): Promise<INotificationDestination> {
    return this.execute(async () => {
      const res = await AgentEventsService.getNotificationDestination();
      return this.destinationOrThrow(res, 'Loading the notification destination');
    });
  }

  saveDestination(webhookUrl: string): Promise<INotificationDestination> {
    return this.execute(async () => {
      const res = await AgentEventsService.saveNotificationDestination({
        body: { webhookUrl },
      });
      return this.destinationOrThrow(res, 'Saving the notification destination');
    });
  }

  // 204, no body: the caller reads the destination again for the new state.
  removeDestination(): Promise<void> {
    return this.execute(async () => {
      const res = await AgentEventsService.removeNotificationDestination();
      unwrapOrThrow(res, 'Removing the notification destination');
    });
  }

  sendTest(): Promise<ITestDelivery> {
    return this.execute(async () => {
      const res = await AgentEventsService.testNotificationDestination();
      const dto = unwrapOrThrow(res, 'Sending the test') as TestDeliveryDto | null;
      if (!dto) throw new Error('Sending the test failed: empty response');
      return this.mapper.toTestDelivery(dto);
    });
  }

  private destinationOrThrow(res: HeyApiResult, action: string): INotificationDestination {
    const dto = unwrapOrThrow(res, action) as NotificationDestinationDto | null;
    if (!dto) throw new Error(`${action} failed: empty response`);
    return this.mapper.toDestination(dto);
  }
}
