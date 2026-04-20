import { MenuGroupTypes, useMenuStore } from '#common/stores/menu';

export default defineNuxtPlugin(() => {
  const menu = useMenuStore();

  menu.addSidebar({
    id: 'user',
    group: MenuGroupTypes.Admin,
    title: 'Users',
    link: 'users',
    active: false,
    icon: 'Users',
    sortOrder: 10,
  });
});
