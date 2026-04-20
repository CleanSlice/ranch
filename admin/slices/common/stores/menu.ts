import { defineStore } from 'pinia';

export enum MenuGroupTypes {
  Main = 'main',
  Admin = 'admin',
}

export type IMenuData = {
  id: string;
  group: MenuGroupTypes;
  title: string;
  link: string;
  active: boolean;
  icon: string;
  sortOrder: number;
};

export const useMenuStore = defineStore('menu', {
  state: () => ({
    sidebar: [] as IMenuData[],
  }),

  getters: {
    getSidebar: (state) => {
      const route = useRoute();
      return [...state.sidebar]
        .sort((a, b) => a.sortOrder - b.sortOrder)
        .map((item) => ({
          ...item,
          active: route?.name?.toString() === item.link,
        }));
    },
  },

  actions: {
    addSidebar(item: IMenuData) {
      const exists = this.sidebar.some(
        (existing) => existing.id === item.id && existing.group === item.group,
      );
      if (!exists) {
        this.sidebar.push(item);
      }
    },
  },
});
