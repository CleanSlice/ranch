import { MenuGroupTypes, useMenuStore } from '#common/stores/menu';

export default defineNuxtPlugin(() => {
  const menu = useMenuStore();

  menu.addSidebar({
    id: 'reins',
    group: MenuGroupTypes.Admin,
    title: 'Knowledge',
    link: 'knowledges',
    active: false,
    icon: 'Database',
    sortOrder: 20,
  });
});
