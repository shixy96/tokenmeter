import type { DailyUsage, ModelUsage, UsageSummary } from '@/types'
import { useQueryClient } from '@tanstack/react-query'
import { invoke } from '@tauri-apps/api/core'
import { listen } from '@tauri-apps/api/event'
import {
  LayoutDashboard,
  Power,
  RefreshCw,
  Settings,
} from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { DailyBarChart } from '@/components/DailyBarChart'
import { ModelIcon } from '@/components/icons/ModelIcon'
import { useConfigEvents } from '@/hooks/useConfigEvents'
import { useRefreshState } from '@/hooks/useRefreshState'
import { useTheme } from '@/hooks/useTheme'
import { useRefreshUsage, useUsageData } from '@/hooks/useUsageData'
import {
  cn,
  getDailyTotalTokens,
  normalizeDate,
  sortByDateDesc,
  validateDailyUsage,
} from '@/lib/utils'
import { formatCost, formatTokens } from '@/types'

interface ModelWithPercent extends ModelUsage {
  percent: number
  progressStyle: React.CSSProperties
}

interface AggregatedData {
  modelMap: Map<string, ModelUsage>
  totalCost: number
  totalTokens: number
}

function aggregateModels(days: DailyUsage[]): AggregatedData {
  const modelMap = new Map<string, ModelUsage>()
  let totalCost = 0
  let totalTokens = 0

  for (const day of days) {
    totalCost += day.cost
    totalTokens += getDailyTotalTokens(day)
    for (const m of day.models) {
      const existing = modelMap.get(m.model) || {
        model: m.model,
        cost: 0,
        inputTokens: 0,
        outputTokens: 0,
      }
      existing.cost += m.cost
      existing.inputTokens += m.inputTokens
      existing.outputTokens += m.outputTokens
      modelMap.set(m.model, existing)
    }
  }

  return { modelMap, totalCost, totalTokens }
}

// Sort models by cost in descending order
function sortModelsByCost(models: ModelUsage[]): ModelUsage[] {
  return [...models].sort((a, b) => b.cost - a.cost)
}

// Get top N models from aggregated days data
function getTopModels(days: DailyUsage[], limit: number): { models: ModelUsage[], totalCost: number, totalTokens: number } {
  const { modelMap, totalCost, totalTokens } = aggregateModels(days)
  const models = sortModelsByCost(Array.from(modelMap.values())).slice(0, limit)
  return { models, totalCost, totalTokens }
}

// Add percent and progress style to models for rendering
function addPercentToModels(models: ModelUsage[], totalCost: number): ModelWithPercent[] {
  return models.map((m) => {
    const percent = totalCost > 0 ? (m.cost / totalCost) * 100 : 0
    return { ...m, percent, progressStyle: { width: `${percent}%` } }
  })
}

export function Tray() {
  const [activeTab, setActiveTab] = useState<'today' | '7days' | '30days'>('today')
  const lastUsageRef = useRef<UsageSummary | null>(null)
  const queryClient = useQueryClient()
  useTheme()
  useConfigEvents()
  const { data: usage, isLoading, isFetching } = useUsageData()
  const refreshMutation = useRefreshUsage()
  const isGlobalRefreshing = useRefreshState()
  const { t } = useTranslation('tray')

  const isRefreshing = isGlobalRefreshing || refreshMutation.isPending || isFetching

  // Listen for usage-updated events from backend to sync data
  useEffect(() => {
    let unlisten: (() => void) | undefined

    async function setupListener() {
      unlisten = await listen<UsageSummary>('usage-updated', (event) => {
        queryClient.setQueryData(['usage'], event.payload)
      })
    }

    setupListener().catch(() => {})

    return () => {
      unlisten?.()
    }
  }, [queryClient])

  if (usage) {
    lastUsageRef.current = usage
  }

  const handleRefresh = () => {
    refreshMutation.mutate()
  }

  const handleOpenDashboard = async () => {
    await invoke('open_dashboard')
  }

  const handleQuit = async () => {
    await invoke('quit_app')
  }

  const handleOpenSettings = async () => {
    await invoke('open_settings')
  }

  // Stabilize displayUsage reference with useMemo to ensure proper dependency tracking
  const displayUsage = useMemo(() => usage ?? lastUsageRef.current, [usage])

  // Pre-compute sorted daily usage (shared across all tabs)
  const sortedDailyUsage = useMemo(() => {
    if (!displayUsage)
      return []
    if (import.meta.env.DEV) {
      validateDailyUsage(displayUsage.dailyUsage)
    }
    return sortByDateDesc(displayUsage.dailyUsage)
  }, [displayUsage])

  // Compute tab-specific data based on activeTab
  const tabData = useMemo(() => {
    if (!displayUsage || sortedDailyUsage.length === 0) {
      return {
        activeModels: [] as ModelWithPercent[],
        activeTotalCost: 0,
        activeTotalTokens: 0,
        chartData: [],
        summaryStats: null,
      }
    }

    switch (activeTab) {
      case 'today': {
        const normalizedToday = normalizeDate(displayUsage.today.date)
        const todayModels = sortedDailyUsage
          .find(d => normalizeDate(d.date) === normalizedToday)
          ?.models || []
        const sortedModels = sortModelsByCost(todayModels).slice(0, 3)
        return {
          activeModels: addPercentToModels(sortedModels, displayUsage.today.cost),
          activeTotalCost: displayUsage.today.cost,
          activeTotalTokens: displayUsage.today.totalTokens,
          chartData: [],
          summaryStats: null,
        }
      }

      case '7days': {
        const last7Days = sortedDailyUsage.slice(0, 7)
        const { models, totalCost, totalTokens } = getTopModels(last7Days, 5)
        const dailyAvg = last7Days.length > 0 ? totalCost / last7Days.length : 0
        return {
          activeModels: addPercentToModels(models, totalCost),
          activeTotalCost: totalCost,
          activeTotalTokens: totalTokens,
          chartData: last7Days.map(d => ({ date: d.date, cost: d.cost })),
          summaryStats: {
            activeDays: last7Days.length,
            totalCost,
            totalTokens,
            dailyAvg,
          },
        }
      }

      case '30days': {
        const last30Days = sortedDailyUsage.slice(0, 30)
        const { models, totalCost, totalTokens } = getTopModels(last30Days, 5)
        const dailyAvg = last30Days.length > 0 ? totalCost / last30Days.length : 0
        return {
          activeModels: addPercentToModels(models, totalCost),
          activeTotalCost: totalCost,
          activeTotalTokens: totalTokens,
          chartData: [],
          summaryStats: {
            activeDays: last30Days.length,
            totalCost,
            totalTokens,
            dailyAvg,
          },
        }
      }
    }
  }, [displayUsage, sortedDailyUsage, activeTab])

  const { activeModels, chartData, summaryStats } = tabData

  // Tab configuration for rendering
  const tabs: Array<{ id: 'today' | '7days' | '30days', label: string }> = [
    { id: 'today', label: t('tabs.today') },
    { id: '7days', label: t('tabs.days7') },
    { id: '30days', label: t('tabs.days30') },
  ]

  if (isLoading && !displayUsage) {
    return (
      <div className="flex items-center justify-center h-screen bg-background text-muted-foreground">
        {t('loading')}
      </div>
    )
  }

  if (!displayUsage) {
    return (
      <div className="flex items-center justify-center h-screen bg-background text-muted-foreground">
        {t('noUsageData')}
      </div>
    )
  }

  return (
    <div className="relative flex flex-col h-screen overflow-hidden text-sm bg-background select-none">
      <button
        onClick={handleOpenSettings}
        className="absolute top-4 right-4 z-10 p-1.5 rounded-lg cursor-pointer outline-none
                   transition-colors hover:bg-accent/50"
      >
        <Settings className="w-4 h-4 text-muted-foreground" />
      </button>

      <div className="px-6 py-6 text-center" data-tauri-drag-region>
        <div className="text-3xl font-semibold tracking-tight">
          {formatCost(displayUsage.today.cost)}
        </div>
        <div className="mt-1.5 text-xs text-muted-foreground">
          {formatTokens(displayUsage.today.totalTokens)}
          {' '}
          {t('tokens')}
        </div>
      </div>

      <div className="flex mx-4 p-1 rounded-lg glass">
        {tabs.map(tab => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            className={cn(
              'flex-1 py-1.5 text-xs font-medium rounded-md cursor-pointer outline-none transition-colors',
              activeTab === tab.id
                ? 'bg-primary/20 text-foreground'
                : 'text-muted-foreground hover:text-foreground',
            )}
          >
            {tab.label}
          </button>
        ))}
      </div>

      <div className="flex-1 px-5 py-4 space-y-3 overflow-y-auto">
        {/* 汇总卡片 - 7天和30天都显示 */}
        {(activeTab === '7days' || activeTab === '30days') && summaryStats && (
          <div className="glass-card p-3">
            <div className="text-xs font-medium text-muted-foreground mb-2">
              {t('summary.activeDays', { count: summaryStats.activeDays })}
            </div>
            <div className="grid grid-cols-3 gap-2 text-center">
              <div>
                <div className="text-lg font-semibold">{formatCost(summaryStats.totalCost)}</div>
                <div className="text-[10px] text-muted-foreground">{t('summary.totalCost')}</div>
              </div>
              <div>
                <div className="text-lg font-semibold">{formatTokens(summaryStats.totalTokens)}</div>
                <div className="text-[10px] text-muted-foreground">{t('summary.totalTokens')}</div>
              </div>
              <div>
                <div className="text-lg font-semibold">{formatCost(summaryStats.dailyAvg)}</div>
                <div className="text-[10px] text-muted-foreground">{t('summary.dailyAvg')}</div>
              </div>
            </div>
          </div>
        )}

        {/* 7天图表 */}
        {activeTab === '7days' && chartData.length > 0 && (
          <div className="glass-card p-3">
            <div className="text-xs font-medium text-muted-foreground mb-2">{t('chart.dailyCost')}</div>
            <DailyBarChart data={chartData} />
          </div>
        )}

        {activeModels.length > 0 && (
          <div className="text-xs font-medium text-muted-foreground">
            {t('models.topModels')}
          </div>
        )}

        {activeModels.map(model => (
          <div key={`${activeTab}-${model.model}`} className="p-3 glass-card">
            <div className="flex items-center justify-between text-xs">
              <div className="flex items-center gap-2 overflow-hidden">
                <ModelIcon model={model.model} className="w-4 h-4 shrink-0 text-muted-foreground" />
                <span className="truncate font-medium" title={model.model}>{model.model}</span>
              </div>
              <span className="font-semibold shrink-0">{formatCost(model.cost)}</span>
            </div>
            <div className="mt-2 flex items-center gap-1">
              <div className="flex-1 h-1.5 bg-secondary/50 rounded-full overflow-hidden">
                <div
                  className="h-full rounded-full progress-gradient"
                  style={model.progressStyle}
                />
              </div>
              <span className="text-[10px] text-muted-foreground w-10 text-right shrink-0">
                (
                {Math.round(model.percent)}
                %)
              </span>
            </div>
          </div>
        ))}

        {activeModels.length === 0 && (
          <div className="py-4 text-center text-muted-foreground">
            {t('noUsageData')}
          </div>
        )}
      </div>

      <div className="grid grid-cols-3 pb-2 glass border-t border-border/50">
        <button
          onClick={handleOpenDashboard}
          className="flex flex-col items-center justify-center gap-1 py-2.5 text-[10px] font-medium transition-colors cursor-pointer outline-none hover:bg-accent/50"
        >
          <LayoutDashboard className="w-4 h-4" />
          {t('actions.dashboard')}
        </button>
        <button
          onClick={handleRefresh}
          className={cn(
            'flex flex-col items-center justify-center gap-1 py-2.5 text-[10px] font-medium transition-colors cursor-pointer outline-none hover:bg-accent/50',
            isRefreshing && 'opacity-70 cursor-wait',
          )}
          disabled={isRefreshing}
        >
          <RefreshCw className={cn('w-4 h-4', isRefreshing && 'animate-spin')} />
          {t('actions.refresh')}
        </button>
        <button
          onClick={handleQuit}
          className="flex flex-col items-center justify-center gap-1 py-2.5 text-[10px] font-medium transition-colors cursor-pointer outline-none hover:bg-accent/50 hover:text-destructive"
        >
          <Power className="w-4 h-4" />
          {t('actions.quit')}
        </button>
      </div>
    </div>
  )
}
