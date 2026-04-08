<template>
  <div class="min-h-screen bg-background">
    <nav class="border-b">
      <div class="container mx-auto flex items-center h-14 px-4">
        <NuxtLink to="/" class="font-bold text-lg mr-8">Ranch</NuxtLink>
        <div class="flex gap-4">
          <NuxtLink to="/agents" class="text-sm hover:text-primary">Agents</NuxtLink>
          <NuxtLink to="/templates" class="text-sm hover:text-primary">Templates</NuxtLink>
        </div>
      </div>
    </nav>
    <main class="container mx-auto px-4 py-6">
      <slot />
    </main>
  </div>
</template>
