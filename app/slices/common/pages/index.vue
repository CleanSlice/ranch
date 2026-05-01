<template>
  <div class="-mx-4 -my-6">
    <LandingHeroProvider />

    <section class="container mx-auto px-4 py-20 border-t">
      <div class="max-w-2xl mb-12">
        <div class="text-sm font-medium text-primary mb-3">
          What Ranch does
        </div>
        <h2 class="text-3xl sm:text-4xl font-bold tracking-tight">
          Infrastructure for AI agents, built on Kubernetes
        </h2>
        <p class="mt-4 text-muted-foreground">
          From image to running pod to live chat — Ranch handles the plumbing
          so you can focus on what your agents should actually do.
        </p>
      </div>

      <div class="grid md:grid-cols-2 lg:grid-cols-3 gap-6">
        <div
          v-for="feature in features"
          :key="feature.title"
          class="rounded-xl border p-6 hover:border-primary transition-colors"
        >
          <div
            class="w-10 h-10 rounded-lg bg-primary/10 text-primary flex items-center justify-center mb-4"
          >
            <Icon :name="feature.icon" :size="20" />
          </div>
          <h3 class="font-semibold mb-2">{{ feature.title }}</h3>
          <p class="text-sm text-muted-foreground">{{ feature.body }}</p>
        </div>
      </div>
    </section>

    <section class="bg-muted/30 border-y">
      <div class="container mx-auto px-4 py-20">
        <div class="max-w-2xl mb-12">
          <div class="text-sm font-medium text-primary mb-3">How it works</div>
          <h2 class="text-3xl sm:text-4xl font-bold tracking-tight">
            From template to conversation in three steps
          </h2>
        </div>

        <ol class="grid md:grid-cols-3 gap-6">
          <li
            v-for="(step, idx) in steps"
            :key="step.title"
            class="rounded-xl border bg-background p-6"
          >
            <div class="text-xs text-muted-foreground mb-2">
              Step {{ idx + 1 }}
            </div>
            <h3 class="font-semibold mb-2">{{ step.title }}</h3>
            <p class="text-sm text-muted-foreground">{{ step.body }}</p>
          </li>
        </ol>
      </div>
    </section>

    <section class="container mx-auto px-4 py-20">
      <div
        class="rounded-2xl border bg-gradient-to-br from-primary/10 to-transparent p-10 text-center"
      >
        <h2 class="text-3xl sm:text-4xl font-bold tracking-tight">
          Your herd is waiting.
        </h2>
        <p class="mt-3 text-muted-foreground max-w-lg mx-auto">
          Jump into the dashboard, pick an agent, and start a conversation.
        </p>
        <NuxtLink
          to="/agents"
          class="mt-8 inline-flex items-center justify-center rounded-md bg-primary text-primary-foreground px-6 py-3 text-sm font-medium hover:opacity-90 transition"
        >
          Open the dashboard →
        </NuxtLink>
      </div>
    </section>
  </div>
</template>

<script setup lang="ts">
const features = [
  {
    icon: 'package',
    title: 'One-click agent templates',
    body: 'Pick a Docker image, pin CPU/memory, and Ranch submits an Argo Workflow that rolls out your agent pod.',
  },
  {
    icon: 'message-square',
    title: 'Live chat over WebSocket',
    body: 'Every running agent is reachable through a JWT-auth Socket.IO gateway with streaming responses.',
  },
  {
    icon: 'activity',
    title: 'Status & lifecycle',
    body: 'Deploying, running, failed, stopped — Ranch tracks the workflow phase and surfaces it in the UI.',
  },
  {
    icon: 'refresh-cw',
    title: 'Restart without redeploy',
    body: 'Cancel the workflow, flip the image tag, and restart — Ranch keeps the agent record intact.',
  },
  {
    icon: 'scroll-text',
    title: 'Log streaming',
    body: 'Tail agent logs straight from the pod without jumping into kubectl.',
  },
  {
    icon: 'users',
    title: 'Multi-tenant admin',
    body: 'An admin surface to manage templates, users, quotas, and the whole fleet across the cluster.',
  },
];

const steps = [
  {
    title: 'Pick a template',
    body: 'Browse ready-made agent images or register your own. Templates carry default resources and config.',
  },
  {
    title: 'Deploy the agent',
    body: 'Ranch submits an Argo Workflow to your k3s cluster. You get a status stream back in the dashboard.',
  },
  {
    title: 'Start the conversation',
    body: 'The agent connects to the bridle hub. Open the chat, send a message, watch it stream back.',
  },
];
</script>
