import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpException,
  HttpStatus,
  Inject,
  NotFoundException,
  Param,
  Post,
  Query,
  Req,
  Res,
  forwardRef,
} from '@nestjs/common';
import {
  ApiOkResponse,
  ApiOperation,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import type { Request, Response } from 'express';
import { IAgentGateway } from '#/agent/agent/domain';
import type { IAuthTokenPayload } from '#/user/auth/domain';
import {
  FileProposalService,
  PayloadTooLarge,
  ProposalNeedsRemoveConfirmError,
  ProposalNotPendingError,
} from './domain/fileProposal.service';
import type { IProposalView } from './domain/fileProposal.service';
import {
  ApplyProposalDto,
  FileChangeProposalDto,
  ListProposalsQueryDto,
  ProposalDiffQueryDto,
  ProposalRemoveConflictDto,
} from './dtos';

type AuthedRequest = Request & { user?: IAuthTokenPayload };

/**
 * Change proposals from the console's side (CLEAN-112): list them for a chat,
 * read one, its content or its diff, and Apply / Skip from the card or the
 * editor. Every write goes through the same `FileProposalService.apply` the
 * agent's confirming tool call uses.
 */
@ApiTags('files')
@Controller('agents/:agentId/files/proposals')
export class FileProposalController {
  constructor(
    @Inject(forwardRef(() => IAgentGateway))
    private readonly agents: IAgentGateway,
    private readonly proposals: FileProposalService,
  ) {}

  @Get()
  @ApiOperation({
    operationId: 'listAgentFileProposals',
    summary:
      'Proposals raised in a chat, oldest first. `since`/`until` bound the window; pending ones are always included.',
  })
  @ApiOkResponse({ type: [FileChangeProposalDto] })
  async list(
    @Param('agentId') agentId: string,
    @Query() query: ListProposalsQueryDto,
  ): Promise<FileChangeProposalDto[]> {
    await this.assertAgent(agentId);
    const rows = await this.proposals.listForChat(
      query.chatAgentId,
      query.channel ?? 'admin',
      {
        since: query.since ? new Date(query.since) : undefined,
        until: query.until ? new Date(query.until) : undefined,
        includePending: true,
      },
    );
    const views = await this.proposals.toViews(
      rows.filter((r) => r.agentId === agentId),
    );
    return views.map(asDto);
  }

  @Get(':proposalId')
  @ApiOperation({ operationId: 'getAgentFileProposal', summary: 'One proposal.' })
  @ApiOkResponse({ type: FileChangeProposalDto })
  async get(
    @Param('agentId') agentId: string,
    @Param('proposalId') proposalId: string,
  ): Promise<FileChangeProposalDto> {
    const row = await this.owned(agentId, proposalId);
    return asDto(await this.proposals.toView(row));
  }

  // Raw text (no envelope) so the editor can load it as-is.
  @Get(':proposalId/content')
  @ApiOperation({
    operationId: 'getAgentFileProposalContent',
    summary: 'Proposed content of a single-file proposal (Edit before applying).',
  })
  async content(
    @Param('agentId') agentId: string,
    @Param('proposalId') proposalId: string,
    @Res() res: Response,
  ): Promise<void> {
    await this.owned(agentId, proposalId);
    const text = await this.proposals.content(proposalId);
    res.setHeader('Content-Type', 'text/plain; charset=utf-8');
    res.setHeader('Cache-Control', 'private, no-store');
    res.end(text);
  }

  @Get(':proposalId/diff')
  @ApiOperation({
    operationId: 'getAgentFileProposalDiff',
    summary:
      'Full unified diff, computed on demand and capped (413 over the comparison limit). Set proposals need `path`.',
  })
  @ApiResponse({ status: 413, description: 'Over the comparison limit — no diff computed.' })
  async diff(
    @Param('agentId') agentId: string,
    @Param('proposalId') proposalId: string,
    @Query() query: ProposalDiffQueryDto,
    @Res() res: Response,
  ): Promise<void> {
    await this.owned(agentId, proposalId);
    try {
      const text = await this.proposals.diffFor(proposalId, query.path);
      res.setHeader('Content-Type', 'text/x-diff; charset=utf-8');
      res.setHeader('Cache-Control', 'private, no-store');
      res.end(text);
    } catch (err) {
      if (err instanceof PayloadTooLarge) {
        res.status(HttpStatus.PAYLOAD_TOO_LARGE);
        res.setHeader('Content-Type', 'text/plain; charset=utf-8');
        res.end(err.message);
        return;
      }
      throw err;
    }
  }

  @Post(':proposalId/apply')
  @HttpCode(200)
  @ApiOperation({
    operationId: 'applyAgentFileProposal',
    summary:
      'Apply a pending proposal. Answers 409 with the current row when it is no longer pending, or with the removal count when a replace import needs `confirmRemove`.',
  })
  @ApiOkResponse({ type: FileChangeProposalDto })
  @ApiResponse({ status: 409, type: ProposalRemoveConflictDto })
  async apply(
    @Param('agentId') agentId: string,
    @Param('proposalId') proposalId: string,
    @Body() body: ApplyProposalDto,
    @Req() req: AuthedRequest,
  ): Promise<FileChangeProposalDto> {
    await this.owned(agentId, proposalId);
    try {
      const row = await this.proposals.apply(proposalId, {
        actor: actorOf(req),
        via: body.via ?? 'card',
        content: body.content,
        confirmRemove: body.confirmRemove,
      });
      return asDto(await this.proposals.toView(row));
    } catch (err) {
      throw await this.conflict(err);
    }
  }

  @Post(':proposalId/skip')
  @HttpCode(200)
  @ApiOperation({
    operationId: 'skipAgentFileProposal',
    summary: 'Skip a pending proposal; nothing is written.',
  })
  @ApiOkResponse({ type: FileChangeProposalDto })
  async skip(
    @Param('agentId') agentId: string,
    @Param('proposalId') proposalId: string,
    @Req() req: AuthedRequest,
  ): Promise<FileChangeProposalDto> {
    await this.owned(agentId, proposalId);
    try {
      const row = await this.proposals.skip(proposalId, actorOf(req));
      return asDto(await this.proposals.toView(row));
    } catch (err) {
      throw await this.conflict(err);
    }
  }

  private async conflict(err: unknown): Promise<unknown> {
    if (err instanceof ProposalNeedsRemoveConfirmError) {
      return new HttpException(
        { requiresConfirmation: true, remove: err.remove },
        HttpStatus.CONFLICT,
      );
    }
    if (err instanceof ProposalNotPendingError) {
      return new HttpException(
        asDto(await this.proposals.toView(err.row)),
        HttpStatus.CONFLICT,
      );
    }
    return err;
  }

  private async assertAgent(agentId: string): Promise<void> {
    const agent = await this.agents.findById(agentId);
    if (!agent) throw new NotFoundException('Agent not found');
  }

  private async owned(agentId: string, proposalId: string) {
    await this.assertAgent(agentId);
    const row = await this.proposals.get(proposalId);
    if (row.agentId !== agentId) throw new NotFoundException('Proposal not found');
    return row;
  }
}

function actorOf(req: AuthedRequest): string {
  return req.user?.sub ?? 'operator';
}

function asDto(view: IProposalView): FileChangeProposalDto {
  return {
    ...view,
    summary: view.summary as unknown as FileChangeProposalDto['summary'],
    result: view.result as unknown as FileChangeProposalDto['result'],
  };
}
