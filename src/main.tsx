import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { getCurrentWindow } from '@tauri-apps/api/window'
import * as React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
import { initI18n } from './i18n'
import { getConfig } from './lib/api'
import { Tray } from './Tray'
import './index.css'

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: 1,
      refetchOnWindowFocus: false,
    },
  },
})

function Root(): React.ReactElement {
  const windowLabel = getCurrentWindow().label
  return windowLabel === 'tray' ? <Tray /> : <App />
}

async function bootstrap() {
  let savedLanguage: string | null = null
  try {
    const config = await getConfig()
    savedLanguage = config.language ?? null
  }
  catch {
    // Ignore error, will use system language
  }

  await initI18n(savedLanguage)

  ReactDOM.createRoot(document.getElementById('root') as HTMLElement).render(
    <React.StrictMode>
      <QueryClientProvider client={queryClient}>
        <Root />
      </QueryClientProvider>
    </React.StrictMode>,
  )
}

bootstrap()
