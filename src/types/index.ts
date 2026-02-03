export interface UsageData {
  date: string
  cost: number
  inputTokens: number
  outputTokens: number
  cacheCreationInputTokens: number
  cacheReadInputTokens: number
  totalTokens: number
}

export interface ModelUsage {
  model: string
  cost: number
  inputTokens: number
  outputTokens: number
}

export interface DailyUsage {
  date: string
  cost: number
  inputTokens: number
  outputTokens: number
  cacheCreationInputTokens: number
  cacheReadInputTokens: number
  models: ModelUsage[]
}

export interface UsageSummary {
  today: UsageData
  thisMonth: UsageData
  dailyUsage: DailyUsage[]
  modelBreakdown: ModelUsage[]
}

export interface ApiProvider {
  id: string
  name: string
  enabled: boolean
  fetchScript: string
  transformScript: string
  env: Record<string, string>
  lastFetched?: string
  lastError?: string
}

export interface MenuBarConfig {
  format: string
  thresholdMode: 'fixed' | 'percentage'
  fixedBudget: number
  nearBudgetThresholdPercent: number
  showColorCoding: boolean
}

export interface AppConfig {
  refreshInterval: number
  launchAtLogin: boolean
  menuBar: MenuBarConfig
  language?: string
}

export type UsageLevel = 'low' | 'medium' | 'high' | 'critical'

export function getUsageLevel(cost: number, budget: number): UsageLevel {
  if (budget <= 0) {
    return 'low'
  }
  const percentage = (cost / budget) * 100

  if (percentage >= 90)
    return 'critical'
  if (percentage >= 75)
    return 'high'
  if (percentage >= 50)
    return 'medium'
  return 'low'
}

export function getUsageColor(level: UsageLevel): string {
  switch (level) {
    case 'low':
      return '#22c55e'
    case 'medium':
      return '#eab308'
    case 'high':
      return '#f97316'
    case 'critical':
      return '#ef4444'
  }
}

export function formatCost(cost: number): string {
  return `$${cost.toFixed(2)}`
}

export function formatTokens(tokens: number): string {
  if (tokens >= 1_000_000) {
    return `${(tokens / 1_000_000).toFixed(1)}M`
  }
  if (tokens >= 1_000) {
    return `${(tokens / 1_000).toFixed(1)}K`
  }
  return tokens.toString()
}
