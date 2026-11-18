/** Building blocks for the organiser console: access, page headers, KPI tiles, meters and tables. */
import type { ReactNode } from 'react'
import { Link } from 'react-router-dom'

import { Icon } from '../components/icons'
import type { IconName } from '../components/icons'
import { useMe } from '../hooks'

/** What the signed-in member may run, across all their organisations. */
export function useAccess() {
  const me = useMe()
  const orgs = me?.organizations ?? []
  const platform = me?.is_platform_admin ?? false
  const events = platform || orgs.some((o) => o.can_manage_events)
  const hackathons = platform || orgs.some((o) => o.can_manage_hackathons)
  const team = platform || orgs.some((o) => o.is_admin)
  const any = events || hackathons || team
  const managed = new Set(orgs.flatMap((o) => o.roles))
  const role = platform
    ? 'Platform admin'
    : orgs.some((o) => o.is_admin)
      ? 'Organisation admin'
      : managed.size > 1
        ? 'Event organiser and hackathon manager'
        : managed.has('hackathon_manager')
          ? 'Hackathon manager'
          : managed.has('event_organiser')
            ? 'Event organiser'
            : 'Member'
  return { me, loaded: !!me, events, hackathons, team, platform, any, role }
}

export function ConsoleHeader({
  title,
  subtitle,
  actions,
}: {
  title: ReactNode
  subtitle?: ReactNode
  actions?: ReactNode
}) {
  return (
    <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
      <div className="min-w-0">
        <h1 className="text-2xl font-bold tracking-tight">{title}</h1>
        {subtitle && <div className="mt-1 text-sm text-stone-600">{subtitle}</div>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  )
}

/** A headline number with what it counts, and an optional note or link under it. */
export function Kpi({
  label,
  value,
  icon,
  note,
  to,
}: {
  label: string
  value: ReactNode
  icon: IconName
  note?: ReactNode
  to?: string
}) {
  const body = (
    <>
      <div className="flex items-center justify-between gap-2">
        <span className="text-sm font-medium text-stone-600">{label}</span>
        <span className="grid h-8 w-8 place-items-center rounded-lg bg-brand-50 text-brand-700">
          <Icon name={icon} className="h-4 w-4" />
        </span>
      </div>
      <div className="mt-3 text-3xl font-bold tabular-nums tracking-tight">{value}</div>
      {note && <div className="mt-1 text-xs text-stone-500">{note}</div>}
    </>
  )
  const style = 'block rounded-xl border border-stone-200 bg-white p-4 shadow-sm'
  return to ? (
    <Link to={to} className={`${style} transition hover:border-brand-500`}>{body}</Link>
  ) : (
    <div className={style}>{body}</div>
  )
}

/**
 * How full something is: a green fill on a lighter green track. With `warn`, used for
 * capacity, it turns amber once past 90%.
 */
export function Meter({ value, max, label, warn = false }: { value: number; max: number; label: string; warn?: boolean }) {
  const share = max > 0 ? Math.min(1, value / max) : 0
  const tight = warn && share >= 0.9
  const tone = tight ? 'bg-amber-500' : 'bg-brand-600'
  const track = tight ? 'bg-amber-100' : 'bg-brand-100'
  return (
    <div
      role="meter"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={max}
      aria-valuenow={value}
      className={`h-2 w-full overflow-hidden rounded-full ${track}`}
    >
      <div className={`h-full rounded-full ${tone}`} style={{ width: `${share * 100}%` }} />
    </div>
  )
}

/** A white panel with a title row, for console pages. */
export function Panel({
  title,
  action,
  children,
  flush = false,
}: {
  title: ReactNode
  action?: ReactNode
  children: ReactNode
  /** Let a table run edge to edge. */
  flush?: boolean
}) {
  return (
    <section className="overflow-hidden rounded-xl border border-stone-200 bg-white shadow-sm">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-stone-200 px-5 py-3">
        <h2 className="font-semibold">{title}</h2>
        {action}
      </div>
      <div className={flush ? '' : 'p-5'}>{children}</div>
    </section>
  )
}

export const table = {
  wrap: 'overflow-x-auto',
  table: 'w-full min-w-[40rem] text-left text-sm',
  head: 'border-b border-stone-200 bg-stone-50 text-xs font-semibold uppercase tracking-wide text-stone-500',
  th: 'px-5 py-2.5 font-semibold',
  row: 'border-b border-stone-100 last:border-0 hover:bg-stone-50',
  td: 'px-5 py-3 align-middle',
}

/** Status filter chips with counts, for list pages. */
export function FilterChips<T extends string>({
  options,
  current,
  onChange,
}: {
  options: { id: T; label: string; count?: number }[]
  current: T
  onChange: (id: T) => void
}) {
  return (
    <div className="flex flex-wrap gap-1.5" role="tablist">
      {options.map((o) => (
        <button
          key={o.id}
          type="button"
          role="tab"
          aria-selected={o.id === current}
          onClick={() => onChange(o.id)}
          className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-sm font-medium transition ${
            o.id === current
              ? 'border-ink bg-ink text-white'
              : 'border-stone-300 bg-white text-stone-700 hover:border-stone-400'
          }`}
        >
          {o.label}
          {o.count !== undefined && (
            <span className={`tabular-nums text-xs ${o.id === current ? 'text-white/70' : 'text-stone-500'}`}>{o.count}</span>
          )}
        </button>
      ))}
    </div>
  )
}

/** "in 3 days", "tomorrow", "2 weeks ago". */
export function relative(iso: string) {
  const days = Math.round((new Date(iso).getTime() - Date.now()) / 86_400_000)
  if (days === 0) return 'today'
  if (days === 1) return 'tomorrow'
  if (days === -1) return 'yesterday'
  const abs = Math.abs(days)
  const span = abs < 14 ? `${abs} days` : abs < 60 ? `${Math.round(abs / 7)} weeks` : `${Math.round(abs / 30)} months`
  return days > 0 ? `in ${span}` : `${span} ago`
}
