import { MenuGroupTypes, useMenuStore } from '#common/stores/menu';

export default defineNuxtPlugin(() => {
  useMenuStore().addSidebar({
    id: 'chat',
    group: MenuGroupTypes.Main,
    title: 'Chats',
    link: 'chats', // route name of slices/chat/pages/chats/index.vue
    active: false,
    icon: 'MessageSquare',
    sortOrder: 35, // between Knowledges (30) and Evaluations (40)
  });
});
