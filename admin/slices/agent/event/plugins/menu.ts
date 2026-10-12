import { MenuGroupTypes, useMenuStore } from '#common/stores/menu';

export default defineNuxtPlugin(() => {
  const menu = useMenuStore();

  // Right after Agents (10), before Templates (20).
  menu.addSidebar({
    id: 'agentEvent',
    group: MenuGroupTypes.Main,
    title: 'Events',
    link: 'events',
    active: false,
    icon: 'BellRinging',
    sortOrder: 15,
  });
});
