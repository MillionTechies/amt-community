/** Small building blocks shared by every page. */
import type { ComponentProps, ReactNode, SelectHTMLAttributes, TextareaHTMLAttributes } from 'react'
import { Link } from 'react-router-dom'

const cx = (...parts: (string | false | undefined | null)[]) => parts.filter(Boolean).join(' ')

type Variant = 'primary' | 'secondary' | 'danger' | 'ghost'
// House style: mono, uppercase button text; primary buttons carry a ">" prompt (see index.css).
const variants: Record<Variant, string> = {
  primary: 'btn-prompt bg-brand-600 text-white shadow-[inset_0_-2px_0_rgb(0_0_0/0.18)] hover:bg-brand-700',
  secondary: 'bg-white text-ink border border-stone-300 hover:border-ink hover:bg-stone-50',
  danger: 'bg-white text-red-700 border border-red-200 hover:border-red-400 hover:bg-red-50',
  ghost: 'text-brand-700 hover:bg-brand-50',
}
const buttonBase =
  'inline-flex items-center justify-center gap-2 rounded-lg px-4 py-2 font-mono text-[0.8125rem] font-semibold uppercase tracking-[0.06em] transition disabled:cursor-not-allowed disabled:opacity-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-600'

export function Button({
  variant = 'primary',
  className,
  ...props
}: ComponentProps<'button'> & { variant?: Variant }) {
  return <button type="button" {...props} className={cx(buttonBase, variants[variant], className)} />
}

export function LinkButton({
  to,
  variant = 'primary',
  children,
}: {
  to: string
  variant?: Variant
  children: ReactNode
}) {
  return (
    <Link to={to} className={cx(buttonBase, variants[variant])}>
      {children}
    </Link>
  )
}

export function Card({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div className={cx('rounded-xl border border-stone-200 bg-white p-5 shadow-[0_1px_0_rgb(0_0_0/0.03)]', className)}>
      {children}
    </div>
  )
}

export function Section({
  title,
  action,
  children,
}: {
  title: string
  action?: ReactNode
  children: ReactNode
}) {
  return (
    <Card>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-lg font-semibold">{title}</h2>
        {action}
      </div>
      {children}
    </Card>
  )
}

const tones: Record<string, string> = {
  green: 'bg-brand-100 text-brand-800',
  amber: 'bg-amber-100 text-amber-800',
  red: 'bg-red-100 text-red-800',
  blue: 'bg-sky-100 text-sky-800',
  grey: 'bg-stone-200 text-stone-700',
}
const statusTone: Record<string, string> = {
  draft: 'grey',
  published: 'green',
  judging: 'amber',
  completed: 'blue',
  cancelled: 'red',
  registered: 'green',
  waitlisted: 'amber',
}
const statusLabel: Record<string, string> = { published: 'Open' }

export function Badge({ children, tone = 'grey' }: { children: ReactNode; tone?: string }) {
  return (
    <span className={cx('inline-block rounded-md px-2 py-0.5 font-mono text-[0.6875rem] font-semibold uppercase tracking-wider', tones[tone])}>
      {children}
    </span>
  )
}

export function StatusBadge({ status }: { status: string }) {
  return <Badge tone={statusTone[status] ?? 'grey'}>{statusLabel[status] ?? label(status)}</Badge>
}

/** "in_person" -> "In person" */
export function label(value: string) {
  const text = value.replace(/_/g, ' ')
  return text.charAt(0).toUpperCase() + text.slice(1)
}

export function PageHeader({
  title,
  subtitle,
  action,
  eyebrow,
}: {
  title: string
  subtitle?: ReactNode
  action?: ReactNode
  /** A short mono label above the title, shown as "// eyebrow". */
  eyebrow?: string
}) {
  return (
    <div className="mb-6 flex flex-wrap items-end justify-between gap-3">
      <div>
        {eyebrow && <p className="eyebrow mb-2">{eyebrow}</p>}
        <h1 className="text-2xl font-bold tracking-tight sm:text-3xl">{title}</h1>
        {subtitle && <p className="mt-1 text-stone-600">{subtitle}</p>}
      </div>
      {action}
    </div>
  )
}

export function Spinner() {
  return (
    <div className="flex justify-center py-16" role="status" aria-label="Loading">
      <div className="h-8 w-8 animate-spin rounded-full border-4 border-brand-200 border-t-brand-600" />
    </div>
  )
}

export function ErrorNote({ error }: { error: unknown }) {
  if (!error) return null
  const message = error instanceof Error ? error.message : String(error)
  return (
    <p role="alert" className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">
      {message}
    </p>
  )
}

export function Notice({ children, tone = 'green' }: { children: ReactNode; tone?: 'green' | 'amber' }) {
  const style =
    tone === 'green'
      ? 'border-brand-200 bg-brand-50 text-brand-900'
      : 'border-amber-200 bg-amber-50 text-amber-900'
  return <p className={cx('rounded-lg border px-3 py-2 text-sm', style)}>{children}</p>
}

export function Empty({ children }: { children: ReactNode }) {
  return (
    <div className="rounded-xl border border-dashed border-stone-300 px-6 py-12 text-center text-stone-600">
      {children}
    </div>
  )
}

const inputStyle =
  'w-full rounded-lg border border-stone-300 bg-white px-3 py-2 text-sm shadow-sm focus:border-brand-600 focus:outline-none focus:ring-2 focus:ring-brand-200'

export function Field({
  label: text,
  hint,
  error,
  children,
  group = false,
  required = false,
}: {
  label: string
  hint?: string
  error?: string
  children: ReactNode
  /** For a control with several parts (like the rich text editor), which cannot sit in a <label>. */
  group?: boolean
  /** Mark the field as one that must be filled in, with a red asterisk. */
  required?: boolean
}) {
  const caption = (
    <span className="mb-1.5 block font-mono text-xs font-semibold uppercase tracking-wider text-stone-700">
      {text}
      {required && <span aria-hidden="true" className="ml-0.5 text-red-600">*</span>}
    </span>
  )
  return (
    <div>
      {group ? (
        <div role="group" aria-label={text}>{caption}{children}</div>
      ) : (
        <label className="block">{caption}{children}</label>
      )}
      {hint && !error && <p className="mt-1 text-xs text-stone-500">{hint}</p>}
      {error && <p role="alert" className="mt-1 text-xs text-red-700">{error}</p>}
    </div>
  )
}

export function Input(props: ComponentProps<'input'>) {
  return <input {...props} className={cx(inputStyle, props.className)} />
}

export function Textarea(props: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea rows={4} {...props} className={cx(inputStyle, props.className)} />
}

export function Select(props: SelectHTMLAttributes<HTMLSelectElement>) {
  return <select {...props} className={cx(inputStyle, props.className)} />
}

export function Tabs<T extends string>({
  tabs,
  current,
  onChange,
}: {
  tabs: { id: T; label: string }[]
  current: T
  onChange: (tab: T) => void
}) {
  return (
    <div className="mb-6 flex gap-1 overflow-x-auto border-b border-stone-200" role="tablist">
      {tabs.map((tab) => (
        <button
          key={tab.id}
          type="button"
          role="tab"
          aria-selected={tab.id === current}
          onClick={() => onChange(tab.id)}
          className={cx(
            '-mb-px whitespace-nowrap border-b-2 px-4 py-2 font-mono text-xs font-semibold uppercase tracking-wider',
            tab.id === current
              ? 'border-brand-600 text-brand-700'
              : 'border-transparent text-stone-600 hover:text-ink',
          )}
        >
          {tab.label}
        </button>
      ))}
    </div>
  )
}

export function Stat({ label: text, value }: { label: string; value: ReactNode }) {
  return (
    <div className="rounded-xl border border-stone-200 bg-white p-4">
      <div className="font-mono text-2xl font-bold tabular-nums tracking-tight">{value}</div>
      <div className="mt-1 text-sm text-stone-600">{text}</div>
    </div>
  )
}

/** Text typed by organisers: keep their line breaks. */
export function Prose({ children }: { children: string }) {
  return <p className="whitespace-pre-line text-stone-700">{children}</p>
}

// --- dates -------------------------------------------------------------------

const dateFormat = new Intl.DateTimeFormat('en-GB', { dateStyle: 'medium' })
const dateTimeFormat = new Intl.DateTimeFormat('en-GB', { dateStyle: 'medium', timeStyle: 'short' })
const timeFormat = new Intl.DateTimeFormat('en-GB', { timeStyle: 'short' })

export const formatDate = (iso: string) => dateFormat.format(new Date(iso))
export const formatDateTime = (iso: string) => dateTimeFormat.format(new Date(iso))

/** "12 Dec 2026, 09:00 to 12:00", or both dates when it spans days. */
export function formatRange(start: string, end: string) {
  const [a, b] = [new Date(start), new Date(end)]
  return a.toDateString() === b.toDateString()
    ? `${dateTimeFormat.format(a)} to ${timeFormat.format(b)}`
    : `${dateTimeFormat.format(a)} to ${dateTimeFormat.format(b)}`
}

/** ISO timestamp -> value for <input type="datetime-local">, in the browser's time zone. */
export function toLocalInput(iso: string | null | undefined) {
  if (!iso) return ''
  const d = new Date(iso)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
}

export const fromLocalInput = (value: string) => (value ? new Date(value).toISOString() : null)
