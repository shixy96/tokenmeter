import type { DailyUsage, ModelUsage } from '@/types'
import { useQueryClient } from '@tanstack/react-query'
import { listen } from '@tauri-apps/api/event'
import {
  BarChart3,
  DollarSign,
  Moon,
  PieChart as PieChartIcon,
  RefreshCw,
  Sun,
  Zap,
} from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import {
  Bar,
  CartesianGrid,
  Cell,
  ComposedChart,
  Legend,
  Line,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { useRefreshState } from '@/hooks/useRefreshState'
import { useTheme } from '@/hooks/useTheme'
import { useRefreshUsage, useUsageData } from '@/hooks/useUsageData'
import { cn, getDailyTotalTokens } from '@/lib/utils'
import { formatCost, formatTokens } from '@/types'

const COLORS = [
  'var(--color-chart-1)',
  'var(--color-chart-2)',
  'var(--color-chart-3)',
  'var(--color-chart-4)',
  'var(--color-chart-5)',
]

type TimeRange = 7 | 30

function getTimeRangeButtonClass(isActive: boolean): string {
  return cn(
    'px-3 py-1 text-sm rounded-md transition-colors',
    isActive
      ? 'bg-background text-foreground shadow-sm'
      : 'text-muted-foreground hover:text-foreground',
  )
}

export function Dashboard() {
  const { data: usage, isLoading, isFetching, error } = useUsageData()
  const refreshMutation = useRefreshUsage()
  const isGlobalRefreshing = useRefreshState()
  const queryClient = useQueryClient()
  const { toggleTheme, isDark } = useTheme()
  const [timeRange, setTimeRange] = useState<TimeRange>(7)
  const { t } = useTranslation('dashboard')

  // Listen for preloaded data event from backend
  useEffect(() => {
    let unlisten: (() => void) | undefined

    async function setupListener() {
      unlisten = await listen('usage-preloaded', () => {
        queryClient.invalidateQueries({ queryKey: ['usage'] })
      })
    }

    setupListener().catch(() => {})

    return () => {
      unlisten?.()
    }
  }, [queryClient])

  // Filter data based on time range
  const filteredData = useMemo(() => {
    if (!usage)
      return null

    const now = new Date()
    const cutoffDate = new Date(now)
    cutoffDate.setDate(cutoffDate.getDate() - timeRange)
    const cutoffStr = cutoffDate.toISOString().split('T')[0]

    const dailyUsage = usage.dailyUsage.filter(d => d.date >= cutoffStr)

    // Recalculate model breakdown for the filtered period
    const modelMap = new Map<string, ModelUsage>()
    for (const day of dailyUsage) {
      for (const model of day.models) {
        const existing = modelMap.get(model.model)
        if (existing) {
          existing.cost += model.cost
          existing.inputTokens += model.inputTokens
          existing.outputTokens += model.outputTokens
        }
        else {
          modelMap.set(model.model, { ...model })
        }
      }
    }
    const modelBreakdown = Array.from(modelMap.values())
      .sort((a, b) => b.cost - a.cost)

    // Calculate totals for the period
    const periodTotals = dailyUsage.reduce(
      (acc, day) => {
        const dayTotalTokens = getDailyTotalTokens(day)
        return {
          cost: acc.cost + day.cost,
          inputTokens: acc.inputTokens + day.inputTokens,
          outputTokens: acc.outputTokens + day.outputTokens,
          totalTokens: acc.totalTokens + dayTotalTokens,
          cacheReadTokens: acc.cacheReadTokens + day.cacheReadInputTokens,
          cacheWriteTokens: acc.cacheWriteTokens + day.cacheCreationInputTokens,
        }
      },
      { cost: 0, inputTokens: 0, outputTokens: 0, totalTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 },
    )

    return {
      dailyUsage,
      modelBreakdown,
      periodTotals,
    }
  }, [usage, timeRange])

  if (isLoading) {
    return (
      <div className={cn('flex flex-col items-center justify-center h-screen gap-4', 'select-none')}>
        <RefreshCw className="w-12 h-12 animate-spin text-primary" />
        <div className="text-center">
          <p className="text-lg font-medium">{t('loading.title')}</p>
          <p className="text-sm text-muted-foreground">
            {t('loading.description')}
          </p>
        </div>
      </div>
    )
  }

  if (error) {
    const errorMessage = error.message || String(error)
    const isCcusageNotFound
      = errorMessage.includes('ccusage')
        && (errorMessage.includes('not found') || errorMessage.includes('command not found'))

    if (isCcusageNotFound) {
      return (
        <div className={cn('flex flex-col items-center justify-center h-screen gap-4 p-6', 'select-none')}>
          <p className="text-lg font-medium">{t('error.ccusageNotInstalled')}</p>
          <p className="text-sm text-muted-foreground text-center max-w-md">
            {t('error.ccusageDescription')}
          </p>
          <code className="bg-muted px-3 py-2 rounded text-sm select-text cursor-text">
            npm install -g ccusage
          </code>
          <Button onClick={() => refreshMutation.mutate()}>
            {t('error.retryAfterInstalling')}
          </Button>
        </div>
      )
    }

    return (
      <div className={cn('flex flex-col items-center justify-center h-screen gap-4 p-6', 'select-none')}>
        <p className="text-destructive">{t('error.loadFailed')}</p>
        <p className="text-sm text-muted-foreground text-center max-w-md">
          {errorMessage}
        </p>
        <Button onClick={() => refreshMutation.mutate()}>{t('common:retry')}</Button>
      </div>
    )
  }

  if (!usage || !filteredData)
    return null

  const isRefreshing = isGlobalRefreshing || refreshMutation.isPending || isFetching
  const { dailyUsage, modelBreakdown, periodTotals } = filteredData

  // Prepare chart data with tokens in millions for better display
  const chartData = dailyUsage.map((d: DailyUsage) => ({
    date: d.date,
    tokens: getDailyTotalTokens(d),
    cost: d.cost,
  }))

  return (
    <div className={cn('relative p-6 space-y-6', 'select-none')}>
      <div className="absolute inset-x-0 top-0 h-6" data-tauri-drag-region />
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">{t('title')}</h1>
          <p className="text-sm text-muted-foreground">{t('subtitle')}</p>
        </div>
        <div className="flex items-center gap-2">
          {/* Time Range Toggle */}
          <div className="flex rounded-lg border bg-muted p-1">
            <button
              type="button"
              onClick={() => setTimeRange(7)}
              className={getTimeRangeButtonClass(timeRange === 7)}
            >
              {t('timeRange.days7')}
            </button>
            <button
              type="button"
              onClick={() => setTimeRange(30)}
              className={getTimeRangeButtonClass(timeRange === 30)}
            >
              {t('timeRange.days30')}
            </button>
          </div>

          {/* Refresh Button */}
          <Button
            variant="outline"
            size="icon"
            onClick={() => refreshMutation.mutate()}
            disabled={isRefreshing}
          >
            <RefreshCw className={cn('w-4 h-4', isRefreshing && 'animate-spin')} />
          </Button>

          {/* Theme Toggle */}
          <Button
            variant="outline"
            size="icon"
            onClick={toggleTheme}
          >
            {isDark ? <Sun className="w-4 h-4" /> : <Moon className="w-4 h-4" />}
          </Button>
        </div>
      </div>

      {/* Stats Cards */}
      <div className="grid gap-4 md:grid-cols-2">
        {/* Cost Overview Card */}
        <Card className="border-primary/20">
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">{t('stats.costOverview')}</CardTitle>
            <DollarSign className="w-4 h-4 text-primary" />
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-bold text-primary">
              {formatCost(periodTotals.cost)}
            </div>
            <p className="text-xs text-muted-foreground mt-1">
              {t('stats.lastNDays', { days: timeRange })}
            </p>
          </CardContent>
        </Card>

        {/* Token Overview Card */}
        <Card className="border-primary/20">
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">{t('stats.tokenOverview')}</CardTitle>
            <Zap className="w-4 h-4 text-primary" />
          </CardHeader>
          <CardContent>
            <div className="flex items-baseline gap-2">
              <span className="text-3xl font-bold">{formatTokens(periodTotals.totalTokens)}</span>
              <span className="text-sm text-muted-foreground">{t('stats.totalTokens')}</span>
            </div>
            <div className="grid grid-cols-2 gap-x-4 gap-y-1 mt-3 text-sm">
              <div className="flex justify-between">
                <span className="text-muted-foreground">{t('stats.totalInput')}</span>
                <span>{formatTokens(periodTotals.inputTokens)}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">{t('stats.totalOutput')}</span>
                <span>{formatTokens(periodTotals.outputTokens)}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">{t('stats.cacheRead')}</span>
                <span>{formatTokens(periodTotals.cacheReadTokens)}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">{t('stats.cacheWrite')}</span>
                <span>{formatTokens(periodTotals.cacheWriteTokens)}</span>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Charts */}
      <div className="flex flex-wrap gap-4">
        {/* Usage Trend Chart */}
        <Card className="flex-[2] min-w-[400px]">
          <CardHeader className="pb-2">
            <div className="flex items-center gap-2">
              <BarChart3 className="w-4 h-4 text-muted-foreground" />
              <CardTitle className="text-base">{t('chart.usageTrend')}</CardTitle>
            </div>
            <p className="text-sm text-muted-foreground">{t('chart.usageTrendSubtitle')}</p>
          </CardHeader>
          <CardContent className="h-[300px]">
            <ResponsiveContainer width="100%" height="100%">
              <ComposedChart data={chartData}>
                <defs>
                  <linearGradient id="tokenBarGradient" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="var(--color-chart-1)" stopOpacity={0.9} />
                    <stop offset="100%" stopColor="var(--color-chart-1)" stopOpacity={0.4} />
                  </linearGradient>
                </defs>
                <CartesianGrid
                  strokeDasharray="3 3"
                  stroke="var(--color-border)"
                />
                <XAxis
                  dataKey="date"
                  tickFormatter={value => value.slice(5)}
                  fontSize={12}
                  stroke="var(--color-muted-foreground)"
                />
                <YAxis
                  yAxisId="left"
                  tickFormatter={value => formatTokens(value)}
                  fontSize={12}
                  stroke="var(--color-muted-foreground)"
                />
                <YAxis
                  yAxisId="right"
                  orientation="right"
                  tickFormatter={value => `$${value.toFixed(2)}`}
                  fontSize={12}
                  stroke="var(--color-muted-foreground)"
                />
                <Tooltip
                  contentStyle={{
                    backgroundColor: 'var(--color-popover)',
                    border: '1px solid var(--color-border)',
                    borderRadius: '8px',
                    color: 'var(--color-popover-foreground)',
                  }}
                  formatter={(value, name) => {
                    if (name === 'tokens')
                      return [formatTokens(Number(value)), t('chart.tokens')]
                    return [`$${Number(value).toFixed(4)}`, t('chart.cost')]
                  }}
                  labelFormatter={label => `${t('chart.date')}: ${label}`}
                  labelStyle={{ color: 'var(--color-popover-foreground)' }}
                />
                <Legend
                  verticalAlign="bottom"
                  height={36}
                  formatter={(value) => {
                    if (value === 'tokens')
                      return t('chart.tokens')
                    return t('chart.cost')
                  }}
                />
                <Bar
                  yAxisId="left"
                  dataKey="tokens"
                  fill="url(#tokenBarGradient)"
                  radius={[4, 4, 0, 0]}
                  name="tokens"
                />
                <Line
                  yAxisId="right"
                  type="monotone"
                  dataKey="cost"
                  stroke="#3b82f6"
                  strokeWidth={2}
                  dot={false}
                  name="cost"
                />
              </ComposedChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>

        {/* Model Distribution Chart */}
        <Card className="min-w-[280px] flex-1">
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <div className="flex items-center gap-2">
              <PieChartIcon className="w-4 h-4 text-muted-foreground" />
              <CardTitle className="text-base">{t('chart.modelDistribution')}</CardTitle>
            </div>
            <span className="text-sm text-muted-foreground">
              {t('chart.modelCount', { count: modelBreakdown.length })}
            </span>
          </CardHeader>
          <CardContent className="h-[300px]">
            {modelBreakdown.length > 0
              ? (
                  <div className="flex flex-col h-full gap-2">
                    {/* Donut Chart */}
                    <div className="flex-1 min-h-[160px]">
                      <ResponsiveContainer width="100%" height="100%">
                        <PieChart>
                          <Pie
                            data={modelBreakdown}
                            dataKey="cost"
                            nameKey="model"
                            cx="50%"
                            cy="50%"
                            innerRadius="40%"
                            outerRadius="80%"
                          >
                            {modelBreakdown.map((entry, index) => (
                              <Cell
                                key={entry.model}
                                fill={COLORS[index % COLORS.length]}
                              />
                            ))}
                          </Pie>
                          <Tooltip
                            contentStyle={{
                              backgroundColor: 'var(--color-popover)',
                              border: '1px solid var(--color-border)',
                              borderRadius: '8px',
                              color: 'var(--color-popover-foreground)',
                            }}
                            itemStyle={{
                              color: 'var(--color-popover-foreground)',
                            }}
                            formatter={value => [`$${Number(value).toFixed(4)}`, t('chart.cost')]}
                          />
                        </PieChart>
                      </ResponsiveContainer>
                    </div>
                    {/* Model List */}
                    <div className="flex-none max-h-[120px] overflow-y-auto space-y-2 pr-2">
                      {modelBreakdown.slice(0, 6).map((model, index) => (
                        <div
                          key={model.model}
                          className="flex items-center justify-between text-sm"
                        >
                          <div className="flex items-center gap-2 min-w-0">
                            <div
                              className="w-3 h-3 rounded-full shrink-0"
                              style={{ backgroundColor: COLORS[index % COLORS.length] }}
                            />
                            <span className="truncate text-muted-foreground" title={model.model}>
                              {model.model}
                            </span>
                          </div>
                          <span className="font-medium ml-2 shrink-0">
                            {formatCost(model.cost)}
                          </span>
                        </div>
                      ))}
                      {modelBreakdown.length > 6 && (
                        <div className="text-xs text-muted-foreground text-center pt-1">
                          {t('chart.otherModels', { count: modelBreakdown.length - 6 })}
                        </div>
                      )}
                    </div>
                  </div>
                )
              : (
                  <div className="flex items-center justify-center h-full text-muted-foreground">
                    {t('chart.noModelData')}
                  </div>
                )}
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
