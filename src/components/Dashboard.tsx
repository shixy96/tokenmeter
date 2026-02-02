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
import { useTheme } from '@/hooks/useTheme'
import { useRefreshUsage, useUsageData } from '@/hooks/useUsageData'
import { formatCost, formatTokens } from '@/types'

const COLORS = ['#3b82f6', '#22c55e', '#eab308', '#f97316', '#a855f7', '#06b6d4']

type TimeRange = 7 | 30

function getTimeRangeButtonClass(isActive: boolean): string {
  const base = 'px-3 py-1 text-sm rounded-md transition-colors'
  if (isActive) {
    return `${base} bg-background text-foreground shadow-sm`
  }
  return `${base} text-muted-foreground hover:text-foreground`
}

export function Dashboard() {
  const { data: usage, isLoading, isFetching, error } = useUsageData()
  const refreshMutation = useRefreshUsage()
  const queryClient = useQueryClient()
  const { toggleTheme, isDark } = useTheme()
  const [timeRange, setTimeRange] = useState<TimeRange>(7)

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
      (acc, day) => ({
        cost: acc.cost + day.cost,
        inputTokens: acc.inputTokens + day.inputTokens,
        outputTokens: acc.outputTokens + day.outputTokens,
        totalTokens: acc.totalTokens + day.inputTokens + day.outputTokens,
      }),
      { cost: 0, inputTokens: 0, outputTokens: 0, totalTokens: 0 },
    )

    return {
      dailyUsage,
      modelBreakdown,
      periodTotals,
    }
  }, [usage, timeRange])

  if (isLoading) {
    return (
      <div className="flex flex-col items-center justify-center h-screen gap-4">
        <RefreshCw className="w-12 h-12 animate-spin text-primary" />
        <div className="text-center">
          <p className="text-lg font-medium">Loading usage data...</p>
          <p className="text-sm text-muted-foreground">
            This may take up to 30 seconds on first load
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
        <div className="flex flex-col items-center justify-center h-screen gap-4 p-6">
          <p className="text-lg font-medium">ccusage not installed</p>
          <p className="text-sm text-muted-foreground text-center max-w-md">
            TokenMeter requires ccusage to fetch Claude usage data.
            Please install it first:
          </p>
          <code className="bg-muted px-3 py-2 rounded text-sm">
            npm install -g ccusage
          </code>
          <Button onClick={() => refreshMutation.mutate()}>
            Retry after installing
          </Button>
        </div>
      )
    }

    return (
      <div className="flex flex-col items-center justify-center h-screen gap-4 p-6">
        <p className="text-destructive">Failed to load usage data</p>
        <p className="text-sm text-muted-foreground text-center max-w-md">
          {errorMessage}
        </p>
        <Button onClick={() => refreshMutation.mutate()}>Retry</Button>
      </div>
    )
  }

  if (!usage || !filteredData)
    return null

  const isRefreshing = refreshMutation.isPending || isFetching
  const { dailyUsage, modelBreakdown, periodTotals } = filteredData

  // Calculate cache tokens from today's data
  const cacheReadTokens = usage.today.cacheReadInputTokens
  const cacheWriteTokens = usage.today.cacheCreationInputTokens

  // Prepare chart data with tokens in millions for better display
  const chartData = dailyUsage.map((d: DailyUsage) => ({
    date: d.date,
    tokens: d.inputTokens + d.outputTokens,
    cost: d.cost,
  }))

  return (
    <div className="relative p-6 space-y-6">
      <div className="absolute inset-x-0 top-0 h-6" data-tauri-drag-region />
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">使用统计</h1>
          <p className="text-sm text-muted-foreground">查看 API 使用情况和消费明细</p>
        </div>
        <div className="flex items-center gap-2">
          {/* Time Range Toggle */}
          <div className="flex rounded-lg border bg-muted p-1">
            <button
              type="button"
              onClick={() => setTimeRange(7)}
              className={getTimeRangeButtonClass(timeRange === 7)}
            >
              7天
            </button>
            <button
              type="button"
              onClick={() => setTimeRange(30)}
              className={getTimeRangeButtonClass(timeRange === 30)}
            >
              30天
            </button>
          </div>

          {/* Refresh Button */}
          <Button
            variant="outline"
            size="icon"
            onClick={() => refreshMutation.mutate()}
            disabled={isRefreshing}
          >
            <RefreshCw className={`w-4 h-4 ${isRefreshing ? 'animate-spin' : ''}`} />
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
            <CardTitle className="text-sm font-medium text-muted-foreground">费用概览</CardTitle>
            <DollarSign className="w-4 h-4 text-primary" />
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-bold text-primary">
              {formatCost(periodTotals.cost)}
            </div>
            <p className="text-xs text-muted-foreground mt-1">
              过去
              {' '}
              {timeRange}
              {' '}
              天总费用
            </p>
          </CardContent>
        </Card>

        {/* Token Overview Card */}
        <Card className="border-primary/20">
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">消耗概览</CardTitle>
            <Zap className="w-4 h-4 text-primary" />
          </CardHeader>
          <CardContent>
            <div className="flex items-baseline gap-2">
              <span className="text-3xl font-bold">{formatTokens(periodTotals.totalTokens)}</span>
              <span className="text-sm text-muted-foreground">总Token</span>
            </div>
            <div className="grid grid-cols-2 gap-x-4 gap-y-1 mt-3 text-sm">
              <div className="flex justify-between">
                <span className="text-muted-foreground">总输入</span>
                <span>{formatTokens(periodTotals.inputTokens)}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">总输出</span>
                <span>{formatTokens(periodTotals.outputTokens)}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">缓存读取</span>
                <span>{formatTokens(cacheReadTokens)}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">缓存写入</span>
                <span>{formatTokens(cacheWriteTokens)}</span>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Charts */}
      <div className="flex flex-wrap gap-4">
        {/* Usage Trend Chart */}
        <Card className="flex-1 min-w-[400px]">
          <CardHeader className="pb-2">
            <div className="flex items-center gap-2">
              <BarChart3 className="w-4 h-4 text-muted-foreground" />
              <CardTitle className="text-base">使用趋势</CardTitle>
            </div>
            <p className="text-sm text-muted-foreground">Token (柱状) vs 费用 (曲线)</p>
          </CardHeader>
          <CardContent className="h-[300px]">
            <ResponsiveContainer width="100%" height="100%">
              <ComposedChart data={chartData}>
                <CartesianGrid
                  strokeDasharray="3 3"
                  stroke={isDark ? 'hsl(216 34% 17%)' : 'hsl(214.3 31.8% 91.4%)'}
                />
                <XAxis
                  dataKey="date"
                  tickFormatter={value => value.slice(5)}
                  fontSize={12}
                  stroke={isDark ? 'hsl(215 20% 65%)' : 'hsl(215.4 16.3% 46.9%)'}
                />
                <YAxis
                  yAxisId="left"
                  tickFormatter={value => formatTokens(value)}
                  fontSize={12}
                  stroke={isDark ? 'hsl(215 20% 65%)' : 'hsl(215.4 16.3% 46.9%)'}
                />
                <YAxis
                  yAxisId="right"
                  orientation="right"
                  tickFormatter={value => `$${value.toFixed(2)}`}
                  fontSize={12}
                  stroke={isDark ? 'hsl(215 20% 65%)' : 'hsl(215.4 16.3% 46.9%)'}
                />
                <Tooltip
                  contentStyle={{
                    backgroundColor: isDark ? 'hsl(224 71% 4%)' : 'hsl(0 0% 100%)',
                    border: `1px solid ${isDark ? 'hsl(216 34% 17%)' : 'hsl(214.3 31.8% 91.4%)'}`,
                    borderRadius: '8px',
                  }}
                  formatter={(value, name) => {
                    if (name === 'tokens')
                      return [formatTokens(Number(value)), 'Token']
                    return [`$${Number(value).toFixed(4)}`, '费用']
                  }}
                  labelFormatter={label => `日期: ${label}`}
                />
                <Legend
                  verticalAlign="bottom"
                  height={36}
                  formatter={(value) => {
                    if (value === 'tokens')
                      return 'Token'
                    return '费用'
                  }}
                />
                <Bar
                  yAxisId="left"
                  dataKey="tokens"
                  fill="#6b7280"
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
              <CardTitle className="text-base">模型分布</CardTitle>
            </div>
            <span className="text-sm text-muted-foreground">
              共
              {' '}
              {modelBreakdown.length}
              {' '}
              个模型
            </span>
          </CardHeader>
          <CardContent className="h-[300px]">
            {modelBreakdown.length > 0
              ? (
                  <div className="flex h-full">
                    {/* Donut Chart */}
                    <div className="w-1/2">
                      <ResponsiveContainer width="100%" height="100%">
                        <PieChart>
                          <Pie
                            data={modelBreakdown}
                            dataKey="cost"
                            nameKey="model"
                            cx="50%"
                            cy="50%"
                            innerRadius="30%"
                            outerRadius="50%"
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
                              backgroundColor: isDark ? 'hsl(224 71% 4%)' : 'hsl(0 0% 100%)',
                              border: `1px solid ${isDark ? 'hsl(216 34% 17%)' : 'hsl(214.3 31.8% 91.4%)'}`,
                              borderRadius: '8px',
                            }}
                            itemStyle={{
                              color: isDark ? 'hsl(210 40% 98%)' : 'hsl(222.2 47.4% 11.2%)',
                            }}
                            formatter={value => [`$${Number(value).toFixed(4)}`, '费用']}
                          />
                        </PieChart>
                      </ResponsiveContainer>
                    </div>
                    {/* Model List */}
                    <div className="w-1/2 overflow-y-auto space-y-3 pr-2">
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
                              {model.model.length > 20 ? `${model.model.slice(0, 20)}...` : model.model}
                            </span>
                          </div>
                          <span className="font-medium ml-2">
                            {formatCost(model.cost)}
                          </span>
                        </div>
                      ))}
                      {modelBreakdown.length > 6 && (
                        <div className="text-xs text-muted-foreground text-center pt-2">
                          +
                          {modelBreakdown.length - 6}
                          {' '}
                          个其他模型
                        </div>
                      )}
                    </div>
                  </div>
                )
              : (
                  <div className="flex items-center justify-center h-full text-muted-foreground">
                    No model data available
                  </div>
                )}
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
