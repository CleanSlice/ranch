import { MenuGroupTypes, useMenuStore } from '#common/stores/menu';

export default defineNuxtPlugin(() => {
  const menu = useMenuStore();

  menu.addSidebar({
    id: 'sessions',
    group: MenuGroupTypes.Admin,
    title: 'Sessions',
    link: 'sessions',
    active: false,
    icon: 'Browser',
    sortOrder: 13,
  });
});
