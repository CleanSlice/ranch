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
import { IBridleAttachmentGateway, IBridleGateway } from '#/bridle/domain';
import { IAuthTokenPayload } from '#/user/auth/domain';
import { callerAgentId, err } from '#/mcp/tooling';
import {
  FileProposalService,
  IFileGateway,
  IMPORT_MAX_ARCHIVE_BYTES,
  MAX_EDIT_BYTES,
  MAX_RANGE_BYTES,
  ProposalNeedsRemoveConfirmError,
  ProposalNotPendingError,
  RANGE_BYTES,
  SyncGuardService,
  WorkspaceArchiveService,
} from './domain';
import type { IFileChangeProposal } from './domain';
import { randomUUID } from 'crypto';
import { lookup } from 'dns/promises';
import { request as httpsRequest } from 'https';

type AuthedRequest = Request & { user?: IAuthTokenPayload };

const CONFIRM_BY_PROPOSAL =
  'The first call only proposes: the person sees a card with the change ' +
  'and must accept it (Apply on the card, or a yes in the chat). Call again ' +
  'with confirm: true AND the proposalId from the first result to apply ' +
  'exactly that proposal. Changes reach the running agent on its next restart.';

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
    private readonly archive: WorkspaceArchiveService,
    private readonly proposals: FileProposalService,
    @Inject(forwardRef(() => IBridleAttachmentGateway))
    private readonly attachments: IBridleAttachmentGateway,
  ) {}

  async isListedForRequest(httpRequest: Request): Promise<boolean> {
    return callerIsOperator(httpRequest);
  }

  // ── Read (CLEAN-112) ─────────────────────────────────────────────

  @Tool({
    name: 'list_agent_files',
    topic: ToolTopics.AgentWorkspace,
    title: 'List workspace files',
    template: 'List the files of the agent «name»',
    description:
      'Files stored for an agent (path, size, kind, editable, updated). Use ' +
      '`prefix` to narrow (for example `skills/`). Binary files can be listed ' +
      'and exported, not read. Resolve the agent id with list_agents first.',
    parameters: z.object({
      agentId: z.string(),
      prefix: z
        .string()
        .optional()
        .describe('Only paths under this folder, e.g. skills/'),
    }),
  })
  async listAgentFiles(
    args: { agentId: string; prefix?: string },
    _context: unknown,
    httpRequest: AuthedRequest,
  ) {
    requireOperator(httpRequest);
    const agent = await this.agents.findById(args.agentId);
    if (!agent) return this.agentNotFound(args.agentId);
    const prefix = args.prefix
      ? args.prefix.endsWith('/')
        ? args.prefix
        : `${args.prefix}/`
      : '';
    const nodes = (await this.files.list(args.agentId)).filter(
      (n) => !prefix || n.path.startsWith(prefix),
    );
    return ok({
      agentId: args.agentId,
      agentName: agent.name,
      count: nodes.length,
      files: nodes.map((n) => ({
        path: n.path,
        size: n.size,
        kind: n.kind,
        editable: n.editable,
        updatedAt: n.updatedAt.toISOString(),
      })),
    });
  }

  @Tool({
    name: 'read_agent_file',
    topic: ToolTopics.AgentWorkspace,
    title: 'Read a workspace file',
    template: 'Read «path» from the agent «name»',
    description:
      'Reads a text file in slices of up to 512 KB; the result carries ' +
      '`nextOffset` when more remains — pass it as `offset` to continue. ' +
      'Binary files are refused: offer export_agent_files instead.',
    parameters: z.object({
      agentId: z.string(),
      path: z.string().describe('Relative path, e.g. agent.config.json'),
      offset: z.number().int().min(0).optional(),
      limit: z.number().int().min(1).optional(),
    }),
  })
  async readAgentFile(
    args: { agentId: string; path: string; offset?: number; limit?: number },
    _context: unknown,
    httpRequest: AuthedRequest,
  ) {
    requireOperator(httpRequest);
    const agent = await this.agents.findById(args.agentId);
    if (!agent) return this.agentNotFound(args.agentId);
    try {
      const chunk = await this.files.readRange(
        args.agentId,
        args.path,
        args.offset ?? 0,
        Math.min(MAX_RANGE_BYTES, args.limit ?? RANGE_BYTES),
      );
      return ok({
        agentId: args.agentId,
        path: chunk.path,
        kind: chunk.kind,
        editable: chunk.editable,
        totalSize: chunk.totalSize,
        offset: chunk.offset,
        size: chunk.size,
        nextOffset: chunk.nextOffset,
        hasMore: chunk.hasMore,
        updatedAt: chunk.updatedAt.toISOString(),
        content: chunk.content,
      });
    } catch (e) {
      return err(this.messageOf(e, `Could not read ${args.path}`));
    }
  }

  // ── Write through a proposal (CLEAN-112) ─────────────────────────

  @Tool({
    name: 'write_agent_file',
    topic: ToolTopics.AgentWorkspace,
    title: 'Change a workspace file',
    template: 'Change «path» of the agent «name»: «what to change»',
    destructive: true,
    description:
      'Replaces the content of a text file in the agent workspace. ' +
      CONFIRM_BY_PROPOSAL +
      ' Files larger than 1 MiB cannot be written this way — tell the ' +
      'person to use the Files tab. Invalid JSON for a `.json` path is ' +
      'refused before proposing.',
    parameters: z.object({
      agentId: z.string(),
      path: z.string().describe('Relative path, e.g. agent.config.json'),
      content: z.string().describe('The whole new content of the file.'),
      confirm: z
        .boolean()
        .optional()
        .describe(
          'Set true only together with `proposalId`, after the person accepted.',
        ),
      proposalId: z
        .string()
        .optional()
        .describe('The id returned by the proposing call.'),
    }),
  })
  async writeAgentFile(
    args: {
      agentId: string;
      path: string;
      content: string;
      confirm?: boolean;
      proposalId?: string;
    },
    _context: unknown,
    httpRequest: AuthedRequest,
  ) {
    return this.proposeOrApply(args, 'write', httpRequest);
  }

  @Tool({
    name: 'create_agent_file',
    topic: ToolTopics.AgentWorkspace,
    title: 'Create a workspace file',
    template: 'Create «path» in the agent «name»',
    destructive: true,
    description:
      'Creates a new text file in the agent workspace; refused when the path ' +
      'already exists (use write_agent_file for that). ' +
      CONFIRM_BY_PROPOSAL,
    parameters: z.object({
      agentId: z.string(),
      path: z.string().describe('Relative path, e.g. notes/todo.md'),
      content: z
        .string()
        .optional()
        .describe('Initial content; empty by default.'),
      confirm: z.boolean().optional(),
      proposalId: z.string().optional(),
    }),
  })
  async createAgentFile(
    args: {
      agentId: string;
      path: string;
      content?: string;
      confirm?: boolean;
      proposalId?: string;
    },
    _context: unknown,
    httpRequest: AuthedRequest,
  ) {
    return this.proposeOrApply(
      { ...args, content: args.content ?? '' },
      'create',
      httpRequest,
    );
  }

  private async proposeOrApply(
    args: {
      agentId: string;
      path: string;
      content: string;
      confirm?: boolean;
      proposalId?: string;
    },
    op: 'write' | 'create',
    httpRequest: AuthedRequest,
  ) {
    requireOperator(httpRequest);
    const agent = await this.agents.findById(args.agentId);
    if (!agent) return this.agentNotFound(args.agentId);
    const chatAgentId = callerAgentId(httpRequest) ?? 'operator';

    if (args.confirm) {
      return this.confirmProposal(
        args.agentId,
        args.proposalId,
        chatAgentId,
        undefined,
      );
    }
    if (Buffer.byteLength(args.content, 'utf-8') > MAX_EDIT_BYTES) {
      return err(
        `${args.path} is too large to write from the chat (limit ${MAX_EDIT_BYTES} bytes) — ask the person to use the Files tab.`,
      );
    }
    try {
      const row = await this.proposals.propose({
        agentId: args.agentId,
        chatAgentId,
        path: args.path,
        content: args.content,
        op,
      });
      return ok(this.pendingResult(row, agent.name));
    } catch (e) {
      return err(
        this.messageOf(e, `Could not propose the change to ${args.path}`),
      );
    }
  }

  // ── Import through a proposal (CLEAN-112) ────────────────────────

  @Tool({
    name: 'import_agent_files',
    topic: ToolTopics.AgentWorkspace,
    title: 'Import a workspace archive',
    template: 'Import the archive «attachment or link» into the agent «name»',
    destructive: true,
    description:
      'Imports a zip with the workspace layout (root files, data/, memory/, ' +
      'skills/, workspace/). Give either the id of the chat attachment the ' +
      'person uploaded or an https link. The first call stages the archive ' +
      'and previews it (added / changed / removed / skipped); the person ' +
      'must accept. `mode: replace` also deletes files that are not in the ' +
      'archive and needs its own explicit acceptance (confirmRemove). ' +
      'Chat attachments are limited to 10 MB; larger archives go through ' +
      'the Import button in the Files tab (a local file picker stays in the ' +
      'console) or a link. ' +
      CONFIRM_BY_PROPOSAL,
    parameters: z.object({
      agentId: z.string(),
      attachmentId: z
        .string()
        .optional()
        .describe('Id of a zip the person attached in this chat.'),
      url: z.string().optional().describe('https link to a zip.'),
      mode: z.enum(['merge', 'replace']).optional(),
      includeSessions: z.boolean().optional(),
      confirm: z.boolean().optional(),
      proposalId: z.string().optional(),
      confirmRemove: z
        .boolean()
        .optional()
        .describe('Replace mode: the person also accepted the removals.'),
    }),
  })
  async importAgentFiles(
    args: {
      agentId: string;
      attachmentId?: string;
      url?: string;
      mode?: 'merge' | 'replace';
      includeSessions?: boolean;
      confirm?: boolean;
      proposalId?: string;
      confirmRemove?: boolean;
    },
    _context: unknown,
    httpRequest: AuthedRequest,
  ) {
    requireOperator(httpRequest);
    const agent = await this.agents.findById(args.agentId);
    if (!agent) return this.agentNotFound(args.agentId);
    const chatAgentId = callerAgentId(httpRequest) ?? 'operator';

    if (args.confirm) {
      return this.confirmProposal(
        args.agentId,
        args.proposalId,
        chatAgentId,
        args.confirmRemove,
      );
    }

    let zip: Buffer;
    let source: 'attachment' | 'url';
    try {
      if (args.attachmentId) {
        // Attachments are scoped to the chat agent (the one the person is
        // talking to), never to the target workspace.
        const stored = await this.attachments.fetch(
          chatAgentId,
          args.attachmentId,
        );
        if (!stored)
          return err(
            `Attachment ${args.attachmentId} was not found in this chat.`,
          );
        zip = stored.body;
        source = 'attachment';
      } else if (args.url) {
        zip = await this.fetchArchive(args.url);
        source = 'url';
      } else {
        return err(
          'Give either `attachmentId` (a zip attached in the chat) or `url` (an https link).',
        );
      }
    } catch (e) {
      return err(this.messageOf(e, 'Could not fetch the archive'));
    }

    const mode = args.mode ?? 'merge';
    const includeSessions = args.includeSessions ?? false;
    try {
      const { entries, wrapperStripped } = await this.archive.validate(zip);
      const importId = randomUUID();
      await this.files.putStage(args.agentId, importId, zip, {
        agentId: args.agentId,
        source,
        size: zip.length,
        entries: entries.length,
        createdAt: new Date(),
      });
      const plan = await this.archive.plan(
        args.agentId,
        entries,
        { mode, includeSessions },
        { importId, wrapperStripped },
      );
      const row = await this.proposals.proposeImport({
        agentId: args.agentId,
        chatAgentId,
        importId,
        plan,
        mode,
        includeSessions,
      });
      return ok({
        ...this.pendingResult(row, agent.name),
        plan: {
          mode,
          includeSessions,
          counts: plan.counts,
          totalBytes: plan.totalBytes,
          wrapperStripped: plan.wrapperStripped,
          warnings: plan.warnings,
          sample: plan.entries
            .filter((e) => e.action !== 'unchanged')
            .slice(0, 20),
        },
      });
    } catch (e) {
      return err(this.messageOf(e, 'The archive was refused'));
    }
  }

  private async confirmProposal(
    agentId: string,
    proposalId: string | undefined,
    chatAgentId: string,
    confirmRemove: boolean | undefined,
  ) {
    if (!proposalId) {
      return err(
        'No pending proposal to confirm: call without confirm first to propose, then confirm with its proposalId.',
      );
    }
    let row: IFileChangeProposal;
    try {
      row = await this.proposals.get(proposalId);
    } catch {
      return err(`No proposal ${proposalId}.`);
    }
    if (row.agentId !== agentId) {
      return err(`Proposal ${proposalId} belongs to another agent.`);
    }
    if (row.status !== 'pending') {
      // The person may have pressed Apply on the card already — say so.
      return ok(this.finalResult(row));
    }
    try {
      const done = await this.proposals.apply(proposalId, {
        actor: `agent:${chatAgentId}`,
        via: 'tool',
        confirmRemove,
      });
      return ok(this.finalResult(done));
    } catch (e) {
      if (e instanceof ProposalNotPendingError)
        return ok(this.finalResult(e.row));
      if (e instanceof ProposalNeedsRemoveConfirmError) {
        return err(
          `Replace would remove ${e.remove} files that are not in the archive. Ask the person to accept the removals, then call again with confirm: true, proposalId and confirmRemove: true.`,
        );
      }
      return err(this.messageOf(e, 'Could not apply the proposal'));
    }
  }

  private pendingResult(row: IFileChangeProposal, agentName: string) {
    return {
      ok: true,
      proposalId: row.id,
      status: 'pending',
      agentId: row.agentId,
      agentName,
      summary:
        row.kind === 'single'
          ? {
              path: row.path,
              op: row.op,
              additions: row.additions,
              deletions: row.deletions,
              changedLines: row.changedLines,
              firstChangedLine: row.firstChangedLine,
              diffStatus: row.diffStatus,
              proposedBytes: row.proposedBytes,
            }
          : { counts: row.summary?.counts, mode: row.mode },
      next:
        'Show the person the change and wait. Call again with confirm: true ' +
        'and this proposalId only after they accept in the chat or press Apply on the card.',
    };
  }

  private finalResult(row: IFileChangeProposal) {
    return {
      ok: row.status === 'applied',
      proposalId: row.id,
      status: row.status,
      agentId: row.agentId,
      path: row.path,
      reason: row.reason,
      result: row.result,
      notice:
        row.status === 'applied'
          ? 'Saved to S3. The running agent picks it up on its next restart.'
          : row.status === 'stale'
            ? 'The file changed since this was proposed — read it again and propose anew.'
            : undefined,
    };
  }

  /** https only, public addresses only, capped at the archive limit. */
  private async fetchArchive(url: string): Promise<Buffer> {
    let target: URL;
    try {
      target = new URL(url);
    } catch {
      throw new Error('The link is not a valid URL');
    }
    if (target.protocol !== 'https:')
      throw new Error('Only https links are accepted');
    if (target.username || target.password) {
      throw new Error('The link must not carry credentials');
    }
    // Resolve once, refuse private ranges, and PIN that address into the
    // connection: a second resolution at connect time is what a DNS-rebinding
    // host exploits (public answer for the check, private one for the fetch).
    // TLS still validates the certificate against the hostname (SNI is set
    // from `servername`), so the pin does not weaken the transport.
    const addresses = await lookup(target.hostname, { all: true });
    if (!addresses.length) throw new Error('The link does not resolve');
    for (const a of addresses) {
      if (isPrivateAddress(a.address)) {
        throw new Error('The link points at a private address');
      }
    }
    const pinned = addresses[0];
    return downloadPinned(
      target,
      pinned.address,
      pinned.family,
      IMPORT_MAX_ARCHIVE_BYTES,
    );
  }

  private messageOf(e: unknown, fallback: string): string {
    const msg = (e as { message?: unknown })?.message;
    if (typeof msg === 'string' && msg) return msg;
    if (Array.isArray(msg)) return msg.join('; ');
    return fallback;
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

/**
 * HTTPS GET that connects to `address` (already checked) instead of resolving
 * the hostname again, never follows redirects (a redirect could point back
 * inside), and stops reading past `maxBytes`. Exported for the spec.
 */
export function downloadPinned(
  target: URL,
  address: string,
  family: number,
  maxBytes: number,
  timeoutMs = 30_000,
): Promise<Buffer> {
  return new Promise<Buffer>((resolve, reject) => {
    const req = httpsRequest(
      {
        protocol: 'https:',
        hostname: target.hostname,
        servername: target.hostname,
        port: target.port || 443,
        path: `${target.pathname}${target.search}`,
        method: 'GET',
        headers: { accept: 'application/zip, application/octet-stream' },
        timeout: timeoutMs,
        // The pin: whatever the resolver says now is ignored in favour of the
        // address that passed the private-range check.
        lookup: (_host, options, callback) => {
          if (
            options &&
            typeof options === 'object' &&
            (options as { all?: boolean }).all
          ) {
            (
              callback as (
                e: null,
                a: Array<{ address: string; family: number }>,
              ) => void
            )(null, [{ address, family }]);
          } else {
            (callback as (e: null, a: string, f: number) => void)(
              null,
              address,
              family,
            );
          }
        },
      },
      (res) => {
        const status = res.statusCode ?? 0;
        if (status >= 300 && status < 400) {
          res.resume();
          reject(
            new Error('The link redirects — give the final address instead'),
          );
          return;
        }
        if (status < 200 || status >= 300) {
          res.resume();
          reject(new Error(`The link answered ${status}`));
          return;
        }
        const declared = Number(res.headers['content-length'] ?? '0');
        if (declared > maxBytes) {
          res.destroy();
          reject(new Error(`The archive is over the ${maxBytes}-byte limit`));
          return;
        }
        const chunks: Buffer[] = [];
        let total = 0;
        res.on('data', (chunk: Buffer) => {
          total += chunk.length;
          if (total > maxBytes) {
            res.destroy();
            reject(new Error(`The archive is over the ${maxBytes}-byte limit`));
            return;
          }
          chunks.push(chunk);
        });
        res.on('end', () => resolve(Buffer.concat(chunks)));
        res.on('error', reject);
      },
    );
    req.on('timeout', () => {
      req.destroy(new Error('The link did not answer in time'));
    });
    req.on('error', reject);
    req.end();
  });
}

/** Loopback, link-local, private and unspecified ranges (SSRF guard). */
export function isPrivateAddress(address: string): boolean {
  const ip = address.toLowerCase();
  if (
    ip === '::1' ||
    ip === '::' ||
    ip.startsWith('fe80:') ||
    ip.startsWith('fc') ||
    ip.startsWith('fd')
  ) {
    return true;
  }
  const v4 = ip.startsWith('::ffff:') ? ip.slice(7) : ip;
  const parts = v4.split('.').map((p) => Number(p));
  if (
    parts.length !== 4 ||
    parts.some((p) => !Number.isInteger(p) || p < 0 || p > 255)
  ) {
    return false;
  }
  const [a, b] = parts;
  return (
    a === 0 ||
    a === 10 ||
    a === 127 ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    (a === 100 && b >= 64 && b <= 127)
  );
}
