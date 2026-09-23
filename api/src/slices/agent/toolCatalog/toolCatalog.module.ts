import { Module, forwardRef } from '@nestjs/common';
import { AuthModule } from '#/user/auth/auth.module';
import { AgentModule } from '#/agent/agent/agent.module';
import { PodModule } from '#/agent/pod/pod.module';
import { McpServerModule } from '#/mcpServer/mcpServer.module';
import { TOOL_LISTING_RECORDER } from '#/mcp/interfaces/tool-listing-recorder.interface';
import { ToolListingGateway } from './data/toolListing.gateway';
import { IToolListingGateway } from './domain/toolCatalog.types';
import { ToolCatalogService } from './domain/toolCatalog.service';
import { ToolCatalogController } from './toolCatalog.controller';

/**
 * The chat's Tools panel, server side (CLEAN-109): GET /agents/:id/tools and
 * the per-agent snapshot of the last tools/list a pod received. The mcp
 * slice's listing service comes from the global McpModule; the snapshot is
 * handed back to it under TOOL_LISTING_RECORDER.
 */
@Module({
  imports: [
    AuthModule,
    forwardRef(() => AgentModule),
    PodModule,
    McpServerModule,
  ],
  controllers: [ToolCatalogController],
  providers: [
    ToolCatalogService,
    { provide: IToolListingGateway, useClass: ToolListingGateway },
    { provide: TOOL_LISTING_RECORDER, useExisting: IToolListingGateway },
  ],
  exports: [IToolListingGateway, TOOL_LISTING_RECORDER],
})
export class ToolCatalogModule {}
