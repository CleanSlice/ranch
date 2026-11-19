import { Global, Module } from '@nestjs/common';
import { AgentPinController } from './agentPin.controller';
import { AgentPinGateway } from './data/agentPin.gateway';
import { IAgentPinGateway } from './domain/agentPin.gateway';

/**
 * Personal pins (CLEAN-231): `PUT` / `DELETE /agents/:id/pin`, and the
 * gateway the agent routes and the `pin_agent` tool read "pinned by the
 * caller" from.
 *
 * Global, like AgentPermissionModule: it is read by the agent slice (the
 * `pinned` of an agent as the caller sees it), by the user slice (an account
 * that is deleted takes its pins along) and by a tool, and it depends on
 * nothing but Prisma, so nobody has to mind an import cycle for it.
 */
@Global()
@Module({
  controllers: [AgentPinController],
  providers: [{ provide: IAgentPinGateway, useClass: AgentPinGateway }],
  exports: [IAgentPinGateway],
})
export class AgentPinModule {}
