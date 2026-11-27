import {
  CanActivate,
  ExecutionContext,
  Injectable,
  SetMetadata,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';
import type { AssistantIngredientTypes } from '#/mcp/interfaces/assistant-build.interface';
import type { IAuthTokenPayload } from '#/user/auth/domain/auth.types';
import { PUBLIC_METADATA_KEY } from '#/user/auth/guards/public.decorator';
import { AssistantBuildService } from '../domain/assistantBuild.service';

export const CHANGES_ASSISTANT_INGREDIENT_KEY = 'changesAssistantIngredient';

export interface IChangesAssistantIngredient {
  kind: AssistantIngredientTypes;
  /** The route parameter the resource's id travels in. */
  param: string;
}

/**
 * Marks a route as a WRITE to one resource of a kind the Ranch assistant
 * may be built from, named by a route parameter (CLEAN-271): a template, a
 * skill, a tool server, a model credential, a knowledge base. The role on
 * the route says what kind of account may call it; this says that for a
 * resource the assistant is built from, only the Owner may.
 *
 * `AssistantBuildGuard` reads it and answers 403 with
 * `code: "ASSISTANT_BUILT_FROM"`. Not a 404: an Admin reads these resources,
 * so "not found" would be a lie about a thing they are looking at. The
 * consoles show such a resource read-only instead of offering the write
 * (`assistantDependency` on the row).
 *
 * A reading route does not carry it. A route that writes and names its
 * resource somewhere else (a body, a manifest, a name) calls
 * `AssistantBuildService.assertMayChange` in its method.
 * `assistantBuildRoutes.spec.ts` reads every non-GET route of the five
 * slices and fails until each is one of the two, or exempt with a reason.
 */
export const ChangesAssistantIngredient = (
  kind: AssistantIngredientTypes,
  param: string,
) =>
  SetMetadata(CHANGES_ASSISTANT_INGREDIENT_KEY, {
    kind,
    param,
  } satisfies IChangesAssistantIngredient);

/**
 * Registered once, as a global guard after the role guard (app.module.ts).
 * A route with no marker is none of its business; neither is the Owner.
 */
@Injectable()
export class AssistantBuildGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly build: AssistantBuildService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const targets = [context.getHandler(), context.getClass()];
    const marker = this.reflector.getAllAndOverride<
      IChangesAssistantIngredient | undefined
    >(CHANGES_ASSISTANT_INGREDIENT_KEY, targets);
    if (!marker) return true;
    if (
      this.reflector.getAllAndOverride<boolean>(PUBLIC_METADATA_KEY, targets)
    ) {
      return true;
    }
    const req = context
      .switchToHttp()
      .getRequest<Request & { user?: IAuthTokenPayload }>();
    const raw: unknown = (req?.params as Record<string, unknown> | undefined)?.[
      marker.param
    ];
    await this.build.assertMayChange(
      req?.user,
      marker.kind,
      typeof raw === 'string' ? raw : null,
    );
    return true;
  }
}
