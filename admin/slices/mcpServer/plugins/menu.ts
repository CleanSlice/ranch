import { MenuGroupTypes, useMenuStore } from '#common/stores/menu';

export default defineNuxtPlugin(() => {
  const menu = useMenuStore();

  menu.addSidebar({
    id: 'mcpServer',
    group: MenuGroupTypes.Admin,
    title: 'MCP servers',
    link: 'mcps',
    active: false,
    icon: 'Plug',
    sortOrder: 30,
  });
});
