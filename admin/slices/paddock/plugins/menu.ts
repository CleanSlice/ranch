import { MenuGroupTypes, useMenuStore } from '#common/stores/menu';

export default defineNuxtPlugin(() => {
  const menu = useMenuStore();

  menu.addSidebar({
    id: 'paddock',
    group: MenuGroupTypes.Main,
    title: 'Evaluations',
    link: 'paddock',
    active: false,
    icon: 'FlaskConical',
    sortOrder: 40,
  });
});
