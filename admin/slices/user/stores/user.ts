export const useUserStore = defineStore('user', () => {
  const users = ref<unknown[]>([]);

  async function fetchAll() {
    return users.value;
  }

  return { users, fetchAll };
});
