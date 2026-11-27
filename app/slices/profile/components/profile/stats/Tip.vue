<script setup lang="ts">
import { TooltipContent, TooltipPortal, TooltipRoot, TooltipTrigger } from 'reka-ui';

/**
 * The detail of one mark: a day, a bar, an agent (CLEAN-258). It opens when
 * the pointer is over the mark and when the mark has keyboard focus, and
 * closes on Escape; what a pointer can read, a keyboard can.
 *
 * The default slot is the mark itself, one element. It must be able to take
 * focus (a button, or `tabindex="0"`): this adds the pop-up, not the tab
 * stop. The `tip` slot is what the pop-up says.
 *
 * The pop-up is drawn at the end of <body>, so that no scrolling block can
 * cut it; its look is `[data-profile-stats-tip]` in `assets/stats.css`.
 *
 * Needs a `TooltipProvider` above it; `stats/Provider.vue` has the one for
 * the tab. A touch does not open it, which is why every chart also has its
 * numbers in words or in a table.
 */
</script>

<template>
  <TooltipRoot>
    <TooltipTrigger as-child>
      <slot />
    </TooltipTrigger>
    <TooltipPortal>
      <TooltipContent
        side="top"
        :side-offset="8"
        :collision-padding="8"
        data-profile-stats-tip
      >
        <slot name="tip" />
      </TooltipContent>
    </TooltipPortal>
  </TooltipRoot>
</template>
