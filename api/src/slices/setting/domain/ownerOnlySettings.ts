/**
 * Setting groups only the Owner writes (CLEAN-271).
 *
 * `rancher` holds the bookkeeping of the Ranch assistant's template: the
 * hash of the source it was last seeded from (`rancher.seeded_hash`,
 * `RancherService.syncTemplateIfChanged`). Whoever rewrites or deletes that
 * row makes the next API start wipe the template's files and seed them
 * again from the image, over whatever the Owner had put there. That is a
 * change to what the assistant is built from, made without touching the
 * template, so the group is the Owner's. No console page offers it and
 * nothing else lives in it.
 *
 * The groups that shape every agent's pod (`integrations`, `infrastructure`,
 * `agent_defaults`) are deliberately NOT here: they are the Settings area
 * an Admin runs the installation from. See "What the assistant is built
 * from" in docs/agent-tools.md for what that leaves open.
 */
export const OWNER_ONLY_SETTING_GROUPS: readonly string[] = ['rancher'];

export function isOwnerOnlySettingGroup(group: unknown): boolean {
  return (
    typeof group === 'string' &&
    OWNER_ONLY_SETTING_GROUPS.includes(group.trim().toLowerCase())
  );
}

/** What a tool and a route answer for a write to such a group. */
export const OWNER_ONLY_SETTING_TEXT =
  'The «rancher» settings keep the Ranch assistant’s template in step with ' +
  'its source: they are part of what the assistant is built from. Only the ' +
  'Owner can change them.';

/** What a route answers in `code`. */
export const OWNER_ONLY_SETTING_CODE = 'ASSISTANT_BUILT_FROM';
