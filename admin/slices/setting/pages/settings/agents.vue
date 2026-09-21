<script setup lang="ts">
const resourceFields = [
  { group: 'agent_defaults', name: 'cpu', label: 'CPU', placeholder: '500m' },
  { group: 'agent_defaults', name: 'memory', label: 'Memory', placeholder: '512Mi' },
];

// The kill switch for CLEAN-105. Off means an agent asked in the chat to
// connect a colleague answers that it cannot, and the operator does it here
// or through the operator agent.
const a2aFields = [
  {
    group: 'a2a',
    name: 'agentSelfService',
    label: 'Agents may connect their own peers',
    type: 'toggle' as const,
    description:
      'On, an agent asked in the chat to connect another agent — by name, or ' +
      'by a pasted agent-card address — does it itself, for itself only. It ' +
      'can never change another agent’s peers, and every address still ' +
      'goes through the same checks as the console. Off, only operators and ' +
      'operator agents connect peers.',
  },
];
</script>

<template>
  <div class="flex flex-col gap-8">
    <SettingForm
      title="Default agent resources"
      description="Applied when a template does not specify its own."
      :fields="resourceFields"
    />
    <SettingForm
      title="Agent-to-agent"
      description="What agents may do about their own colleagues."
      :fields="a2aFields"
    />
  </div>
</template>
