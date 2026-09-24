import { ForbiddenException } from '@nestjs/common';
import {
  AGENT_DIRECT_WRITE_REFUSAL,
  refuseAgentWrite,
} from './agentTokenGuard';

describe('refuseAgentWrite', () => {
  it('lets a person through', () => {
    expect(() => refuseAgentWrite({ user: { sub: 'user-1' } })).not.toThrow();
    expect(() => refuseAgentWrite({ user: { sub: 'admin' } })).not.toThrow();
    expect(() => refuseAgentWrite(undefined)).not.toThrow();
  });

  it('refuses an agent token, Rancher included, and names the tools to use', () => {
    expect(() =>
      refuseAgentWrite({ user: { sub: 'agent:agent-0db1552e' } }),
    ).toThrow(ForbiddenException);
    try {
      refuseAgentWrite({ user: { sub: 'agent:x' } });
    } catch (e) {
      expect((e as Error).message).toBe(AGENT_DIRECT_WRITE_REFUSAL);
      expect((e as Error).message).toContain('write_agent_file');
    }
  });
});
