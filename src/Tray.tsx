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
import { useEffect, useRef, useState } from 'react'
import { DailyBarChart } from '@/components/DailyBarChart'
import { ModelIcon } from '@/components/icons/ModelIcon'
import { useTheme } from '@/hooks/useTheme'
import { useRefreshUsage, useUsageData } from '@/hooks/useUsageData'
import { cn } from '@/lib/utils'
import { formatCost, formatTokens } from '@/types'

interface AggregatedData {
  modelMap: Map<string, ModelUsage>
  totalCost: number
  totalTokens: number
}

function aggregateModels(days: DailyUsage[]): AggregatedData {
  const modelMap = new Map<string, ModelUsage>()
  let totalCost = 0
  let totalTokens = 0

  days.forEach((day) => {
    totalCost += day.cost
    totalTokens += day.inputTokens + day.outputTokens
    day.models.forEach((m) => {
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
    })
  })

  return { modelMap, totalCost, totalTokens }
}

export function Tray() {
  const [activeTab, setActiveTab] = useState<'today' | '7days' | '30days'>('today')
  const lastUsageRef = useRef<UsageSummary | null>(null)
  const queryClient = useQueryClient()
  useTheme()
  const { data: usage, isLoading, isFetching } = useUsageData()
  const refreshMutation = useRefreshUsage()

  const isRefreshing = refreshMutation.isPending || isFetching

  // Listen for usage-updated events from backend to sync data
  useEffect(() => {
    const unlisten = listen<UsageSummary>('usage-updated', (event) => {
      queryClient.setQueryData(['usage'], event.payload)
    })
    return () => {
      unlisten.then(fn => fn())
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

  const displayUsage = usage ?? lastUsageRef.current

  if (isLoading && !displayUsage) {
    return (
      <div className="flex items-center justify-center h-screen bg-background text-muted-foreground">
        Loading...
      </div>
    )
  }

  if (!displayUsage) {
    return (
      <div className="flex items-center justify-center h-screen bg-background text-muted-foreground">
        No usage data
      </div>
    )
  }

  const todayModels = displayUsage.dailyUsage
    .find(d => d.date === displayUsage.today.date)
    ?.models || []

  const sortedTodayModels = [...todayModels].sort((a, b) => b.cost - a.cost)
  const top3Today = sortedTodayModels.slice(0, 3)

  const last7Days = [...displayUsage.dailyUsage]
    .sort((a, b) => b.date.localeCompare(a.date))
    .slice(0, 7)

  const { modelMap: aggregated7DayModels, totalCost: totalCost7Days } = aggregateModels(last7Days)
  const sorted7DayModels = Array.from(aggregated7DayModels.values())
    .sort((a, b) => b.cost - a.cost)
  const top5Last7Days = sorted7DayModels.slice(0, 5)

  const dailyChartData = last7Days.map(d => ({
    date: d.date,
    cost: d.cost,
  }))

  const last30Days = [...displayUsage.dailyUsage]
    .sort((a, b) => b.date.localeCompare(a.date))
    .slice(0, 30)

  const {
    modelMap: aggregated30DayModels,
    totalCost: totalCost30Days,
    totalTokens: totalTokens30Days,
  } = aggregateModels(last30Days)
  const sorted30DayModels = Array.from(aggregated30DayModels.values())
    .sort((a, b) => b.cost - a.cost)
  const top5Last30Days = sorted30DayModels.slice(0, 5)

  const dailyAvg30Days = last30Days.length > 0 ? totalCost30Days / last30Days.length : 0

  const getActiveModels = (): ModelUsage[] => {
    switch (activeTab) {
      case 'today':
        return top3Today
      case '7days':
        return top5Last7Days
      case '30days':
        return top5Last30Days
    }
  }

  const getActiveTotalCost = (): number => {
    switch (activeTab) {
      case 'today':
        return displayUsage.today.cost
      case '7days':
        return totalCost7Days
      case '30days':
        return totalCost30Days
    }
  }

  const activeModels = getActiveModels()
  const activeTotalCost = getActiveTotalCost()

  return (
    <div className="relative flex flex-col h-screen overflow-hidden text-sm bg-background select-none">
      <button
        onClick={handleOpenSettings}
        className="absolute top-3 right-3 z-10 p-1.5 rounded-lg cursor-pointer outline-none
                   transition-colors hover:bg-accent/50"
      >
        <Settings className="w-4 h-4 text-muted-foreground" />
      </button>

      <div className="px-6 py-5 text-center" data-tauri-drag-region>
        <div className="text-3xl font-semibold tracking-tight">
          {formatCost(displayUsage.today.cost)}
        </div>
        <div className="mt-1.5 text-xs text-muted-foreground">
          {formatTokens(displayUsage.today.totalTokens)}
          {' '}
          Tokens
        </div>
      </div>

      <div className="flex mx-4 p-1 rounded-lg glass">
        <button
          onClick={() => setActiveTab('today')}
          className={cn(
            'flex-1 py-1.5 text-xs font-medium rounded-md cursor-pointer outline-none transition-colors',
            activeTab === 'today'
              ? 'bg-primary/20 text-foreground'
              : 'text-muted-foreground hover:text-foreground',
          )}
        >
          Today
        </button>
        <button
          onClick={() => setActiveTab('7days')}
          className={cn(
            'flex-1 py-1.5 text-xs font-medium rounded-md cursor-pointer outline-none transition-colors',
            activeTab === '7days'
              ? 'bg-primary/20 text-foreground'
              : 'text-muted-foreground hover:text-foreground',
          )}
        >
          7 Days
        </button>
        <button
          onClick={() => setActiveTab('30days')}
          className={cn(
            'flex-1 py-1.5 text-xs font-medium rounded-md cursor-pointer outline-none transition-colors',
            activeTab === '30days'
              ? 'bg-primary/20 text-foreground'
              : 'text-muted-foreground hover:text-foreground',
          )}
        >
          30 Days
        </button>
      </div>

      <div className="flex-1 px-5 py-4 space-y-3 overflow-y-auto">
        {activeTab === '7days' && dailyChartData.length > 0 && (
          <div className="glass-card p-3">
            <div className="text-xs font-medium text-muted-foreground mb-2">Daily Cost</div>
            <DailyBarChart data={dailyChartData} />
          </div>
        )}

        {activeTab === '30days' && (
          <div className="glass-card p-3">
            <div className="text-xs font-medium text-muted-foreground mb-2">
              {last30Days.length}
              {' '}
              Active Days Summary
            </div>
            <div className="grid grid-cols-3 gap-2 text-center">
              <div>
                <div className="text-lg font-semibold">{formatCost(totalCost30Days)}</div>
                <div className="text-[10px] text-muted-foreground">Total Cost</div>
              </div>
              <div>
                <div className="text-lg font-semibold">{formatTokens(totalTokens30Days)}</div>
                <div className="text-[10px] text-muted-foreground">Total Tokens</div>
              </div>
              <div>
                <div className="text-lg font-semibold">{formatCost(dailyAvg30Days)}</div>
                <div className="text-[10px] text-muted-foreground">Daily Avg</div>
              </div>
            </div>
          </div>
        )}

        {activeModels.length > 0 && (
          <div className="text-xs font-medium text-muted-foreground">
            Top Models
          </div>
        )}

        {activeModels.map((model) => {
          const percent = activeTotalCost > 0 ? (model.cost / activeTotalCost) * 100 : 0

          return (
            <div key={model.model} className="p-3 glass-card">
              <div className="flex items-center justify-between text-xs">
                <div className="flex items-center gap-2 overflow-hidden">
                  <ModelIcon model={model.model} className="w-4 h-4 shrink-0 text-muted-foreground" />
                  <span className="truncate font-medium" title={model.model}>{model.model}</span>
                </div>
                <div className="flex items-center gap-1.5 shrink-0">
                  <span className="font-semibold">{formatCost(model.cost)}</span>
                  <span className="text-[10px] text-muted-foreground w-8 text-right">
                    (
                    {Math.round(percent)}
                    %)
                  </span>
                </div>
              </div>
              <div className="mt-2 h-1.5 w-full bg-secondary/50 rounded-full overflow-hidden">
                <div
                  className="h-full rounded-full progress-gradient"
                  style={{ width: `${percent}%` }}
                />
              </div>
            </div>
          )
        })}

        {activeModels.length === 0 && (
          <div className="py-4 text-center text-muted-foreground">
            No usage data
          </div>
        )}
      </div>

      <div className="grid grid-cols-3 pb-2 glass border-t border-border/50">
        <button
          onClick={handleOpenDashboard}
          className="flex flex-col items-center justify-center gap-1 py-2.5 text-[10px] font-medium transition-colors cursor-pointer outline-none hover:bg-accent/50"
        >
          <LayoutDashboard className="w-4 h-4" />
          Dashboard
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
          Refresh
        </button>
        <button
          onClick={handleQuit}
          className="flex flex-col items-center justify-center gap-1 py-2.5 text-[10px] font-medium transition-colors cursor-pointer outline-none hover:bg-accent/50 hover:text-destructive"
        >
          <Power className="w-4 h-4" />
          Quit
        </button>
      </div>
    </div>
  )
}
