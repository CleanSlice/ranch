import { Inject, Injectable, forwardRef } from '@nestjs/common';
import { Request } from 'express';
import { z } from 'zod';
import { Tool, ToolTopics } from '#mcp';
import {
  CONFIRM_SENTENCE,
  callerIsOperator,
  confirmed,
  ok,
  requireOperator,
} from '#/mcp/tooling';
import type { IConditionallyListedTool } from '#/mcp/interfaces/conditional-listing.interface';
import { IAgentGateway } from '#/agent/agent/domain';
import { IBridleGateway } from '#/bridle/domain';
import { IAuthTokenPayload } from '#/user/auth/domain';
import { IFileGateway, SyncGuardService } from './domain';

type AuthedRequest = Request & { user?: IAuthTokenPayload };

/**
 * The workspace actions of the console's Files tab that `rancher.tool.ts`
 * did not cover (CLEAN-109): delete, sync from the pod, export. Listing,
 * reading and writing files stay where they were.
 *
 * Each method mirrors the matching `FileController` handler — same
 * gateways, same guards, same response shape — so an agent cannot do from
 * the chat what the console would have refused. The sync guard (CLEAN-50)
 * in particular is copied rather than referenced: the pod pushes blindly
 * over S3, and the at-risk list is the only thing standing between an
 * operator and a silent overwrite.
 *
 * Operator-only: hidden from plain agents and refused if called anyway.
 */
@Injectable()
export class FileTool implements IConditionallyListedTool {
  constructor(
    @Inject(forwardRef(() => IAgentGateway))
    private readonly agents: IAgentGateway,
    private readonly files: IFileGateway,
    @Inject(forwardRef(() => IBridleGateway))
    private readonly bridle: IBridleGateway,
    private readonly syncGuard: SyncGuardService,
  ) {}

  async isListedForRequest(httpRequest: Request): Promise<boolean> {
    return callerIsOperator(httpRequest);
  }

  @Tool({
    name: 'delete_agent_file',
    topic: ToolTopics.AgentWorkspace,
    title: 'Delete a workspace file',
    template: 'Delete «path» from the agent «name»',
    destructive: true,
    description:
      'Delete one file from the agent workspace in S3, or a whole folder ' +
      '(for example a skill directory) when `recursive` is true. Resolve the ' +
      'agent id with list_agents and the path with list_agent_files first. ' +
      'Returns the number of objects deleted. Template-managed skills come ' +
      'back on the next restart unless the agent is detached from the ' +
      'template. ' +
      CONFIRM_SENTENCE,
    parameters: z.object({
      agentId: z.string(),
      path: z.string().describe('Relative path, e.g. skills/x-poster/SKILL.md'),
      recursive: z
        .boolean()
        .optional()
        .describe(
          'When true, `path` is a folder and every file under it is deleted.',
        ),
      confirm: z
        .boolean()
        .describe('Set true only after the person confirmed in the chat.'),
    }),
  })
  async deleteAgentFile(
    args: {
      agentId: string;
      path: string;
      recursive?: boolean;
      confirm?: boolean;
    },
    _context: unknown,
    httpRequest: AuthedRequest,
  ) {
    requireOperator(httpRequest);
    const agent = await this.agents.findById(args.agentId);
    if (!agent) return this.agentNotFound(args.agentId);

    const what = args.recursive
      ? `delete the folder «${args.path}» and everything under it from the agent «${agent.name}»`
      : `delete «${args.path}» from the agent «${agent.name}»`;
    const refusal = confirmed(args, what);
    if (refusal) return refusal;

    let deleted = 1;
    if (args.recursive) {
      deleted = await this.files.deletePrefix(args.agentId, args.path);
    } else {
      await this.files.delete(args.agentId, args.path);
    }

    return ok({
      agentId: args.agentId,
      path: args.path,
      recursive: Boolean(args.recursive),
      deleted,
      notice:
        'Removed from S3 only. The running agent keeps its boot-time copy ' +
        'until restarted; a template-managed skill is recreated on restart ' +
        'unless the agent is detached from its template.',
    });
  }

  @Tool({
    name: 'sync_agent_files',
    topic: ToolTopics.AgentWorkspace,
    title: 'Sync files from the pod',
    template: 'Sync the workspace files of the agent «name» from its pod',
    description:
      'Ask the running agent to push its local workspace files to S3, so the ' +
      'console and read_agent_file see what the pod sees. Refuses with an ' +
      '`atRisk` list (and does NOT sync) when S3 holds files edited after ' +
      "the pod's last pull or push — those could be overwritten. Show the " +
      'list to the person; call again with `confirm: true` only after they ' +
      'accepted the risk. Returns `agentOnline` and the number of files ' +
      'pushed; an offline agent pushes nothing.',
    parameters: z.object({
      agentId: z.string(),
      confirm: z
        .boolean()
        .optional()
        .describe(
          'Set true only after the person saw the at-risk list and accepted ' +
            'that those S3 files may be overwritten.',
        ),
    }),
  })
  async syncAgentFiles(
    args: { agentId: string; confirm?: boolean },
    _context: unknown,
    httpRequest: AuthedRequest,
  ) {
    requireOperator(httpRequest);
    const agent = await this.agents.findById(args.agentId);
    if (!agent) return this.agentNotFound(args.agentId);

    // Same guard as FileController.sync (CLEAN-50): `confirm` skips the
    // check because the operator already saw and accepted the list.
    if (!args.confirm) {
      const { baseline, atRisk } = await this.syncGuard.assess(
        args.agentId,
        agent.lastPullAt,
        agent.lastSyncAt,
      );
      if (baseline && atRisk.length > 0) {
        return ok({
          requiresConfirmation: true,
          synced: false,
          atRisk: atRisk.map((n) => ({
            path: n.path,
            updatedAt: n.updatedAt.toISOString(),
          })),
          baseline: baseline.toISOString(),
          notice:
            'Not synced. These S3 files changed after the pod last aligned ' +
            'with S3 and a sync may overwrite them. Show the list to the ' +
            'person; call again with confirm: true once they accept.',
        });
      }
    }

    const result = await this.bridle.syncAgent(args.agentId);
    // Offline sync did nothing, so it must not advance the conflict baseline.
    if (result.agentOnline) {
      await this.agents.setLastSyncAt(args.agentId);
    }
    return ok({
      agentId: args.agentId,
      agentOnline: result.agentOnline,
      pushed: result.pushed,
      ...(result.agentOnline
        ? {}
        : {
            notice:
              'The agent is not connected, nothing was pushed. Start or ' +
              'restart it and sync again.',
          }),
    });
  }

  @Tool({
    name: 'export_agent_files',
    topic: ToolTopics.AgentWorkspace,
    title: 'Export the workspace',
    template: 'Export the workspace of the agent «name»',
    description:
      'Prepare a download of the whole agent workspace (files, skills, ' +
      'runtime state) as a zip — the safety net before a destructive change. ' +
      'The zip cannot travel through the chat: the result gives the console ' +
      'path to open (it needs the person’s login) and how many files the ' +
      'archive will hold. Resolve the agent id with list_agents first.',
    parameters: z.object({ agentId: z.string() }),
  })
  async exportAgentFiles(
    { agentId }: { agentId: string },
    _context: unknown,
    httpRequest: AuthedRequest,
  ) {
    requireOperator(httpRequest);
    const agent = await this.agents.findById(agentId);
    if (!agent) return this.agentNotFound(agentId);

    const nodes = await this.files.list(agentId);
    return ok({
      agentId,
      agentName: agent.name,
      fileCount: nodes.length,
      downloadPath: `/agents/${agentId}/files/export`,
      note: 'Open this path in the console (it needs your login) to download the zip.',
    });
  }

  private agentNotFound(agentId: string) {
    return ok({
      error: `Agent ${agentId} not found — call list_agents to find the id`,
    });
  }
}
