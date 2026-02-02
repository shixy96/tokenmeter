import { useCallback, useEffect, useState } from 'react'

type Theme = 'light' | 'dark'

const THEME_KEY = 'tokenmeter-theme'

function getInitialTheme(): Theme {
  if (typeof window === 'undefined')
    return 'dark'

  const stored = localStorage.getItem(THEME_KEY)
  if (stored === 'light' || stored === 'dark') {
    return stored
  }

  return 'dark'
}

export function useTheme() {
  const [theme, setTheme] = useState<Theme>(getInitialTheme)

  useEffect(() => {
    const root = document.documentElement
    root.classList.toggle('dark', theme === 'dark')
    if (localStorage.getItem(THEME_KEY) !== theme) {
      localStorage.setItem(THEME_KEY, theme)
    }
  }, [theme])

  useEffect(() => {
    const onStorage = (event: StorageEvent) => {
      if (event.key !== THEME_KEY)
        return
      if (event.newValue === 'light' || event.newValue === 'dark') {
        setTheme(event.newValue)
      }
    }

    window.addEventListener('storage', onStorage)
    return () => {
      window.removeEventListener('storage', onStorage)
    }
  }, [])

  const toggleTheme = useCallback(() => {
    setTheme(prev => (prev === 'dark' ? 'light' : 'dark'))
  }, [])

  return { theme, setTheme, toggleTheme, isDark: theme === 'dark' }
}
