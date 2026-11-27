import { Global, Module, forwardRef } from '@nestjs/common';
import { ASSISTANT_BUILD_RESOLVER } from '#/mcp/interfaces/assistant-build.interface';
import { AgentModule } from '#/agent/agent/agent.module';
import { TemplateModule } from '#/agent/template/template.module';
import { AssistantBuildService } from './domain/assistantBuild.service';

/**
 * What the Ranch assistant is built from, in one place for the whole API
 * (CLEAN-271).
 *
 * Global for the reason AgentPermissionModule is: the rule is asked by the
 * route guard registered in app.module.ts, by the controllers of five
 * slices (templates, skills, tool servers, model credentials, knowledge)
 * and, through `ASSISTANT_BUILD_RESOLVER`, by the MCP handler for every
 * tool of those slices. None of them imports a module for it.
 */
@Global()
@Module({
  imports: [forwardRef(() => AgentModule), forwardRef(() => TemplateModule)],
  providers: [
    AssistantBuildService,
    { provide: ASSISTANT_BUILD_RESOLVER, useExisting: AssistantBuildService },
  ],
  exports: [AssistantBuildService, ASSISTANT_BUILD_RESOLVER],
})
export class AssistantBuildModule {}
