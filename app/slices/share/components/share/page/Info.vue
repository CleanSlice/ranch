<script setup lang="ts">
/**
 * What a share visitor may know about the agent they are talking to
 * (CLEAN-237): the header's info button and the panel it opens from the right.
 *
 * Everything here comes from the one `resolved` object the page already
 * holds, and that object is an allowlist the API builds field by field. The
 * panel adds nothing of its own and asks the API nothing: it follows the
 * page's 30-second re-resolve, so an edited description arrives by itself.
 *
 * A section with nothing to say is not drawn. Status and the privacy note
 * are always there, so the panel is never empty.
 */
import type { IShareResolved } from '#share/domain';
import {
  shareKindKey,
  shareLimitRows,
  shareStatusKey,
} from '#share/utils/shareInfo';

const props = defineProps<{ resolved: IShareResolved }>();

const format = useFormat();

const open = ref(false);

const statusKey = computed(() => shareStatusKey(props.resolved.agentStatus));
const statusDot = computed(() => {
  switch (statusKey.value) {
    case 'share.info.status_online':
      return 'bg-emerald-500';
    case 'share.info.status_starting':
      return 'bg-amber-500';
    default:
      return 'bg-muted-foreground';
  }
});

const limitRows = computed(() => shareLimitRows(props.resolved.limits));
const attachments = computed(() => props.resolved.attachments);
</script>

<template>
  <Sheet v-model:open="open">
    <SheetTrigger as-child>
      <button
        type="button"
        class="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-full border bg-background text-foreground transition hover:bg-muted"
        :aria-label="$t('share.page.info_open')"
        :title="$t('share.page.info_open')"
      >
        <Icon name="book-open" :size="14" />
      </button>
    </SheetTrigger>

    <!-- Full width on a phone, a narrow column beside the chat otherwise.
         No description element: the title says what this is. -->
    <SheetContent
      side="right"
      class="w-full gap-0 sm:max-w-sm"
      :close-label="$t('share.info.close')"
      :aria-describedby="undefined"
    >
      <SheetHeader class="shrink-0 border-b px-5 py-4 pr-12">
        <SheetTitle class="text-sm">{{ $t('share.info.title') }}</SheetTitle>
      </SheetHeader>

      <div class="flex min-h-0 flex-1 flex-col gap-5 overflow-y-auto px-5 py-4 text-sm">
        <section>
          <h3 class="break-words text-base font-semibold leading-snug">
            {{ resolved.agentName }}
          </h3>
          <p class="mt-1 flex items-center gap-1.5 text-xs text-muted-foreground">
            <span
              class="inline-flex h-1.5 w-1.5 shrink-0 rounded-full"
              :class="statusDot"
              aria-hidden="true"
            />
            {{ $t(statusKey) }}
          </p>
          <!-- The owner's own words, shown as written: plain text, line
               breaks kept, never markup. -->
          <p
            v-if="resolved.description"
            class="mt-3 whitespace-pre-line break-words leading-relaxed text-foreground/90"
          >
            {{ resolved.description }}
          </p>
        </section>

        <section v-if="resolved.skills.length">
          <h4 class="text-xs font-medium text-muted-foreground">
            {{ $t('share.info.skills') }}
          </h4>
          <ul class="mt-2 flex flex-col gap-2">
            <li v-for="(skill, index) in resolved.skills" :key="index">
              <p class="break-words font-medium leading-snug">{{ skill.title }}</p>
              <p
                v-if="skill.description"
                class="mt-0.5 break-words text-xs leading-snug text-muted-foreground"
              >
                {{ skill.description }}
              </p>
            </li>
          </ul>
        </section>

        <section v-if="limitRows.length">
          <h4 class="text-xs font-medium text-muted-foreground">
            {{ $t('share.info.limits') }}
          </h4>
          <dl class="mt-2 overflow-hidden rounded-md border">
            <div
              v-for="row in limitRows"
              :key="row.labelKey"
              class="flex items-baseline justify-between gap-3 border-b px-3 py-1.5 last:border-b-0"
            >
              <dt>{{ $t(row.labelKey) }}</dt>
              <dd class="font-medium tabular-nums">{{ format.number(row.count) }}</dd>
            </div>
          </dl>
          <!-- Always with the numbers: the allowance is one per agent, and a
               bare "100 a day" reads as a personal remainder. -->
          <p class="mt-2 text-xs leading-snug text-muted-foreground">
            {{ $t('share.info.limits_shared') }}
          </p>
        </section>

        <section v-if="attachments">
          <h4 class="text-xs font-medium text-muted-foreground">
            {{ $t('share.info.attachments') }}
          </h4>
          <p class="mt-2 leading-snug">
            {{
              $t(
                'share.info.attachments_count',
                { count: format.number(attachments.maxPerMessage) },
                attachments.maxPerMessage,
              )
            }}
          </p>
          <p class="mt-0.5 text-xs leading-snug text-muted-foreground">
            {{
              $t('share.info.attachments_size', {
                file: format.size(attachments.maxFileBytes),
                message: format.size(attachments.maxMessageBytes),
              })
            }}
          </p>
          <ul v-if="attachments.kinds.length" class="mt-2 flex flex-wrap gap-1.5">
            <li
              v-for="kind in attachments.kinds"
              :key="kind"
              class="rounded-full border bg-muted/40 px-2 py-0.5 text-xs text-muted-foreground"
            >
              {{ $t(shareKindKey(kind)) }}
            </li>
          </ul>
        </section>

        <p class="mt-auto border-t pt-4 text-xs leading-snug text-muted-foreground">
          {{ $t('share.info.privacy') }}
        </p>
      </div>
    </SheetContent>
  </Sheet>
</template>
