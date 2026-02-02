import type { ApiProvider, AppConfig, UsageSummary } from '@/types'
import { invoke } from '@tauri-apps/api/core'

export async function getUsageSummary(): Promise<UsageSummary> {
  return invoke<UsageSummary>('get_usage_summary')
}

export async function refreshUsage(): Promise<UsageSummary> {
  return invoke<UsageSummary>('refresh_usage')
}

export async function getConfig(): Promise<AppConfig> {
  return invoke<AppConfig>('get_config')
}

export async function saveConfig(config: AppConfig): Promise<void> {
  return invoke('save_config', { config })
}

export async function getProviders(): Promise<ApiProvider[]> {
  return invoke<ApiProvider[]>('get_providers')
}

export async function saveProvider(provider: ApiProvider): Promise<void> {
  return invoke('save_provider', { provider })
}

export async function deleteProvider(id: string): Promise<void> {
  return invoke('delete_provider', { id })
}

export interface TestProviderResult {
  success: boolean
  data?: Record<string, unknown>
  error?: string
}

export async function testProvider(provider: ApiProvider): Promise<TestProviderResult> {
  return invoke('test_provider', { provider })
}

export async function openDashboard(): Promise<void> {
  return invoke('open_dashboard')
}

export async function openSettings(): Promise<void> {
  return invoke('open_settings')
}

export async function setLaunchAtLogin(enabled: boolean): Promise<void> {
  return invoke('set_launch_at_login', { enabled })
}
