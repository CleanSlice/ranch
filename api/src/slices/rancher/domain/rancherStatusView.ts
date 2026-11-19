import type { IAgentData } from '#/agent/agent/domain';
import { toReaderView } from '#/agent/agent/domain/agentReaderView';
import type { ITemplateData } from '#/agent/template/domain';
import type { IRancherStatus } from './rancher.types';

/** The Ranch admin agent as a response carries it: never the bare creator id. */
export type IRancherAdminView = Omit<IAgentData, 'createdById'>;

/**
 * The setup state as one caller gets it (CLEAN-231).
 *
 * `hasAdmin` says whether a Ranch admin agent exists, which is all the
 * stepper needs and identifies nothing. `admin` is the agent itself, under
 * the rules every other route to it follows:
 *
 *  - null for a caller whose access lists do not reach it: no id, no name;
 *  - its reader view for a caller who reaches it and may not manage it (an
 *    Admin): the name and status the page draws, no config, no credential;
 *  - the whole row for a caller who may manage it (the Owner).
 */
export interface IRancherStatusView {
  hasLlm: boolean;
  hasS3: boolean;
  template: ITemplateData | null;
  hasAdmin: boolean;
  admin: IRancherAdminView | null;
}

/**
 * `GET /rancher/status` and `get_rancher_status` used to hand the whole
 * Ranch admin agent row to any Admin, also to one for whom
 * `GET /agents/admin/current` and `GET /agents/:id` answer 404: the agent
 * was addressed by its flag, not by an id, so no marker covered it. This is
 * the one place that decides what of it a caller of the status gets.
 */
export function rancherStatusFor(
  status: IRancherStatus,
  caller: { reaches: boolean; manages: boolean },
): IRancherStatusView {
  const agent = status.admin;
  let admin: IRancherAdminView | null = null;
  if (agent && caller.reaches) {
    const { createdById: _createdById, ...view } = caller.manages
      ? agent
      : toReaderView(agent);
    admin = view;
  }
  return {
    hasLlm: status.hasLlm,
    hasS3: status.hasS3,
    template: status.template,
    hasAdmin: agent !== null,
    admin,
  };
}
