import type { SupportedLanguage } from '@/i18n'
import { useCallback, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useConfig, useSaveConfig } from '@/hooks/useUsageData'
import { changeLanguage as i18nChangeLanguage, supportedLanguages } from '@/i18n'

export type LanguageOption = SupportedLanguage | 'system'

export function useLanguage() {
  const { i18n } = useTranslation()
  const { data: config } = useConfig()
  const saveMutation = useSaveConfig()

  // Derive initial language preference from config
  const initialLanguagePreference = useMemo<LanguageOption>(() => {
    if (config?.language) {
      const saved = config.language as LanguageOption
      if (saved === 'system' || supportedLanguages.includes(saved as SupportedLanguage)) {
        return saved
      }
    }
    return 'system'
  }, [config?.language])

  const [languagePreference, setLanguagePreference] = useState<LanguageOption>(initialLanguagePreference)

  // Keep languagePreference in sync with config when it changes
  const effectiveLanguagePreference = config?.language
    ? (supportedLanguages.includes(config.language as SupportedLanguage) || config.language === 'system'
        ? config.language as LanguageOption
        : languagePreference)
    : languagePreference

  const changeLanguage = useCallback((language: LanguageOption) => {
    // First change i18n language (synchronous, immediate UI update)
    i18nChangeLanguage(language)

    // Then update local state
    setLanguagePreference(language)

    // Finally persist to config using the mutation
    if (config) {
      saveMutation.mutate({ ...config, language }, {
        onError: (error) => {
          // Log error but don't revert - user sees the change immediately
          // On next app restart, it will fall back to previous setting
          console.error('Failed to save language preference:', error)
        },
      })
    }
  }, [config, saveMutation])

  return {
    currentLanguage: i18n.language as SupportedLanguage,
    languagePreference: effectiveLanguagePreference,
    changeLanguage,
    supportedLanguages,
  }
}
