import type { ClassValue } from 'clsx'
import type { DailyUsage } from '@/types'
import { clsx } from 'clsx'
import { twMerge } from 'tailwind-merge'

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

export function formatDateShort(dateStr: string): string {
  // Parse YYYY-MM-DD as local date to avoid timezone issues
  const [year, month, day] = dateStr.split('-').map(Number)
  const date = new Date(year, month - 1, day)
  const days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
  const dayName = days[date.getDay()]
  const dayNum = date.getDate().toString().padStart(2, '0')
  return `${dayNum} ${dayName}`
}

/**
 * Normalize date string to YYYY-MM-DD format
 */
export function normalizeDate(dateStr: string): string {
  if (/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) {
    return dateStr
  }

  const date = new Date(dateStr)
  if (Number.isNaN(date.getTime())) {
    console.warn(`[normalizeDate] Invalid date: ${dateStr}`)
    return dateStr
  }

  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

/**
 * Convert YYYY-MM-DD date string to timestamp (local time)
 */
export function parseDateToTimestamp(dateStr: string): number {
  const parts = dateStr.split('-')
  if (parts.length !== 3) {
    console.warn(`[parseDateToTimestamp] Invalid format: ${dateStr}`)
    return 0
  }
  const [year, month, day] = parts.map(Number)
  if (Number.isNaN(year) || Number.isNaN(month) || Number.isNaN(day)) {
    console.warn(`[parseDateToTimestamp] Invalid date parts: ${dateStr}`)
    return 0
  }
  return new Date(year, month - 1, day).getTime()
}

/**
 * Sort array by date in descending order (newest first)
 * Uses Schwartzian transform for better performance
 */
export function sortByDateDesc<T extends { date: string }>(items: T[]): T[] {
  return items
    .map(item => ({
      item,
      timestamp: parseDateToTimestamp(normalizeDate(item.date)),
    }))
    .sort((a, b) => b.timestamp - a.timestamp)
    .map(({ item }) => item)
}

/**
 * Validate DailyUsage data structure (dev only)
 */
export function validateDailyUsage(data: { date: string, models?: unknown[] }[]): boolean {
  if (!Array.isArray(data)) {
    console.warn('[validateDailyUsage] Data is not an array:', data)
    return false
  }

  let isValid = true
  for (const [index, item] of data.entries()) {
    if (!item.date) {
      console.warn(`[validateDailyUsage] Missing date at index ${index}:`, item)
      isValid = false
    }
    if (!Array.isArray(item.models)) {
      console.warn(`[validateDailyUsage] Missing models at index ${index}:`, item)
      isValid = false
    }
  }

  return isValid
}

/**
 * Sum all token categories for a DailyUsage entry.
 */
export function getDailyTotalTokens(
  day: Pick<DailyUsage, 'inputTokens' | 'outputTokens' | 'cacheCreationInputTokens' | 'cacheReadInputTokens'>,
): number {
  return (
    day.inputTokens
    + day.outputTokens
    + day.cacheCreationInputTokens
    + day.cacheReadInputTokens
  )
}
