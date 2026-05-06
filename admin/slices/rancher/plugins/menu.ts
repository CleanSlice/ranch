import { MenuGroupTypes, useMenuStore } from '#common/stores/menu';

export default defineNuxtPlugin(() => {
  const menu = useMenuStore();

  menu.addSidebar({
    id: 'rancher',
    group: MenuGroupTypes.Main,
    title: 'Rancher',
    link: 'rancher',
    active: false,
    icon: 'Shield',
    sortOrder: 5,
  });
});
