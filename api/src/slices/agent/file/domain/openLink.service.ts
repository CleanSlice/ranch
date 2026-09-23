import { Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { OPEN_LINK_TTL_SEC } from './file.limits';
import type { FileKind } from './fileKind';

export interface IOpenLinkClaims {
  agentId: string;
  path: string;
  kind: FileKind;
}

const SUBJECT = 'open-link';

/**
 * "Open full" links (CLEAN-112, research R3): a short-lived token that names
 * exactly one stored object. The token is the whole credential for
 * `GET /agents/:id/files/raw` — no session, no cookie — so the link can be
 * opened in a fresh tab and dies on its own after OPEN_LINK_TTL_SEC.
 */
@Injectable()
export class OpenLinkService {
  constructor(private readonly jwt: JwtService) {}

  mint(
    agentId: string,
    path: string,
    kind: FileKind,
  ): { token: string; expiresAt: Date } {
    const expiresAt = new Date(Date.now() + OPEN_LINK_TTL_SEC * 1000);
    const token = this.jwt.sign(
      { sub: SUBJECT, agentId, path, kind },
      { expiresIn: OPEN_LINK_TTL_SEC },
    );
    return { token, expiresAt };
  }

  verify(token: string): IOpenLinkClaims {
    let payload: Record<string, unknown>;
    try {
      payload = this.jwt.verify<Record<string, unknown>>(token);
    } catch {
      throw new UnauthorizedException('Open link is invalid or has expired');
    }
    if (
      payload.sub !== SUBJECT ||
      typeof payload.agentId !== 'string' ||
      typeof payload.path !== 'string'
    ) {
      throw new UnauthorizedException('Open link is invalid');
    }
    return {
      agentId: payload.agentId,
      path: payload.path,
      kind: payload.kind === 'binary' ? 'binary' : 'text',
    };
  }
}
