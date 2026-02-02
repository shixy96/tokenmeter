import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { deleteProvider, getProviders, saveProvider, testProvider } from '@/lib/api'

export function useProviders() {
  return useQuery({
    queryKey: ['providers'],
    queryFn: getProviders,
    staleTime: Infinity,
  })
}

export function useSaveProvider() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: saveProvider,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['providers'] })
    },
  })
}

export function useDeleteProvider() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: deleteProvider,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['providers'] })
    },
  })
}

export function useTestProvider() {
  return useMutation({
    mutationFn: testProvider,
  })
}
