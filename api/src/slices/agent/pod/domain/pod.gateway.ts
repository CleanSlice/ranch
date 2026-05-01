import { Observable } from 'rxjs';
import { IAgentPodEvent, IAgentPodStatus } from './pod.types';

export abstract class IPodGateway {
  abstract delete(agentId: string): Promise<void>;
  abstract list(): Promise<IAgentPodStatus[]>;
  abstract events$(): Observable<IAgentPodEvent>;
}
