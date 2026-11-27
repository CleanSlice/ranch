<script setup lang="ts">
import {
  ORBIT_CENTER,
  ORBIT_RINGS,
  ORBIT_SIZE,
  orbitLayout,
} from '#profile/utils/orbitLayout';

/**
 * The orbit of "Who you talk to" (CLEAN-258): the person in the middle, the
 * agent written to most on the inner ring. Where a node sits and how large
 * it is come from `orbitLayout()`; this draws them.
 *
 * The agents arrive in the order of the list beside it and are not sorted
 * here, so the two cannot disagree on a tie. A node is a button: it takes
 * focus, is named "Name: N messages", shows its detail on hover and focus,
 * and selects its agent in the list.
 *
 * The rings, the lines and the person are one SVG; the nodes are HTML buttons
 * laid over it at the same coordinates, as shares of the 240 box. Not `<g>`
 * elements inside the SVG, as in the prototype: a pop-up that Vue teleports
 * out of an SVG is still built as SVG, and a `<div>` built that way is never
 * drawn. A real button also brings Enter and Space with it.
 */
const props = defineProps<{
  /** In the API's order: by the person's messages, most first. */
  agents: readonly {
    id: string;
    name: string;
    initials: string;
    messages: number;
    conversations: number;
    /** Of the person's messages in the period, 0 to 1. */
    share: number;
  }[];
  selectedId: string | null;
  /** The signed-in person's, as the pass shows them. */
  initials: string;
}>();

const emit = defineEmits<{ select: [id: string] }>();

const format = useFormat();
// Two orbits on one page would otherwise share one gradient id.
const gradientId = useId();

/**
 * From the prototype: the radius of the person's circle, and the node size up
 * to which the initials are set smaller to fit inside.
 */
const ME_RADIUS = 24;
const SMALL_NODE_UP_TO = 24;

/** A length of the 240 box as a share of the drawing's width. */
const share = (units: number) => `${(100 * units) / ORBIT_SIZE}%`;

const nodes = computed(() => {
  const layout = orbitLayout(
    props.agents.map((agent) => ({ id: agent.id, messages: agent.messages })),
  );
  return layout.flatMap((node, index) => {
    const agent = props.agents[index];
    if (!agent) return [];
    return [
      {
        ...node,
        agent,
        selected: agent.id === props.selectedId,
        small: node.size <= SMALL_NODE_UP_TO,
        box: {
          left: share(node.x - node.size / 2),
          top: share(node.y - node.size / 2),
          width: share(node.size),
          height: share(node.size),
        },
      },
    ];
  });
});
</script>

<template>
  <div
    class="stats-orbit"
    role="group"
    :aria-label="$t('stats.agents.orbit_label')"
    data-stats-orbit
  >
    <svg
      class="stats-orbit__drawing"
      :viewBox="`0 0 ${ORBIT_SIZE} ${ORBIT_SIZE}`"
      aria-hidden="true"
    >
      <defs>
        <linearGradient :id="gradientId" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stop-color="#f5a16b" />
          <stop offset="1" stop-color="#c9a1e4" />
        </linearGradient>
      </defs>
      <circle
        v-for="radius in ORBIT_RINGS"
        :key="radius"
        class="stats-orbit__ring"
        :cx="ORBIT_CENTER"
        :cy="ORBIT_CENTER"
        :r="radius"
      />
      <circle
        class="stats-orbit__me"
        :cx="ORBIT_CENTER"
        :cy="ORBIT_CENTER"
        :r="ME_RADIUS"
        :stroke="`url(#${gradientId})`"
      />
      <text
        class="stats-orbit__text"
        :x="ORBIT_CENTER"
        :y="ORBIT_CENTER + 5"
        text-anchor="middle"
        font-size="14"
      >
        {{ initials }}
      </text>
      <line
        v-for="node in nodes"
        :key="node.id"
        class="stats-orbit__link"
        :class="node.selected && 'stats-orbit__link--sel'"
        :x1="ORBIT_CENTER"
        :y1="ORBIT_CENTER"
        :x2="node.x"
        :y2="node.y"
      />
    </svg>

    <ProfileStatsTip v-for="node in nodes" :key="node.id">
      <button
        type="button"
        class="stats-orbit__node"
        :class="{
          'stats-orbit__node--sel': node.selected,
          'stats-orbit__node--small': node.small,
        }"
        :style="node.box"
        :aria-label="
          $t(
            'stats.agents.node_label',
            { name: node.agent.name, count: format.number(node.agent.messages) },
            node.agent.messages,
          )
        "
        :aria-pressed="node.selected"
        :data-agent="node.id"
        @click="emit('select', node.id)"
      >
        <span aria-hidden="true">{{ node.agent.initials }}</span>
      </button>
      <template #tip>
        <b>{{ node.agent.name }}</b>
        <br />
        {{
          $t(
            'stats.agents.conversations',
            { count: format.number(node.agent.conversations) },
            node.agent.conversations,
          )
        }}
        ·
        {{
          $t(
            'stats.agents.messages_count',
            { count: format.number(node.agent.messages) },
            node.agent.messages,
          )
        }}
        · {{ format.percent(node.agent.share) }}
      </template>
    </ProfileStatsTip>
  </div>
</template>
