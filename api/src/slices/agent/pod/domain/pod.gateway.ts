import { Observable } from 'rxjs';
import { IAgentMetrics, IAgentPodEvent, IAgentPodStatus } from './pod.types';

export abstract class IPodGateway {
  abstract delete(agentId: string): Promise<void>;
  abstract list(): Promise<IAgentPodStatus[]>;
  abstract events$(): Observable<IAgentPodEvent>;
  abstract resync(): Promise<void>;
  abstract getMetrics(agentId: string): Promise<IAgentMetrics | null>;
}
