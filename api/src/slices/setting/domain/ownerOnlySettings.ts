/**
 * Settings only the Owner writes (CLEAN-271).
 *
 * The `rancher` group holds the bookkeeping of the Ranch assistant's
 * template: the hash of the source it was last seeded from
 * (`rancher.seeded_hash`, `RancherService.syncTemplateIfChanged`). Whoever
 * rewrites or deletes that row makes the next API start wipe the template's
 * files and seed them again from the image, over whatever the Owner had put
 * there. That is a change to what the assistant is built from, made without
 * touching the template, so the group is the Owner's. No console page offers
 * it and nothing else lives in it.
 *
 * `agent_defaults.image` is read in one place: `RancherService.ensureTemplate`
 * takes it as the image of the Rancher template when the Owner generates
 * that template. Whoever sets it beforehand chooses the code the assistant
 * will run. Nothing else reads the key (an ordinary template names its own
 * image), so it is the Owner's too.
 *
 * The groups that shape every agent's pod (`integrations`, `infrastructure`)
 * are deliberately NOT here: they are the Settings area an Admin runs the
 * installation from. See "What the assistant is built from" in
 * docs/agent-tools.md for what that leaves open.
 */
export const OWNER_ONLY_SETTING_GROUPS: readonly string[] = ['rancher'];

/** Single keys, `group.name`, outside those groups. */
export const OWNER_ONLY_SETTING_KEYS: readonly string[] = [
  'agent_defaults.image',
];

const tidy = (value: unknown): string =>
  typeof value === 'string' ? value.trim().toLowerCase() : '';

export function isOwnerOnlySettingGroup(group: unknown): boolean {
  return OWNER_ONLY_SETTING_GROUPS.includes(tidy(group));
}

/** What a tool and a route answer for a write to the `rancher` group. */
export const OWNER_ONLY_SETTING_TEXT =
  'The «rancher» settings keep the Ranch assistant’s template in step with ' +
  'its source: they are part of what the assistant is built from. Only the ' +
  'Owner can change them.';

/** What they answer for a single key that is the Owner's. */
export const OWNER_ONLY_SETTING_KEY_TEXT = (key: string): string =>
  `«${key}» decides what the Ranch assistant is built from. Only the Owner ` +
  'can change it.';

/**
 * The refusal for a write to `group.name` by anybody but the Owner; null
 * when the setting is an Admin's to write as before.
 */
export function ownerOnlySettingRefusal(
  group: unknown,
  name: unknown,
): string | null {
  if (isOwnerOnlySettingGroup(group)) return OWNER_ONLY_SETTING_TEXT;
  const key = `${tidy(group)}.${tidy(name)}`;
  return OWNER_ONLY_SETTING_KEYS.includes(key)
    ? OWNER_ONLY_SETTING_KEY_TEXT(key)
    : null;
}

/** What a route answers in `code`. */
export const OWNER_ONLY_SETTING_CODE = 'ASSISTANT_BUILT_FROM';
