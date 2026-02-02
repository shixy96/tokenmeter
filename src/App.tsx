import { listen } from '@tauri-apps/api/event'
import { BarChart3, Plug, Settings as SettingsIcon } from 'lucide-react'
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Dashboard } from '@/components/Dashboard'
import { ProviderEditor } from '@/components/ProviderEditor'
import { Settings } from '@/components/Settings'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { useConfigEvents } from '@/hooks/useConfigEvents'
import { useTheme } from '@/hooks/useTheme'

function App() {
  const [activeTab, setActiveTab] = useState('dashboard')
  const { t } = useTranslation()
  useTheme()
  useConfigEvents()

  useEffect(() => {
    let unlisten: (() => void) | undefined

    async function setupListener() {
      unlisten = await listen<string>('navigate', (event) => {
        setActiveTab(event.payload)
      })
    }

    setupListener().catch(() => {})

    return () => {
      unlisten?.()
    }
  }, [])

  return (
    <div className="min-h-screen bg-background">
      {/* Top drag region - leave space for window control buttons */}
      <div className="h-10 bg-background" data-tauri-drag-region />
      <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full">
        <div className="border-b bg-background" data-tauri-drag-region>
          <div className="px-6 py-2" data-tauri-drag-region>
            <TabsList className="grid w-full max-w-md grid-cols-3">
              <TabsTrigger value="dashboard" className="flex items-center gap-2">
                <BarChart3 className="w-4 h-4" />
                {t('nav.dashboard')}
              </TabsTrigger>
              <TabsTrigger value="providers" className="flex items-center gap-2">
                <Plug className="w-4 h-4" />
                {t('nav.providers')}
              </TabsTrigger>
              <TabsTrigger value="settings" className="flex items-center gap-2">
                <SettingsIcon className="w-4 h-4" />
                {t('nav.settings')}
              </TabsTrigger>
            </TabsList>
          </div>
        </div>

        <TabsContent value="dashboard" className="mt-0">
          <Dashboard />
        </TabsContent>

        <TabsContent value="providers" className="mt-0">
          <ProviderEditor />
        </TabsContent>

        <TabsContent value="settings" className="mt-0">
          <Settings />
        </TabsContent>
      </Tabs>
    </div>
  )
}

export default App
