<template>
  <!-- The share page is not part of the console: no `LayoutProvider`, no nav,
       no user menu, no link back into the app (FR-009). Full viewport, and
       `overflow-hidden` so the page itself never scrolls — the conversation
       scrolls inside the chat, which is what keeps a phone from panning
       sideways.

       `h-dvh`, not `h-screen`: on a phone `100vh` is the viewport with the
       browser chrome *hidden*, so an `overflow-hidden` column that tall puts
       its last row — the composer — under the address bar, out of reach, with
       no way to scroll to it. The dynamic unit shrinks with the chrome, so the
       composer stays on screen at 375px.

       `w-full`, not `w-screen`: `100vw` counts the classic scrollbar gutter and
       so is a few pixels wider than the content box, which is exactly the
       horizontal body scroll this layout exists to prevent. -->
  <div class="h-dvh w-full overflow-hidden bg-background text-foreground">
    <slot />
  </div>
</template>
