import { cn } from '@/lib/cn'

/** A key cap. The app is keyboard-first, so shortcuts are shown, not hidden. */
export function Kbd({ children, className }: { children: string; className?: string }) {
  return (
    <kbd
      className={cn(
        'inline-flex h-[18px] min-w-[18px] items-center justify-center rounded-sm',
        'border border-line bg-sunken px-1 font-mono text-micro text-ink-3',
        className,
      )}
    >
      {children}
    </kbd>
  )
}
