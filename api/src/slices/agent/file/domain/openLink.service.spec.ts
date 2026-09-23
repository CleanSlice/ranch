import { UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { OpenLinkService } from './openLink.service';

const jwt = new JwtService({ secret: 'test' });
const service = new OpenLinkService(jwt);

describe('OpenLinkService', () => {
  it('round-trips the agent, path and kind', () => {
    const { token, expiresAt } = service.mint('agent-1', 'SOUL.md', 'text');
    expect(expiresAt.getTime()).toBeGreaterThan(Date.now());
    expect(service.verify(token)).toEqual({
      agentId: 'agent-1',
      path: 'SOUL.md',
      kind: 'text',
    });
  });

  it('keeps the binary kind', () => {
    const { token } = service.mint('agent-1', 'data/photo.png', 'binary');
    expect(service.verify(token).kind).toBe('binary');
  });

  it('rejects an expired token', () => {
    const token = jwt.sign(
      { sub: 'open-link', agentId: 'agent-1', path: 'SOUL.md', kind: 'text' },
      { expiresIn: -10 },
    );
    expect(() => service.verify(token)).toThrow(UnauthorizedException);
  });

  it('rejects a tampered token', () => {
    const { token } = service.mint('agent-1', 'SOUL.md', 'text');
    const [h, p, s] = token.split('.');
    const payload = Buffer.from(p, 'base64url').toString('utf-8');
    const forged = Buffer.from(payload.replace('SOUL.md', 'USER.md')).toString(
      'base64url',
    );
    expect(() => service.verify(`${h}.${forged}.${s}`)).toThrow(
      UnauthorizedException,
    );
  });

  it('rejects a token signed for another subject', () => {
    const token = jwt.sign(
      { sub: 'session', agentId: 'agent-1', path: 'SOUL.md', kind: 'text' },
      { expiresIn: 60 },
    );
    expect(() => service.verify(token)).toThrow(UnauthorizedException);
  });

  it('rejects garbage', () => {
    expect(() => service.verify('not-a-token')).toThrow(UnauthorizedException);
  });
});
