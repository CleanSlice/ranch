export abstract class IPodGateway {
  abstract delete(agentId: string): Promise<void>;
}
