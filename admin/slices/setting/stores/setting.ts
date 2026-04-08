export const useSettingStore = defineStore('setting', () => {
  const settings = ref<Record<string, unknown>>({});

  async function fetch() {
    return settings.value;
  }

  async function update(data: Record<string, unknown>) {
    // SettingsService.update({ requestBody: data })
  }

  return { settings, fetch, update };
});
