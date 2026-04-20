import { MenuGroupTypes, useMenuStore } from '#common/stores/menu';

export default defineNuxtPlugin(() => {
  const menu = useMenuStore();

  menu.addSidebar({
    id: 'template',
    group: MenuGroupTypes.Main,
    title: 'Templates',
    link: 'templates',
    active: false,
    icon: 'FileText',
    sortOrder: 20,
  });
});
