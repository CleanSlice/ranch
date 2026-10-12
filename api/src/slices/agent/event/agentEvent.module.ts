import { Module } from '@nestjs/common';
import { AuthModule } from '#/user/auth/auth.module';
import { ApiKeyModule } from '#/user/apiKey/apiKey.module';
import { AgentModule } from '#/agent/agent/agent.module';
import { AgentEventIngestController } from './agentEvent.ingest.controller';
import { AgentEventController } from './agentEvent.controller';
import { AgentEventTool } from './agentEvent.tool';
import { IAgentEventGateway } from './domain/agentEvent.gateway';
import { AgentEventService } from './domain/agentEvent.service';
import { AgentIncidentService } from './domain/agentIncident.service';
import { AgentNotificationWorker } from './domain/agentNotification.worker';
import { NotificationDestinationService } from './domain/notificationDestination.service';
import { INotifier } from './domain/notifier';
import { AgentEventGateway } from './data/agentEvent.gateway';
import { AgentEventMapper } from './data/agentEvent.mapper';
import { SlackWebhookNotifier } from './data/slackWebhook.notifier';

// One direction only: this module reads the agent slice (IAgentGateway to
// look an agent up, AgentStatusChanges to hear its transitions) and nothing
// in the agent slice knows events exist — so no forwardRef, and AgentModule
// gains no new cycle. AuthModule brings the JWT and API-key guards;
// ApiKeyModule the service ScopesGuard asks about scopes.
@Module({
  imports: [AuthModule, ApiKeyModule, AgentModule],
  controllers: [AgentEventIngestController, AgentEventController],
  providers: [
    AgentEventMapper,
    AgentIncidentService,
    NotificationDestinationService,
    AgentNotificationWorker,
    AgentEventService,
    AgentEventTool,
    {
      provide: IAgentEventGateway,
      useClass: AgentEventGateway,
    },
    {
      provide: INotifier,
      useClass: SlackWebhookNotifier,
    },
  ],
  exports: [AgentEventService, NotificationDestinationService],
})
export class AgentEventModule {}
