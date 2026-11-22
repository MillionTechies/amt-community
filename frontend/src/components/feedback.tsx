/**
 * In-app confirmations and notifications, in place of the browser's confirm/alert/prompt.
 *
 *   const confirm = useConfirm()
 *   if (await confirm({ title: 'Delete this draft?', confirmLabel: 'Delete', tone: 'danger' })) ...
 *
 *   const toast = useToast()
 *   toast({ title: 'Hackathon published', message: 'Teams can now sign up.' })
 */
import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react'
import type { ReactNode } from 'react'

import { Icon } from './icons'
import type { IconName } from './icons'
import { Button, Input } from './ui'

type Tone = 'danger' | 'warning' | 'primary'

export interface ConfirmOptions {
  title: string
  message?: ReactNode
  confirmLabel?: string
  cancelLabel?: string
  tone?: Tone
  icon?: IconName
}

export interface PromptOptions extends Omit<ConfirmOptions, 'tone'> {
  label: string
  initial?: string
  placeholder?: string
  type?: string
}

type ToastTone = 'success' | 'error' | 'info'

export interface ToastOptions {
  title: string
  message?: ReactNode
  tone?: ToastTone
}

type Dialog =
  | { kind: 'confirm'; options: ConfirmOptions; resolve: (ok: boolean) => void }
  | { kind: 'prompt'; options: PromptOptions; resolve: (value: string | null) => void }

interface Feedback {
  confirm: (options: ConfirmOptions) => Promise<boolean>
  prompt: (options: PromptOptions) => Promise<string | null>
  toast: (options: ToastOptions) => void
}

const FeedbackContext = createContext<Feedback | null>(null)

function useFeedback() {
  const value = useContext(FeedbackContext)
  if (!value) throw new Error('Wrap the app in <FeedbackProvider>.')
  return value
}

export const useConfirm = () => useFeedback().confirm
export const usePrompt = () => useFeedback().prompt
export const useToast = () => useFeedback().toast

const toneStyle: Record<Tone, { ring: string; icon: IconName }> = {
  danger: { ring: 'bg-red-50 text-red-600 ring-red-100', icon: 'alert' },
  warning: { ring: 'bg-amber-50 text-amber-600 ring-amber-100', icon: 'alert' },
  primary: { ring: 'bg-brand-50 text-brand-700 ring-brand-100', icon: 'check' },
}

export function FeedbackProvider({ children }: { children: ReactNode }) {
  const [dialog, setDialog] = useState<Dialog | null>(null)
  const [toasts, setToasts] = useState<(ToastOptions & { id: number })[]>([])
  const nextId = useRef(0)

  const confirm = useCallback(
    (options: ConfirmOptions) => new Promise<boolean>((resolve) => setDialog({ kind: 'confirm', options, resolve })),
    [],
  )
  const prompt = useCallback(
    (options: PromptOptions) => new Promise<string | null>((resolve) => setDialog({ kind: 'prompt', options, resolve })),
    [],
  )
  const dismiss = useCallback((id: number) => setToasts((all) => all.filter((t) => t.id !== id)), [])
  const toast = useCallback(
    (options: ToastOptions) => {
      const id = nextId.current++
      setToasts((all) => [...all.slice(-2), { ...options, id }])
      window.setTimeout(() => dismiss(id), options.tone === 'error' ? 7000 : 4500)
    },
    [dismiss],
  )

  const close = (answer: boolean, value = '') => {
    if (dialog?.kind === 'confirm') dialog.resolve(answer)
    if (dialog?.kind === 'prompt') dialog.resolve(answer ? value : null)
    setDialog(null)
  }

  return (
    <FeedbackContext.Provider value={{ confirm, prompt, toast }}>
      {children}
      {dialog && <DialogView dialog={dialog} onClose={close} />}
      <Toasts toasts={toasts} onDismiss={dismiss} />
    </FeedbackContext.Provider>
  )
}

function DialogView({ dialog, onClose }: { dialog: Dialog; onClose: (ok: boolean, value?: string) => void }) {
  const { options } = dialog
  const tone: Tone = dialog.kind === 'confirm' ? (dialog.options.tone ?? 'primary') : 'primary'
  const [value, setValue] = useState(dialog.kind === 'prompt' ? (dialog.options.initial ?? '') : '')
  const confirmButton = useRef<HTMLButtonElement>(null)
  const cancelButton = useRef<HTMLButtonElement>(null)
  const input = useRef<HTMLInputElement>(null)
  const closeRef = useRef(onClose)
  useEffect(() => {
    closeRef.current = onClose
  })

  useEffect(() => {
    // Start on the safe choice for destructive actions, on the input for prompts.
    if (dialog.kind === 'prompt') input.current?.select()
    else (tone === 'danger' ? cancelButton : confirmButton).current?.focus()
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && closeRef.current(false)
    document.addEventListener('keydown', onKey)
    const overflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.removeEventListener('keydown', onKey)
      document.body.style.overflow = overflow
    }
  }, [dialog, tone])

  const style = toneStyle[tone]
  const icon = options.icon ?? (dialog.kind === 'prompt' ? 'pencil' : style.icon)
  return (
    <div className="fixed inset-0 z-[60] flex items-end justify-center sm:items-center sm:p-4">
      <div className="fade-in absolute inset-0 bg-ink/50 backdrop-blur-[2px]" onClick={() => onClose(false)} />
      <form
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="dialog-title"
        onSubmit={(e) => {
          e.preventDefault()
          onClose(true, value)
        }}
        className="dialog-in relative w-full max-w-md rounded-t-2xl bg-white px-6 pb-[calc(1.5rem+env(safe-area-inset-bottom))] pt-7 text-center shadow-2xl sm:rounded-2xl sm:pb-6"
      >
        <span className={`mx-auto mb-4 grid h-14 w-14 place-items-center rounded-full ring-8 ${style.ring}`}>
          <Icon name={icon} className="h-7 w-7" />
        </span>
        <h2 id="dialog-title" className="text-lg font-bold tracking-tight">{options.title}</h2>
        {options.message && <div className="mt-2 text-sm text-stone-600">{options.message}</div>}
        {dialog.kind === 'prompt' && (
          <label className="mt-4 block text-left">
            <span className="mb-1.5 block font-mono text-xs font-semibold uppercase tracking-wider text-stone-700">{dialog.options.label}</span>
            <Input
              ref={input}
              type={dialog.options.type ?? 'text'}
              placeholder={dialog.options.placeholder}
              value={value}
              onChange={(e) => setValue(e.target.value)}
            />
          </label>
        )}
        <div className="mt-6 flex flex-col-reverse gap-2 sm:flex-row sm:justify-center">
          <Button ref={cancelButton} variant="secondary" className="sm:min-w-28" onClick={() => onClose(false)}>
            {options.cancelLabel ?? 'Cancel'}
          </Button>
          <Button
            ref={confirmButton}
            type="submit"
            className={`sm:min-w-28 ${tone === 'danger' ? '!bg-red-600 hover:!bg-red-700' : tone === 'warning' ? '!bg-amber-600 hover:!bg-amber-700' : ''}`}
          >
            {options.confirmLabel ?? 'Confirm'}
          </Button>
        </div>
      </form>
    </div>
  )
}

const toastStyle: Record<ToastTone, { icon: IconName; accent: string }> = {
  success: { icon: 'check', accent: 'bg-brand-50 text-brand-700' },
  error: { icon: 'alert', accent: 'bg-red-50 text-red-600' },
  info: { icon: 'megaphone', accent: 'bg-sky-50 text-sky-700' },
}

function Toasts({ toasts, onDismiss }: { toasts: (ToastOptions & { id: number })[]; onDismiss: (id: number) => void }) {
  return (
    // Top of the screen: on phones the bottom belongs to the tab bar.
    <div
      aria-live="polite"
      className="pointer-events-none fixed inset-x-0 top-0 z-[70] flex flex-col items-center gap-2 px-4 pt-[calc(0.75rem+env(safe-area-inset-top))] sm:items-end sm:pr-6 sm:pt-5"
    >
      {toasts.map((t) => {
        const style = toastStyle[t.tone ?? 'success']
        return (
          <div
            key={t.id}
            role={t.tone === 'error' ? 'alert' : 'status'}
            className="toast-in pointer-events-auto flex w-full max-w-sm items-start gap-3 rounded-xl border border-stone-200 bg-white p-3.5 shadow-lg"
          >
            <span className={`grid h-9 w-9 shrink-0 place-items-center rounded-full ${style.accent}`}>
              <Icon name={style.icon} className="h-5 w-5" />
            </span>
            <div className="min-w-0 flex-1 pt-0.5">
              <p className="text-sm font-semibold">{t.title}</p>
              {t.message && <p className="text-sm text-stone-600">{t.message}</p>}
            </div>
            <button type="button" aria-label="Dismiss" onClick={() => onDismiss(t.id)} className="rounded-md p-1 text-stone-400 hover:bg-stone-100 hover:text-ink">
              <Icon name="close" className="h-4 w-4" />
            </button>
          </div>
        )
      })}
    </div>
  )
}
