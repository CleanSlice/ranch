import { MenuGroupTypes, useMenuStore } from '#common/stores/menu';

export default defineNuxtPlugin(() => {
  const menu = useMenuStore();

  menu.addSidebar({
    id: 'browser',
    group: MenuGroupTypes.Admin,
    title: 'Browser sessions',
    link: 'browser',
    active: false,
    icon: 'Browser',
    sortOrder: 13,
  });
});
