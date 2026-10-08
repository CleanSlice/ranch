import type { IAgentEventGateway } from './agentEvent.gateway';
import type {
  IAgentEventPage,
  IAgentIncidentPage,
  IListAgentEventsQuery,
  IListAgentIncidentsQuery,
  INotificationDestination,
  ITestDelivery,
} from './agentEvent.types';

/**
 * Domain service for agent events, incidents and the notification
 * destination. The store layers the reactive records on top.
 */
export class AgentEventService {
  constructor(private gateway: IAgentEventGateway) {}

  listEvents(query?: IListAgentEventsQuery): Promise<IAgentEventPage> {
    return this.gateway.listEvents(query);
  }

  listIncidents(query?: IListAgentIncidentsQuery): Promise<IAgentIncidentPage> {
    return this.gateway.listIncidents(query);
  }

  getDestination(): Promise<INotificationDestination> {
    return this.gateway.getDestination();
  }

  saveDestination(webhookUrl: string): Promise<INotificationDestination> {
    return this.gateway.saveDestination(webhookUrl);
  }

  removeDestination(): Promise<void> {
    return this.gateway.removeDestination();
  }

  sendTest(): Promise<ITestDelivery> {
    return this.gateway.sendTest();
  }
}
