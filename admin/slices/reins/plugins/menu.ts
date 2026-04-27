import { MenuGroupTypes, useMenuStore } from '#common/stores/menu';

export default defineNuxtPlugin(() => {
  const menu = useMenuStore();

  menu.addSidebar({
    id: 'reins',
    group: MenuGroupTypes.Main,
    title: 'Knowledges',
    link: 'knowledges',
    active: false,
    icon: 'Database',
    sortOrder: 30,
  });
});
