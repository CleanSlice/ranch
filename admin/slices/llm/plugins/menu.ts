import { MenuGroupTypes, useMenuStore } from '#common/stores/menu';

export default defineNuxtPlugin(() => {
  const menu = useMenuStore();

  menu.addSidebar({
    id: 'llm',
    group: MenuGroupTypes.Admin,
    title: 'LLMs',
    link: 'llms',
    active: false,
    icon: 'Brain',
    sortOrder: 15,
  });
});
