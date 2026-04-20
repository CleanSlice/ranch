import { MenuGroupTypes, useMenuStore } from '#common/stores/menu';

export default defineNuxtPlugin(() => {
  const menu = useMenuStore();

  menu.addSidebar({
    id: 'setting',
    group: MenuGroupTypes.Admin,
    title: 'Settings',
    link: 'settings',
    active: false,
    icon: 'Settings',
    sortOrder: 20,
  });
});
