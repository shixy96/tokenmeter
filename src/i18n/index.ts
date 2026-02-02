import i18n from 'i18next'
import LanguageDetector from 'i18next-browser-languagedetector'
import { initReactI18next } from 'react-i18next'

import commonEn from './locales/en/common.json'
import dashboardEn from './locales/en/dashboard.json'
import providersEn from './locales/en/providers.json'
import settingsEn from './locales/en/settings.json'
import trayEn from './locales/en/tray.json'

import commonZh from './locales/zh/common.json'
import dashboardZh from './locales/zh/dashboard.json'
import providersZh from './locales/zh/providers.json'
import settingsZh from './locales/zh/settings.json'
import trayZh from './locales/zh/tray.json'

export const supportedLanguages = ['en', 'zh'] as const
export type SupportedLanguage = (typeof supportedLanguages)[number]

const resources = {
  en: {
    common: commonEn,
    dashboard: dashboardEn,
    providers: providersEn,
    settings: settingsEn,
    tray: trayEn,
  },
  zh: {
    common: commonZh,
    dashboard: dashboardZh,
    providers: providersZh,
    settings: settingsZh,
    tray: trayZh,
  },
}

export async function initI18n(savedLanguage?: string | null): Promise<void> {
  const i18nInstance = i18n.use(initReactI18next)

  // Only use LanguageDetector when no saved language preference
  if (!savedLanguage) {
    i18nInstance.use(LanguageDetector)
  }

  await i18nInstance.init({
    resources,
    lng: savedLanguage ?? undefined,
    fallbackLng: 'en',
    supportedLngs: supportedLanguages,
    defaultNS: 'common',
    ns: ['common', 'dashboard', 'providers', 'settings', 'tray'],
    interpolation: {
      escapeValue: false,
    },
    ...(savedLanguage
      ? {}
      : {
          detection: {
            order: ['navigator'],
            caches: [],
          },
        }),
  })
}

export function changeLanguage(language: SupportedLanguage | 'system'): void {
  if (language === 'system') {
    const browserLang = navigator.language.split('-')[0]
    const lang = supportedLanguages.includes(browserLang as SupportedLanguage)
      ? browserLang
      : 'en'
    i18n.changeLanguage(lang)
  }
  else {
    i18n.changeLanguage(language)
  }
}

export function getCurrentLanguage(): string {
  return i18n.language
}

export default i18n
