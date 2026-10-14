import type {
  IAgentEventPage,
  IAgentIncidentPage,
  IListAgentEventsQuery,
  IListAgentIncidentsQuery,
  INotificationDestination,
  ISaveDestination,
  ITestDelivery,
} from './agentEvent.types';

/**
 * Contract for the agent events API. Implemented by `AgentEventGateway`.
 * Posting an event is not here: that is what a monitor does with an API key,
 * never the console.
 */
export abstract class IAgentEventGateway {
  abstract listEvents(query?: IListAgentEventsQuery): Promise<IAgentEventPage>;
  abstract listIncidents(query?: IListAgentIncidentsQuery): Promise<IAgentIncidentPage>;
  abstract getDestination(): Promise<INotificationDestination>;
  abstract saveDestination(input: ISaveDestination): Promise<INotificationDestination>;
  abstract removeDestination(): Promise<void>;
  abstract sendTest(): Promise<ITestDelivery>;
}
