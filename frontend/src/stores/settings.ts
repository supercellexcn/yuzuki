import { defineStore } from 'pinia'
import { getSettings as apiGetSettings, saveSettings } from '../api'
import type { AppSettings } from '../api/types'

export const useSettingsStore = defineStore('settings', {
  state: () => ({
    settings: null as AppSettings | null,
  }),
  actions: {
    async load() {
      this.settings = await apiGetSettings()
      return this.settings
    },
    async save(patch: Partial<AppSettings>) {
      this.settings = await saveSettings(patch)
      return this.settings
    },
  },
})
