import { MenuGroupTypes, useMenuStore } from '#common/stores/menu';

export default defineNuxtPlugin(() => {
  const menu = useMenuStore();

  menu.addSidebar({
    id: 'skill',
    group: MenuGroupTypes.Admin,
    title: 'Skills',
    link: 'skills',
    active: false,
    icon: 'Sparkles',
    sortOrder: 16,
  });
});
