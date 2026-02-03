import type { AppConfig } from '@/types'
import * as React from 'react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select } from '@/components/ui/select'
import { Separator } from '@/components/ui/separator'
import { Switch } from '@/components/ui/switch'
import { useLanguage } from '@/hooks/useLanguage'
import { useConfig, useSaveConfig } from '@/hooks/useUsageData'
import { setLaunchAtLogin } from '@/lib/api'

interface NumberInputHandlers {
  onChange: (e: React.ChangeEvent<HTMLInputElement>) => void
  onBlur: (e: React.FocusEvent<HTMLInputElement>) => void
}

function createNumberInputHandlers(
  updateFn: (value: number) => void,
  parser: (str: string) => number,
  clamp?: { min?: number, max?: number },
): NumberInputHandlers {
  return {
    onChange: (e: React.ChangeEvent<HTMLInputElement>) => {
      const value = parser(e.target.value)
      if (!Number.isNaN(value)) {
        updateFn(value)
      }
    },
    onBlur: (e: React.FocusEvent<HTMLInputElement>) => {
      const value = parser(e.target.value)
      if (!Number.isNaN(value)) {
        const clamped = clamp
          ? Math.max(clamp.min ?? -Infinity, Math.min(clamp.max ?? Infinity, value))
          : value
        updateFn(clamped)
      }
    },
  }
}

export function Settings() {
  const { data: config, isLoading } = useConfig()
  const saveMutation = useSaveConfig()
  const [localConfig, setLocalConfig] = useState<AppConfig | null>(null)
  const [autoLaunchError, setAutoLaunchError] = useState<string | null>(null)
  const { t } = useTranslation('settings')
  const { languagePreference, changeLanguage } = useLanguage()

  const currentConfig = localConfig || config

  if (isLoading || !currentConfig) {
    return <div className="p-6">{t('loading')}</div>
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
        <h1 className="text-2xl font-bold">{t('title')}</h1>
        <Button onClick={handleSave} disabled={!hasChanges || saveMutation.isPending}>
          {saveMutation.isPending ? t('saving') : t('saveChanges')}
        </Button>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>{t('general.title')}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-center justify-between">
            <div className="space-y-0.5">
              <Label>{t('general.launchAtLogin')}</Label>
              <p className="text-sm text-muted-foreground">
                {t('general.launchAtLoginDescription')}
              </p>
            </div>
            <Switch
              checked={currentConfig.launchAtLogin}
              onCheckedChange={checked => updateConfig({ launchAtLogin: checked })}
            />
          </div>
          {autoLaunchError && (
            <p className="text-sm text-red-500">
              {t('general.autoLaunchError')}
              {' '}
              {autoLaunchError}
            </p>
          )}

          <Separator />

          <div className="space-y-2">
            <Label htmlFor="refreshInterval">{t('general.refreshInterval')}</Label>
            <Input
              id="refreshInterval"
              type="number"
              min={60}
              max={3600}
              value={currentConfig.refreshInterval}
              {...createNumberInputHandlers(
                value => updateConfig({ refreshInterval: value }),
                str => Number.parseInt(str, 10),
                { min: 60, max: 3600 },
              )}
            />
            <p className="text-sm text-muted-foreground">
              {t('general.refreshIntervalDescription')}
            </p>
          </div>

          <Separator />

          <div className="space-y-2">
            <Label htmlFor="language">{t('general.language')}</Label>
            <Select
              id="language"
              value={languagePreference}
              onChange={e => changeLanguage(e.target.value as 'system' | 'en' | 'zh')}
            >
              <option value="system">{t('general.languageSystem')}</option>
              <option value="en">{t('general.languageEn')}</option>
              <option value="zh">{t('general.languageZh')}</option>
            </Select>
            <p className="text-sm text-muted-foreground">
              {t('general.languageDescription')}
            </p>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>{t('menuBar.title')}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="format">{t('menuBar.format')}</Label>
            <Input
              id="format"
              value={currentConfig.menuBar.format}
              onChange={e => updateMenuBar({ format: e.target.value })}
              placeholder={t('menuBar.formatPlaceholder')}
            />
            <p className="text-sm text-muted-foreground">
              {t('menuBar.formatDescription')}
            </p>
          </div>

          <Separator />

          <div className="space-y-2">
            <Label htmlFor="budget">{t('menuBar.budget')}</Label>
            <Input
              id="budget"
              type="number"
              min={0}
              step={0.01}
              value={currentConfig.menuBar.fixedBudget}
              {...createNumberInputHandlers(
                value => updateMenuBar({ fixedBudget: value }),
                str => Number.parseFloat(str),
                { min: 0 },
              )}
            />
            <p className="text-sm text-muted-foreground">
              {t('menuBar.budgetDescription')}
            </p>
          </div>

          <Separator />

          <div className="space-y-2">
            <Label htmlFor="nearBudgetThresholdPercent">{t('menuBar.nearBudgetThreshold')}</Label>
            <Input
              id="nearBudgetThresholdPercent"
              type="number"
              min={0}
              max={100}
              step={1}
              value={currentConfig.menuBar.nearBudgetThresholdPercent}
              {...createNumberInputHandlers(
                value => updateMenuBar({ nearBudgetThresholdPercent: value }),
                str => Number.parseFloat(str),
                { min: 0, max: 100 },
              )}
            />
            <p className="text-sm text-muted-foreground">
              {t('menuBar.nearBudgetThresholdDescription')}
            </p>
          </div>

          <Separator />

          <div className="flex items-center justify-between">
            <div className="space-y-0.5">
              <Label>{t('menuBar.colorCoding')}</Label>
              <p className="text-sm text-muted-foreground">
                {t('menuBar.colorCodingDescription')}
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
