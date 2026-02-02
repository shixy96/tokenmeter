import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { getCurrentWindow } from '@tauri-apps/api/window'
import * as React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
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

ReactDOM.createRoot(document.getElementById('root') as HTMLElement).render(
  <React.StrictMode>
    <QueryClientProvider client={queryClient}>
      <Root />
    </QueryClientProvider>
  </React.StrictMode>,
)
