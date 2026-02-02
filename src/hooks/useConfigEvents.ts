import type { SupportedLanguage } from '@/i18n'
import type { AppConfig } from '@/types'
import { useQueryClient } from '@tanstack/react-query'
import { listen } from '@tauri-apps/api/event'
import { useEffect } from 'react'
import { changeLanguage as i18nChangeLanguage, supportedLanguages } from '@/i18n'

function normalizeLanguage(language?: string): SupportedLanguage | 'system' {
  if (!language || language === 'system')
    return 'system'
  if (supportedLanguages.includes(language as SupportedLanguage))
    return language as SupportedLanguage
  return 'system'
}

export function useConfigEvents() {
  const queryClient = useQueryClient()

  useEffect(() => {
    let unlisten: (() => void) | undefined

    async function setupListener() {
      unlisten = await listen<AppConfig>('config-updated', (event) => {
        const config = event.payload
        queryClient.setQueryData(['config'], config)
        i18nChangeLanguage(normalizeLanguage(config.language))
      })
    }

    setupListener().catch(() => {})

    return () => {
      unlisten?.()
    }
  }, [queryClient])
}
