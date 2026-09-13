import type { ButtonHTMLAttributes, ReactNode } from 'react'
import { cn } from '@/lib/cn'

/**
 * Five variants, and the number is the point.
 *
 * A screen with three equally-weighted buttons has told you nothing about which
 * one to press. So the ladder is explicit: exactly one `primary` per view, a
 * `secondary` for the ordinary alternatives, `ghost` for the ones that should
 * recede until wanted, `danger` for the destructive, and `confirm` for the
 * mint-accented "this is settled" action — applying a sync, accepting a plan.
 *
 * `confirm` is the only place the secondary accent appears on a filled control,
 * which is what keeps it meaningful.
 */

type Variant = 'primary' | 'secondary' | 'ghost' | 'danger' | 'confirm'
type Size = 'sm' | 'md'

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant
  size?: Size
  icon?: ReactNode
}

const VARIANTS: Record<Variant, string> = {
  primary: cn(
    'border-transparent bg-accent text-accent-ink',
    'hover:bg-accent-hover active:brightness-95',
  ),
  secondary: cn(
    'border-line-strong bg-surface text-ink',
    'hover:border-accent-line hover:bg-elevated',
  ),
  ghost: 'border-transparent bg-transparent text-ink-2 hover:bg-surface hover:text-ink',
  danger: 'border-line-strong bg-transparent text-danger hover:border-danger hover:bg-danger-soft',
  confirm: cn(
    'border-transparent bg-accent-2 text-accent-2-ink',
    'hover:brightness-110 active:brightness-95',
  ),
}

const SIZES: Record<Size, string> = {
  sm: 'h-7 gap-1.5 px-2.5 text-body',
  md: 'h-9 gap-2 px-3.5 text-strong',
}

export function Button({
  variant = 'secondary',
  size = 'md',
  icon,
  className,
  children,
  type = 'button',
  ...rest
}: ButtonProps) {
  return (
    <button
      type={type}
      className={cn(
        'inline-flex items-center justify-center rounded-md border font-medium',
        'transition-[background-color,border-color,color,filter] duration-[var(--duration-fast)]',
        // A press that moves is a press you felt. One pixel, no bounce.
        'active:translate-y-px',
        'disabled:pointer-events-none disabled:opacity-50',
        VARIANTS[variant],
        SIZES[size],
        className,
      )}
      {...rest}
    >
      {icon}
      {children}
    </button>
  )
}
