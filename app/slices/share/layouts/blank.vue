<template>
  <!-- The share page is not part of the console: no `LayoutProvider`, no nav,
       no user menu, no link back into the app (FR-009). Full viewport, and
       `overflow-hidden` so the page itself never scrolls — the conversation
       scrolls inside the chat, which is what keeps a phone from panning
       sideways. -->
  <div class="h-screen w-screen overflow-hidden bg-background text-foreground">
    <slot />
  </div>
</template>
