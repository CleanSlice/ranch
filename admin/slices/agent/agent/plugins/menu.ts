import { MenuGroupTypes, useMenuStore } from '#common/stores/menu';

export default defineNuxtPlugin(() => {
  const menu = useMenuStore();

  menu.addSidebar({
    id: 'agent',
    group: MenuGroupTypes.Main,
    title: 'Agents',
    link: 'agents',
    active: false,
    icon: 'Bot',
    sortOrder: 10,
  });
});
