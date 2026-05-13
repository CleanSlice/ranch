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
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from '#theme/components/ui/dropdown-menu';
import { Button } from '#theme/components/ui/button';
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
  IconUserCircle,
  IconExternalLink,
} from '@tabler/icons-vue';
import { Bot, FlaskConical, KeyRound } from 'lucide-vue-next';

const authStore = useAuthStore();
const ranchVersion = useRuntimeConfig().public.ranchVersion;
const update = useRanchUpdate();
const upgradeDialogOpen = ref(false);
onMounted(() => {
  void update.check();
});

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
  KeyRound,
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
          <DropdownMenu>
            <DropdownMenuTrigger as-child>
              <SidebarMenuButton size="lg" class="cursor-pointer" :tooltip="authStore.user.name ?? authStore.user.email">
                <div class="flex aspect-square size-8 items-center justify-center rounded-lg bg-muted text-muted-foreground text-xs font-semibold">
                  {{ (authStore.user.name ?? '?').charAt(0).toUpperCase() }}
                </div>
                <div class="flex flex-col">
                  <span class="truncate text-sm font-medium">{{ authStore.user.name }}</span>
                  <span class="truncate text-xs text-muted-foreground">{{ authStore.user.email }}</span>
                </div>
              </SidebarMenuButton>
            </DropdownMenuTrigger>
            <DropdownMenuContent
              side="right"
              align="end"
              class="min-w-56 rounded-lg"
            >
              <DropdownMenuLabel class="p-0 font-normal">
                <div class="flex items-center gap-2 px-1 py-1.5 text-left text-sm">
                  <div class="flex aspect-square size-8 items-center justify-center rounded-lg bg-muted text-muted-foreground text-xs font-semibold">
                    {{ (authStore.user.name ?? '?').charAt(0).toUpperCase() }}
                  </div>
                  <div class="grid flex-1 text-left text-sm leading-tight">
                    <span class="truncate font-medium">{{ authStore.user.name }}</span>
                    <span class="truncate text-xs text-muted-foreground">{{ authStore.user.email }}</span>
                  </div>
                </div>
              </DropdownMenuLabel>
              <DropdownMenuItem as-child class="cursor-pointer">
                <NuxtLink :to="`/users/${authStore.user.id}`">
                  <IconUserCircle />
                  Account
                </NuxtLink>
              </DropdownMenuItem>
              <DropdownMenuItem class="cursor-pointer" @select="onLogout">
                <IconLogout />
                Sign out
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </SidebarMenuItem>
      </SidebarMenu>
      <div class="flex items-center justify-between gap-2 px-3 pb-1 pt-2 text-[11px] text-muted-foreground group-has-data-[collapsible=icon]/sidebar-wrapper:hidden">
        <span class="truncate">Ranch v{{ ranchVersion }}</span>
        <Button
          v-if="update.state.value.hasUpdate && update.state.value.latest && update.state.value.releaseUrl"
          size="sm"
          variant="default"
          class="h-6 gap-1 px-2 text-[11px] font-medium"
          :title="`Update to v${update.state.value.latest}`"
          @click="upgradeDialogOpen = true"
        >
          Update v{{ update.state.value.latest }}
          <IconExternalLink class="size-3" />
        </Button>
      </div>
    </SidebarFooter>
    <SidebarRail />
  </Sidebar>

  <UpdateDialog
    v-if="update.state.value.latest && update.state.value.releaseUrl"
    v-model:open="upgradeDialogOpen"
    :current-version="update.state.value.current"
    :latest-version="update.state.value.latest"
    :release-url="update.state.value.releaseUrl"
  />
</template>
