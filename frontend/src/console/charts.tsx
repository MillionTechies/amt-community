/** Small charts for the console. One series each, in A Million Techies green. */
import { useState } from 'react'

const dayKey = (d: Date) => `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`
const short = new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short' })

/** Counts per day, from the first date (at most 30 days back) to today. Hover a bar for its count. */
export function DailyBars({ dates, noun }: { dates: string[]; noun: string }) {
  const [hover, setHover] = useState<number | null>(null)
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  const earliest = new Date(Math.min(...dates.map((d) => new Date(d).getTime())))
  earliest.setHours(0, 0, 0, 0)
  const span = Math.min(30, Math.max(7, Math.round((today.getTime() - earliest.getTime()) / 86_400_000) + 1))
  const days = Array.from({ length: span }, (_, i) => {
    const d = new Date(today)
    d.setDate(today.getDate() - (span - 1 - i))
    return d
  })
  const counts = new Map<string, number>()
  for (const iso of dates) {
    const k = dayKey(new Date(iso))
    counts.set(k, (counts.get(k) ?? 0) + 1)
  }
  const values = days.map((d) => counts.get(dayKey(d)) ?? 0)
  const max = Math.max(1, ...values)
  const total = values.reduce((a, b) => a + b, 0)
  const plural = (n: number) => `${n} ${noun}${n === 1 ? '' : 's'}`

  return (
    <figure>
      <figcaption className="mb-3 text-sm text-stone-600">
        {plural(total)} in the last {span} days{total < dates.length && `, ${plural(dates.length)} in all`}.
      </figcaption>
      <div className="relative">
        {/* Recessive guide lines at the top value and the midpoint. */}
        <div className="pointer-events-none absolute inset-x-0 top-0 border-t border-dashed border-stone-200" />
        <div className="pointer-events-none absolute inset-x-0 top-1/2 border-t border-dashed border-stone-100" />
        <span className="absolute -top-2 right-0 bg-white pl-1 text-[11px] tabular-nums text-stone-400">{max}</span>
        <div className="flex h-36 items-end gap-0.5 border-b border-stone-300 pr-6" onMouseLeave={() => setHover(null)}>
          {values.map((v, i) => (
            <div
              key={i}
              className="relative flex h-full flex-1 items-end"
              onMouseEnter={() => setHover(i)}
              onFocus={() => setHover(i)}
              onBlur={() => setHover(null)}
              tabIndex={0}
              aria-label={`${short.format(days[i])}: ${plural(v)}`}
            >
              <div
                className={`w-full rounded-t ${hover === i ? 'bg-brand-700' : 'bg-brand-600'}`}
                style={{ height: v ? `${(v / max) * 100}%` : 0, minHeight: v ? 3 : 0 }}
              />
              {hover === i && (
                <div className="pointer-events-none absolute bottom-full left-1/2 z-10 mb-2 -translate-x-1/2 whitespace-nowrap rounded-md bg-ink px-2 py-1 text-xs text-white shadow">
                  <span className="font-semibold tabular-nums">{plural(v)}</span>
                  <span className="text-white/70"> · {short.format(days[i])}</span>
                </div>
              )}
            </div>
          ))}
        </div>
        <div className="mt-1.5 flex justify-between pr-6 text-[11px] text-stone-500">
          <span>{short.format(days[0])}</span>
          <span>Today</span>
        </div>
      </div>
      <table className="sr-only">
        <caption>{noun}s per day</caption>
        <thead><tr><th>Day</th><th>Count</th></tr></thead>
        <tbody>
          {values.map((v, i) => <tr key={i}><td>{short.format(days[i])}</td><td>{v}</td></tr>)}
        </tbody>
      </table>
    </figure>
  )
}
