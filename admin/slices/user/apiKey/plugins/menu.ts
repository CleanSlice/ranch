import { MenuGroupTypes, useMenuStore } from '#common/stores/menu';

export default defineNuxtPlugin(() => {
  const menu = useMenuStore();

  menu.addSidebar({
    id: 'apiKey',
    group: MenuGroupTypes.Admin,
    title: 'API Keys',
    link: 'api-keys',
    active: false,
    icon: 'KeyRound',
    sortOrder: 12,
  });
});
