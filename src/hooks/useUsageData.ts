import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { getConfig, getUsageSummary, refreshUsage, saveConfig } from '@/lib/api'

const MIN_REFRESH_INTERVAL = 60
const MAX_REFRESH_INTERVAL = 3600
const DEFAULT_REFRESH_INTERVAL = 900

export function useConfig() {
  return useQuery({
    queryKey: ['config'],
    queryFn: getConfig,
    staleTime: Infinity,
  })
}

export function useUsageData() {
  const { data: config } = useConfig()
  const rawInterval = config?.refreshInterval ?? DEFAULT_REFRESH_INTERVAL
  const clampedInterval = Math.max(MIN_REFRESH_INTERVAL, Math.min(MAX_REFRESH_INTERVAL, rawInterval))
  const refreshInterval = clampedInterval * 1000

  return useQuery({
    queryKey: ['usage'],
    queryFn: getUsageSummary,
    refetchInterval: refreshInterval,
    staleTime: 5 * 60 * 1000,
  })
}

export function useRefreshUsage() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: refreshUsage,
    onSuccess: (data) => {
      queryClient.setQueryData(['usage'], data)
    },
  })
}

export function useSaveConfig() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: saveConfig,
    onSuccess: (_, config) => {
      queryClient.setQueryData(['config'], config)
    },
  })
}
