<script setup lang="ts">
import { MenuGroupTypes, useMenuStore } from '#common/stores/menu';
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarRail,
} from '#theme/components/ui/sidebar';
import {
  IconTractor,
  IconTemplate,
  IconUsers,
  IconBrain,
  IconSparkles,
  IconSettings,
  IconLogout,
  IconDatabase,
  IconShield,
  IconPlug,
} from '@tabler/icons-vue';
import { Bot, FlaskConical } from 'lucide-vue-next';

const authStore = useAuthStore();
const ranchVersion = useRuntimeConfig().public.ranchVersion;

async function onLogout() {
  authStore.logout();
  await navigateTo('/login');
}

const menu = useMenuStore();

const iconMap: Record<string, unknown> = {
  Bot,
  LayoutTemplate: IconTemplate,
  Template: IconTemplate,
  Users: IconUsers,
  Brain: IconBrain,
  Sparkles: IconSparkles,
  Settings: IconSettings,
  Database: IconDatabase,
  Shield: IconShield,
  Plug: IconPlug,
  FlaskConical,
};

const groups = [
  { key: MenuGroupTypes.Main, label: 'Workspace' },
  { key: MenuGroupTypes.Admin, label: 'Admin' },
];

const itemsByGroup = (group: MenuGroupTypes) =>
  menu.getSidebar.filter((item) => item.group === group);
</script>

<template>
  <Sidebar collapsible="icon" variant="inset">
    <SidebarHeader>
      <SidebarMenu>
        <SidebarMenuItem>
          <SidebarMenuButton as-child size="lg">
            <NuxtLink to="/rancher">
              <div
                class="flex aspect-square size-8 items-center justify-center rounded-lg bg-primary text-primary-foreground"
              >
                <IconTractor class="size-4 p-0" />
              </div>
              <div class="flex flex-col">
                <span class="font-semibold text-sm">Ranch</span>
                <span class="text-xs text-muted-foreground">Admin</span>
              </div>
            </NuxtLink>
          </SidebarMenuButton>
        </SidebarMenuItem>
      </SidebarMenu>
    </SidebarHeader>

    <SidebarContent>
      <SidebarGroup v-for="group in groups" :key="group.key">
        <SidebarGroupLabel>{{ group.label }}</SidebarGroupLabel>
        <SidebarGroupContent>
          <SidebarMenu>
            <SidebarMenuItem
              v-for="item in itemsByGroup(group.key)"
              :key="item.id"
            >
              <SidebarMenuButton
                as-child
                :is-active="item.active"
                :tooltip="item.title"
              >
                <NuxtLink :to="{ name: item.link }">
                  <component
                    :is="iconMap[item.icon]"
                    v-if="iconMap[item.icon]"
                  />
                  <span>{{ item.title }}</span>
                </NuxtLink>
              </SidebarMenuButton>
            </SidebarMenuItem>
          </SidebarMenu>
        </SidebarGroupContent>
      </SidebarGroup>
    </SidebarContent>

    <SidebarFooter>
      <SidebarMenu>
        <SidebarMenuItem v-if="authStore.user">
          <SidebarMenuButton size="lg" class="pointer-events-none">
            <div class="flex aspect-square size-8 items-center justify-center rounded-lg bg-muted text-muted-foreground text-xs font-semibold">
              {{ (authStore.user.name ?? '?').charAt(0).toUpperCase() }}
            </div>
            <div class="flex flex-col">
              <span class="truncate text-sm font-medium">{{ authStore.user.name }}</span>
              <span class="truncate text-xs text-muted-foreground">{{ authStore.user.email }}</span>
            </div>
          </SidebarMenuButton>
        </SidebarMenuItem>
        <SidebarMenuItem>
          <SidebarMenuButton tooltip="Sign out" @click="onLogout">
            <IconLogout />
            <span>Sign out</span>
          </SidebarMenuButton>
        </SidebarMenuItem>
      </SidebarMenu>
      <div class="px-3 pb-1 pt-2 text-[11px] text-muted-foreground group-has-data-[collapsible=icon]/sidebar-wrapper:hidden">
        Ranch v{{ ranchVersion }}
      </div>
    </SidebarFooter>
    <SidebarRail />
  </Sidebar>
</template>
