import type { InputHTMLAttributes, ReactNode, SelectHTMLAttributes } from 'react'
import { cn } from '@/lib/cn'

/**
 * Form controls, with one boundary treatment shared between them.
 *
 * The border is `--line-strong`, not `--line`, and that is a contrast
 * requirement rather than a preference: the edge of a control is what tells you
 * where the control is, so it is held at 3:1 against the surfaces it can sit
 * on. Dividers may be quiet; the thing you are about to type into may not.
 */

const BASE = cn(
  'w-full rounded-md border border-line-strong bg-surface px-2.5',
  'text-[13.5px] text-ink placeholder:text-ink-3',
  'transition-colors duration-[var(--duration-fast)]',
  'hover:border-accent-line focus:border-accent',
  'disabled:cursor-not-allowed disabled:opacity-55',
)

export function TextInput({ className, ...rest }: InputHTMLAttributes<HTMLInputElement>) {
  return <input className={cn(BASE, 'h-9', className)} {...rest} />
}

export function Select({ className, children, ...rest }: SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select className={cn(BASE, 'h-9 pr-7', className)} {...rest}>
      {children}
    </select>
  )
}

/**
 * A labelled row: what the setting is, what it does, and the control.
 *
 * The description is tied to the control with `aria-describedby` by the caller
 * when it matters; the visual pairing alone is not an accessible one.
 */
export function Field({
  label,
  description,
  htmlFor,
  control,
  className,
}: {
  label: ReactNode
  description?: ReactNode
  htmlFor?: string
  control: ReactNode
  className?: string
}) {
  return (
    <div className={cn('flex flex-wrap items-center justify-between gap-x-4 gap-y-1.5', className)}>
      <div className="flex min-w-0 flex-col gap-0.5">
        <label htmlFor={htmlFor} className="t-body font-medium text-ink">
          {label}
        </label>
        {description ? <p className="t-meta max-w-prose text-ink-3">{description}</p> : null}
      </div>
      <div className="shrink-0">{control}</div>
    </div>
  )
}
