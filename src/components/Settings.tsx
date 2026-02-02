import type { AppConfig } from '@/types'
import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Separator } from '@/components/ui/separator'
import { Switch } from '@/components/ui/switch'
import { useConfig, useSaveConfig } from '@/hooks/useUsageData'
import { setLaunchAtLogin } from '@/lib/api'

export function Settings() {
  const { data: config, isLoading } = useConfig()
  const saveMutation = useSaveConfig()
  const [localConfig, setLocalConfig] = useState<AppConfig | null>(null)
  const [autoLaunchError, setAutoLaunchError] = useState<string | null>(null)

  const currentConfig = localConfig || config

  if (isLoading || !currentConfig) {
    return <div className="p-6">Loading settings...</div>
  }

  const handleSave = async () => {
    if (!localConfig || saveMutation.isPending)
      return
    setAutoLaunchError(null)
    const configToSave = localConfig
    const originalConfig = config
    const launchAtLoginChanged = configToSave.launchAtLogin !== originalConfig?.launchAtLogin

    if (launchAtLoginChanged) {
      try {
        await setLaunchAtLogin(configToSave.launchAtLogin)
      }
      catch (e) {
        setAutoLaunchError(String(e))
        return
      }
    }

    saveMutation.mutate(configToSave, {
      onSuccess: () => setLocalConfig(null),
      onError: async () => {
        if (launchAtLoginChanged && originalConfig) {
          try {
            await setLaunchAtLogin(originalConfig.launchAtLogin)
          }
          catch (rollbackError) {
            setAutoLaunchError(`Failed to save and rollback failed: ${String(rollbackError)}`)
          }
        }
      },
    })
  }

  const updateConfig = (updates: Partial<AppConfig>) => {
    if (!config)
      return
    setLocalConfig(prev => ({ ...(prev ?? config), ...updates }))
  }

  const updateMenuBar = (updates: Partial<AppConfig['menuBar']>) => {
    if (!config)
      return
    setLocalConfig((prev) => {
      const base = prev ?? config
      return { ...base, menuBar: { ...base.menuBar, ...updates } }
    })
  }

  const hasChanges = localConfig !== null
    && JSON.stringify(localConfig) !== JSON.stringify(config)

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">Settings</h1>
        <Button onClick={handleSave} disabled={!hasChanges || saveMutation.isPending}>
          {saveMutation.isPending ? 'Saving...' : 'Save Changes'}
        </Button>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>General</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-center justify-between">
            <div className="space-y-0.5">
              <Label>Launch at Login</Label>
              <p className="text-sm text-muted-foreground">
                Start TokenMeter when you log in
              </p>
            </div>
            <Switch
              checked={currentConfig.launchAtLogin}
              onCheckedChange={checked => updateConfig({ launchAtLogin: checked })}
            />
          </div>
          {autoLaunchError && (
            <p className="text-sm text-red-500">
              Failed to update auto-launch setting:
              {' '}
              {autoLaunchError}
            </p>
          )}

          <Separator />

          <div className="space-y-2">
            <Label htmlFor="refreshInterval">Refresh Interval (seconds)</Label>
            <Input
              id="refreshInterval"
              type="number"
              min={60}
              max={3600}
              value={currentConfig.refreshInterval}
              onChange={(e) => {
                const value = Number.parseInt(e.target.value, 10)
                if (!Number.isNaN(value)) {
                  updateConfig({ refreshInterval: Math.max(60, Math.min(3600, value)) })
                }
              }}
            />
            <p className="text-sm text-muted-foreground">
              How often to fetch usage data (60-3600 seconds)
            </p>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Menu Bar Display</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="format">Display Format</Label>
            <Input
              id="format"
              value={currentConfig.menuBar.format}
              onChange={e => updateMenuBar({ format: e.target.value })}
              placeholder="$cost $tokens"
            />
            <p className="text-sm text-muted-foreground">
              Variables: $cost, $tokens, $input, $output
            </p>
          </div>

          <Separator />

          <div className="space-y-2">
            <Label htmlFor="budget">Daily Budget ($)</Label>
            <Input
              id="budget"
              type="number"
              min={0}
              step={0.01}
              value={currentConfig.menuBar.fixedBudget}
              onChange={(e) => {
                const value = Number.parseFloat(e.target.value)
                if (!Number.isNaN(value)) {
                  updateMenuBar({ fixedBudget: Math.max(0, value) })
                }
              }}
            />
            <p className="text-sm text-muted-foreground">
              Used for color coding thresholds
            </p>
          </div>

          <Separator />

          <div className="flex items-center justify-between">
            <div className="space-y-0.5">
              <Label>Color Coding</Label>
              <p className="text-sm text-muted-foreground">
                Show usage level with colors
              </p>
            </div>
            <Switch
              checked={currentConfig.menuBar.showColorCoding}
              onCheckedChange={checked =>
                updateMenuBar({ showColorCoding: checked })}
            />
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
