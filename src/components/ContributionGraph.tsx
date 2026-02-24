import type { DailyUsage } from '@/types'
import { Calendar } from 'lucide-react'
import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip'
import { cn, getDailyTotalTokens } from '@/lib/utils'
import { formatTokens } from '@/types'

interface ContributionGraphProps {
  data: DailyUsage[]
}

const MAX_WEEKS = 54

export function ContributionGraph({ data }: ContributionGraphProps) {
  const { t } = useTranslation('dashboard')
  const todayStr = useMemo(() => new Date().toDateString(), [])
  const cellSize = 10
  const cellGap = 3

  const { weeks, months, maxTokens } = useMemo(() => {
    const dataMap = new Map<string, DailyUsage>()
    data.forEach((d) => {
      dataMap.set(d.date, d)
    })

    const today = new Date()
    const endDate = new Date(today)

    const startDate = new Date(endDate)
    startDate.setDate(startDate.getDate() - (52 * 7))

    // Adjust start date to Sunday so weeks align nicely
    const dayOfWeek = startDate.getDay()
    startDate.setDate(startDate.getDate() - dayOfWeek)

    const weeks: { date: Date, usage?: DailyUsage }[][] = []
    let currentWeek: { date: Date, usage?: DailyUsage }[] = []

    const currentDate = new Date(startDate)
    let maxTokens = 0

    while (currentDate <= endDate) { // eslint-disable-line no-unmodified-loop-condition -- Date object is mutated via setDate()
      // Use local date string to match backend DailyUsage.date format (YYYY-MM-DD)
      const year = currentDate.getFullYear()
      const month = String(currentDate.getMonth() + 1).padStart(2, '0')
      const dayStr = String(currentDate.getDate()).padStart(2, '0')
      const dateStr = `${year}-${month}-${dayStr}`

      const usage = dataMap.get(dateStr)

      if (usage) {
        const total = getDailyTotalTokens(usage)
        if (total > maxTokens)
          maxTokens = total
      }

      currentWeek.push({
        date: new Date(currentDate),
        usage,
      })

      if (currentWeek.length === 7) {
        weeks.push(currentWeek)
        currentWeek = []
      }

      currentDate.setDate(currentDate.getDate() + 1)

      if (weeks.length > MAX_WEEKS)
        break
    }

    // Push remaining incomplete week
    if (currentWeek.length > 0) {
      weeks.push(currentWeek)
    }

    const months: { label: string, index: number }[] = []
    weeks.forEach((week, i) => {
      const firstDay = week[0].date
      const prevWeek = weeks[i - 1]
      if (!prevWeek) {
        months.push({ label: firstDay.toLocaleString('default', { month: 'short' }), index: i })
      }
      else {
        const prevMonth = prevWeek[0].date.getMonth()
        const currMonth = firstDay.getMonth()
        if (currMonth !== prevMonth) {
          months.push({ label: firstDay.toLocaleString('default', { month: 'short' }), index: i })
        }
      }
    })

    return { weeks, months, maxTokens }
  }, [data])

  const getIntensityClass = (tokens: number) => {
    if (tokens === 0 || maxTokens === 0)
      return 'bg-muted'

    const ratio = tokens / maxTokens
    if (ratio <= 0.25)
      return 'bg-emerald-200 dark:bg-emerald-900'
    if (ratio <= 0.50)
      return 'bg-emerald-400 dark:bg-emerald-700'
    if (ratio <= 0.75)
      return 'bg-emerald-600 dark:bg-emerald-500'
    return 'bg-emerald-800 dark:bg-emerald-300'
  }

  return (
    <Card>
      <CardHeader className="pb-2">
        <div className="flex items-center gap-2">
          <Calendar className="w-4 h-4 text-muted-foreground" />
          <CardTitle className="text-base">{t('chart.yearlyActivity')}</CardTitle>
        </div>
      </CardHeader>
      <CardContent>
        <div className="flex flex-col gap-2 overflow-x-auto pb-2">
          {/* Month Labels */}
          <div className="flex text-xs text-muted-foreground h-5 relative">
            {months.map(month => (
              <span
                key={`${month.label}-${month.index}`}
                className="absolute"
                style={{ left: `${month.index * (cellSize + cellGap)}px` }}
              >
                {month.label}
              </span>
            ))}
          </div>

          <div className="flex gap-[3px]">
            {/* Day Labels */}
            <div className="flex flex-col gap-[3px] text-[10px] text-muted-foreground pr-2">
              <div className="h-[10px]"></div>
              <div className="h-[10px] leading-[10px]">{t('chart.weekdays.mon')}</div>
              <div className="h-[10px]"></div>
              <div className="h-[10px] leading-[10px]">{t('chart.weekdays.wed')}</div>
              <div className="h-[10px]"></div>
              <div className="h-[10px] leading-[10px]">{t('chart.weekdays.fri')}</div>
              <div className="h-[10px]"></div>
            </div>

            {/* Grid */}
            <TooltipProvider delayDuration={0} skipDelayDuration={0}>
              <div className="flex gap-[3px]">
                {weeks.map(week => (
                  <div key={week[0].date.toISOString()} className="flex flex-col gap-[3px]">
                    {week.map((day) => {
                      const totalTokens = day.usage ? getDailyTotalTokens(day.usage) : 0
                      return (
                        <Tooltip key={day.date.toISOString()}>
                          <TooltipTrigger asChild>
                            <div
                              className={cn(
                                'w-[10px] h-[10px] rounded-[2px] transition-colors',
                                getIntensityClass(totalTokens),
                                day.date.toDateString() === todayStr && 'ring-1 ring-primary ring-offset-1',
                              )}
                            />
                          </TooltipTrigger>
                          <TooltipContent>
                            <div className="text-xs">
                              <div className="font-semibold mb-1">
                                {day.date.toLocaleDateString(undefined, {
                                  weekday: 'long',
                                  year: 'numeric',
                                  month: 'long',
                                  day: 'numeric',
                                })}
                              </div>
                              {day.usage
                                ? (
                                    <>
                                      <div>
                                        {t('chart.tokens')}
                                        :
                                        {' '}
                                        {formatTokens(totalTokens)}
                                      </div>
                                      <div>
                                        {t('chart.cost')}
                                        : $
                                        {day.usage.cost.toFixed(4)}
                                      </div>
                                    </>
                                  )
                                : (
                                    <div className="text-muted-foreground">{t('chart.noData')}</div>
                                  )}
                            </div>
                          </TooltipContent>
                        </Tooltip>
                      )
                    })}
                  </div>
                ))}
              </div>
            </TooltipProvider>
          </div>

          {/* Legend */}
          <div className="flex items-center justify-end gap-2 text-xs text-muted-foreground mt-2">
            <span>{t('chart.less')}</span>
            <div className="flex gap-1">
              <div className="w-[10px] h-[10px] rounded-[2px] bg-muted" />
              <div className="w-[10px] h-[10px] rounded-[2px] bg-emerald-200 dark:bg-emerald-900" />
              <div className="w-[10px] h-[10px] rounded-[2px] bg-emerald-400 dark:bg-emerald-700" />
              <div className="w-[10px] h-[10px] rounded-[2px] bg-emerald-600 dark:bg-emerald-500" />
              <div className="w-[10px] h-[10px] rounded-[2px] bg-emerald-800 dark:bg-emerald-300" />
            </div>
            <span>{t('chart.more')}</span>
          </div>
        </div>
      </CardContent>
    </Card>
  )
}
