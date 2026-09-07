import { IShareLinkData } from './shareLink.types';

export interface ICreateShareLinkInput {
  agentId: string;
  token: string;
  /** JWT `sub` of the acting console user — lands in both createdBy and updatedBy. */
  userId: string;
}

export abstract class IShareLinkGateway {
  abstract findByAgent(agentId: string): Promise<IShareLinkData | null>;
  abstract findByToken(token: string): Promise<IShareLinkData | null>;
  /** Inserts the single row for an agent. Throws Prisma `P2002` if one exists. */
  abstract create(input: ICreateShareLinkInput): Promise<IShareLinkData>;
  /** Single atomic UPDATE: new token, revokedAt cleared, rotatedAt = now,
   *  rotationCount + 1, updatedBy = userId. */
  abstract rotate(
    agentId: string,
    token: string,
    userId: string,
  ): Promise<IShareLinkData>;
  /** Sets revokedAt = now and updatedBy; the token stays on the row (dead). */
  abstract revoke(agentId: string, userId: string): Promise<IShareLinkData>;
}
