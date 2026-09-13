import { Fragment, type ReactNode } from 'react'
import { cn } from '@/lib/cn'
import { parseMarkdown, type Block, type Inline } from '@/lib/markdown'

/**
 * Renders markdown as React elements.
 *
 * There is no `dangerouslySetInnerHTML` anywhere in this file, and that is the
 * entire security design rather than an implementation detail: every piece of
 * user text becomes a text node, so a note containing `<script>` renders those
 * characters instead of executing them. No sanitiser is involved because there
 * is no HTML string for one to clean.
 *
 * Presentation only — it takes a string and returns elements, holds no state
 * and knows nothing about notes. The one exception is the checkbox callback,
 * which reports *which* box was clicked and lets the owner rewrite the source.
 */

function renderInline(nodes: Inline[], keyPrefix = ''): ReactNode {
  return nodes.map((node, i) => {
    const key = `${keyPrefix}${i}`
    switch (node.kind) {
      case 'text':
        return <Fragment key={key}>{node.value}</Fragment>
      case 'strong':
        return (
          <strong key={key} className="font-semibold text-ink">
            {renderInline(node.content, `${key}.`)}
          </strong>
        )
      case 'em':
        return (
          <em key={key} className="italic">
            {renderInline(node.content, `${key}.`)}
          </em>
        )
      case 'code':
        return (
          <code
            key={key}
            className="rounded-sm bg-sunken px-1 py-px font-mono text-[0.9em] text-ink-2"
          >
            {node.value}
          </code>
        )
      case 'link':
        return (
          <a
            key={key}
            href={node.href}
            // A note may link anywhere; opening in a new tab keeps the app
            // mounted, and noreferrer stops the target reaching back.
            target="_blank"
            rel="noreferrer noopener"
            className="text-accent underline decoration-dotted underline-offset-2 hover:decoration-solid"
          >
            {renderInline(node.content, `${key}.`)}
          </a>
        )
    }
  })
}

const HEADING_CLASS: Record<number, string> = {
  1: 'text-[18px] font-semibold tracking-tight text-ink mt-4 first:mt-0',
  2: 'text-[15.5px] font-semibold tracking-tight text-ink mt-4 first:mt-0',
  3: 'text-[14px] font-semibold text-ink mt-3 first:mt-0',
  4: 'text-[13px] font-semibold text-ink-2 mt-3 first:mt-0',
  5: 'text-[12.5px] font-semibold text-ink-2 mt-2 first:mt-0',
  6: 'text-[12px] font-semibold uppercase tracking-wide text-ink-3 mt-2 first:mt-0',
}

export interface MarkdownProps {
  source: string
  className?: string
  /**
   * Called with the document-order index of a checkbox that was clicked.
   * Omit to render checkboxes as read-only state.
   */
  onToggleCheckbox?: (index: number) => void
}

export function Markdown({ source, className, onToggleCheckbox }: MarkdownProps) {
  const blocks = parseMarkdown(source)

  // Checkbox indices run across the whole document, matching `toggleCheckbox`.
  let checkboxIndex = -1

  const renderBlock = (block: Block, key: string): ReactNode => {
    switch (block.kind) {
      case 'heading': {
        const Tag = `h${block.level}` as 'h1'
        return (
          <Tag key={key} className={HEADING_CLASS[block.level]}>
            {renderInline(block.content, `${key}.`)}
          </Tag>
        )
      }

      case 'paragraph':
        return (
          <p key={key} className="whitespace-pre-wrap text-[13.5px] leading-relaxed text-ink-2">
            {renderInline(block.content, `${key}.`)}
          </p>
        )

      case 'code':
        return (
          <pre
            key={key}
            className="overflow-x-auto rounded-md border border-line bg-sunken p-3 text-[12.5px] leading-relaxed"
          >
            <code className="font-mono text-ink-2">{block.code}</code>
          </pre>
        )

      case 'list': {
        const Tag = block.ordered ? 'ol' : 'ul'
        return (
          <Tag
            key={key}
            start={block.ordered ? block.start : undefined}
            className={cn(
              'flex flex-col gap-1 text-[13.5px] leading-relaxed text-ink-2',
              block.ordered ? 'list-decimal pl-5' : 'list-disc pl-5',
              // A checkbox list carries its own markers.
              block.items.every((item) => item.checked !== null) && 'list-none pl-0',
            )}
          >
            {block.items.map((item, i) => {
              if (item.checked === null) {
                return (
                  <li key={`${key}.${i}`}>{renderInline(item.content, `${key}.${i}.`)}</li>
                )
              }

              checkboxIndex += 1
              const index = checkboxIndex
              const label = item.content
                .map((node) => ('value' in node ? node.value : ''))
                .join('')

              return (
                <li key={`${key}.${i}`} className="flex items-start gap-2 pl-0">
                  <button
                    type="button"
                    role="checkbox"
                    aria-checked={item.checked}
                    aria-label={label.length > 0 ? label : `Item ${index + 1}`}
                    disabled={onToggleCheckbox === undefined}
                    onClick={() => onToggleCheckbox?.(index)}
                    className={cn(
                      'mt-[3px] grid h-[15px] w-[15px] shrink-0 place-items-center rounded-[4px] border',
                      'transition-colors duration-[var(--duration-fast)]',
                      item.checked
                        ? 'border-transparent bg-accent text-accent-ink'
                        : 'border-line-strong text-transparent',
                      onToggleCheckbox !== undefined && !item.checked && 'hover:border-accent',
                      onToggleCheckbox === undefined && 'cursor-default',
                    )}
                  >
                    <svg viewBox="0 0 12 12" className="h-2.5 w-2.5" aria-hidden>
                      <path
                        d="M2 6.5 L4.5 9 L10 3"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="2.2"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      />
                    </svg>
                  </button>
                  <span className={cn('min-w-0 flex-1', item.checked && 'text-ink-3 line-through')}>
                    {renderInline(item.content, `${key}.${i}.`)}
                  </span>
                </li>
              )
            })}
          </Tag>
        )
      }
    }
  }

  if (blocks.length === 0) {
    return <p className={cn('text-[13px] italic text-ink-3', className)}>Nothing written yet.</p>
  }

  return (
    <div className={cn('flex flex-col gap-2.5', className)}>
      {blocks.map((block, i) => renderBlock(block, String(i)))}
    </div>
  )
}
