import { MenuGroupTypes, useMenuStore } from '#common/stores/menu';

export default defineNuxtPlugin(() => {
  const menu = useMenuStore();

  menu.addSidebar({
    id: 'templateInstall',
    group: MenuGroupTypes.Main,
    title: 'Install template',
    link: 'templates-install',
    active: false,
    icon: 'PackagePlus',
    sortOrder: 21,
  });
});
