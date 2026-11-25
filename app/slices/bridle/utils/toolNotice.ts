/**
 * What the chat says about an agent's tool servers to someone who only talks
 * to it (CLEAN-245): a signed-in User, a share visitor, a visitor on the
 * landing page. The hub's word is all it has — `connecting` or `limited` —
 * and it names nothing, because nothing is named to this reader.
 *
 * Whoever may manage the agent is given the host's own wording instead
 * (`#agent/utils/toolState`), which the chat only renders.
 *
 * Twin of the wording in `admin/slices/bridle/components/bridle/Provider.vue`,
 * which serves managers only.
 */
export type ToolSummaryTypes = "connecting" | "limited";

export interface IToolNotice {
  kind: ToolSummaryTypes;
  /** i18n key of the line. */
  key: string;
}

export function toolSummary(raw: unknown): ToolSummaryTypes | null {
  return raw === "connecting" || raw === "limited" ? raw : null;
}

export function toolNotice(
  summary: ToolSummaryTypes | null | undefined,
): IToolNotice | null {
  if (summary === "connecting")
    return { kind: summary, key: "chat.tools_starting" };
  if (summary === "limited")
    return { kind: summary, key: "chat.tools_limited" };
  return null;
}
