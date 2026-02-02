import { listen } from '@tauri-apps/api/event'
import { useEffect, useState } from 'react'

export function useRefreshState() {
  const [isRefreshing, setIsRefreshing] = useState(false)

  useEffect(() => {
    let unlistenStart: (() => void) | undefined
    let unlistenComplete: (() => void) | undefined

    async function setup() {
      unlistenStart = await listen('refresh-started', () => {
        setIsRefreshing(true)
      })
      unlistenComplete = await listen('refresh-completed', () => {
        setIsRefreshing(false)
      })
    }

    setup().catch(() => {})

    return () => {
      unlistenStart?.()
      unlistenComplete?.()
    }
  }, [])

  return isRefreshing
}
