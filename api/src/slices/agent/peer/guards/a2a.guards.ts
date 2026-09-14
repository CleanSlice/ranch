import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { UnauthorizedException } from '@nestjs/common';
import type { Request } from 'express';
import type { IAuthTokenPayload } from '#/user/auth/domain/auth.types';
import { hasAtLeastRole, UserRoleTypes } from '#/user/user/domain';
import { IPeerGateway } from '../domain/peer.gateway';
import { PEER_TOKEN_RE, PeerErrorCodes } from '../domain/peer.types';

/** What a guard leaves behind for the A2A route handlers. */
export interface IA2aRequest extends Request {
  /** Set when the caller presented a peer credential. */
  peer?: { peerId: string; callerAgentId: string };
  /** Set when the caller presented a console JWT (card route only). */
  user?: IAuthTokenPayload;
}

function bearer(request: Request): string | null {
  const header = request.headers.authorization;
  if (typeof header !== 'string') return null;
  const [scheme, value] = header.split(' ');
  if (scheme?.toLowerCase() !== 'bearer' || !value) return null;
  return value.trim();
}

function refuse(message: string): never {
  // One code for every way in, so a caller learns nothing from the difference
  // between "no such connection" and "wrong agent" — both mean "not for you".
  throw new UnauthorizedException({
    code: PeerErrorCodes.Unauthorized,
    message,
  });
}

/**
 * Resolves a presented `ap_` credential and checks it was issued to reach
 * THIS agent. Returns null when the header is absent or not a peer credential,
 * so a caller can fall through to another identity.
 */
async function resolvePeer(
  peers: IPeerGateway,
  request: IA2aRequest,
): Promise<{ peerId: string; callerAgentId: string } | null> {
  const token = bearer(request);
  if (!token || !PEER_TOKEN_RE.test(token)) return null;

  const row = await peers.findByToken(token);
  if (!row) refuse('Unknown peer credential');

  const agentId = request.params?.agentId;
  // A credential is issued for one pair. Presenting agent A's credential at
  // agent C's endpoint is the whole attack this check exists to stop.
  if (row.peerAgentId !== agentId) refuse('Credential is not for this agent');

  return { peerId: row.id, callerAgentId: row.agentId };
}

/**
 * The agent card is readable by two kinds of caller (CLEAN-74, FR-002):
 * an operator previewing a card in the console (Owner/Admin JWT), and an agent
 * reading the card of a peer it is connected to (`ap_` credential for that
 * agent). Nobody else — anonymous discovery is deliberately not offered, so a
 * card cannot be used to enumerate what an installation can do.
 */
@Injectable()
export class A2aCardGuard implements CanActivate {
  constructor(
    private readonly jwt: JwtService,
    private readonly peers: IPeerGateway,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<IA2aRequest>();

    const peer = await resolvePeer(this.peers, request);
    if (peer) {
      request.peer = peer;
      return true;
    }

    const token = bearer(request);
    if (!token) refuse('Missing credential');

    let payload: IAuthTokenPayload;
    try {
      payload = this.jwt.verify<IAuthTokenPayload>(token);
    } catch {
      refuse('Invalid credential');
    }

    // Agent service tokens are deliberately not accepted here: an agent reads
    // a peer's card with the credential issued for that connection, which is
    // also what proves the connection still exists.
    const roles = payload.roles ?? [];
    const allowed = roles.some((role) =>
      hasAtLeastRole(role, UserRoleTypes.Admin),
    );
    if (!allowed) refuse('Not allowed to read this card');

    request.user = payload;
    return true;
  }
}

/**
 * The JSON-RPC endpoint takes peer credentials only. A console JWT is refused
 * even for an owner: this route speaks for an agent, and "which agent is
 * asking" has to come from the credential, not from a field a caller could
 * choose.
 */
@Injectable()
export class A2aPeerGuard implements CanActivate {
  constructor(private readonly peers: IPeerGateway) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<IA2aRequest>();

    const peer = await resolvePeer(this.peers, request);
    if (!peer) refuse('A peer credential is required');

    request.peer = peer;
    return true;
  }
}
