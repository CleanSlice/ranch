## Summary

<!-- What changed and why, in a few sentences. -->

**Ticket:** [CLEAN-](https://dreamvention.atlassian.net/browse/CLEAN-)

## Test plan

<!-- How you verified it: commands run, screens checked, prompts sent to the Rancher chat. -->

## Checklist

- [ ] Jira issue linked above; commits carry the `CLEAN-<n>` id
- [ ] Console capability added or changed → agent tool added or changed, with a spec (`docs/agent-tools.md`)
- [ ] Destructive tools take `confirm`; no secret is echoed in any tool result
- [ ] User-visible `app` strings went through `en.json` (`docs/i18n.md`); `admin` stays English-only
- [ ] Client state follows `docs/state.md` (one entity, one store, render by id)
