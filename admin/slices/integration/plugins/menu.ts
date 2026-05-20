import { MenuGroupTypes, useMenuStore } from '#common/stores/menu';

export default defineNuxtPlugin(() => {
  const menu = useMenuStore();

  menu.addSidebar({
    id: 'integration',
    group: MenuGroupTypes.Admin,
    title: 'Integrations',
    link: 'integrations',
    active: false,
    icon: 'Plug',
    sortOrder: 14,
  });
});
