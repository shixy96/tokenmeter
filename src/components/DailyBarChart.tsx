import { formatDateShort } from '@/lib/utils'
import { formatCost } from '@/types'

interface DailyBarChartProps {
  data: Array<{ date: string, cost: number }>
}

export function DailyBarChart({ data }: DailyBarChartProps): React.ReactElement {
  const maxCost = Math.max(...data.map(d => d.cost), 0)

  return (
    <div className="space-y-1.5">
      {data.map((day) => {
        const percent = maxCost > 0 ? (day.cost / maxCost) * 100 : 0

        return (
          <div key={day.date} className="flex items-center gap-2 text-xs">
            <span className="w-12 text-muted-foreground shrink-0">{formatDateShort(day.date)}</span>
            <div className="flex-1 h-2 bg-secondary/50 rounded-full overflow-hidden">
              <div
                className="h-full rounded-full progress-gradient transition-all"
                style={{ width: `${percent}%` }}
              />
            </div>
            <span className="w-14 text-right font-medium shrink-0">{formatCost(day.cost)}</span>
          </div>
        )
      })}
    </div>
  )
}
