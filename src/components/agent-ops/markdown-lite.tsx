import type React from 'react'
import { Fragment } from 'react'

/**
 * MarkdownLite — a tiny, dependency-free renderer for a safe subset of
 * markdown used in Builder chat messages (headings, bold, italic, inline
 * code, bullet/ordered lists, horizontal rules, paragraphs).
 *
 * Deliberately NOT a full markdown parser: no HTML is ever injected
 * (no dangerouslySetInnerHTML) — every node is built as a real React
 * element from escaped text. Streaming-safe: if inline markup like `**` or
 * a backtick is left unclosed (partial chunk mid-stream), the raw
 * characters are rendered as plain text instead of throwing or hiding
 * content.
 */

// ---------------------------------------------------------------------------
// Inline parsing — bold / italic / inline code, degrades to literal text
// when a marker is unclosed.
// ---------------------------------------------------------------------------

type InlineToken =
  | { kind: 'text'; text: string }
  | { kind: 'bold'; text: string }
  | { kind: 'italic'; text: string }
  | { kind: 'code'; text: string }

function parseInline(line: string): InlineToken[] {
  const tokens: InlineToken[] = []
  let i = 0
  let buf = ''

  const flushText = () => {
    if (buf) {
      tokens.push({ kind: 'text', text: buf })
      buf = ''
    }
  }

  while (i < line.length) {
    // Inline code: `code`
    if (line[i] === '`') {
      const end = line.indexOf('`', i + 1)
      if (end !== -1) {
        flushText()
        tokens.push({ kind: 'code', text: line.slice(i + 1, end) })
        i = end + 1
        continue
      }
      // unclosed backtick — render literally
      buf += line[i]
      i += 1
      continue
    }

    // Bold: **text**
    if (line[i] === '*' && line[i + 1] === '*') {
      const end = line.indexOf('**', i + 2)
      if (end !== -1 && end > i + 2) {
        flushText()
        tokens.push({ kind: 'bold', text: line.slice(i + 2, end) })
        i = end + 2
        continue
      }
      // unclosed ** — render literally
      buf += line[i]
      i += 1
      continue
    }

    // Italic: *text* or _text_ (single marker, not part of **)
    if ((line[i] === '*' || line[i] === '_') && line[i + 1] !== line[i]) {
      const marker = line[i]
      const end = line.indexOf(marker, i + 1)
      if (end !== -1 && end > i + 1) {
        flushText()
        tokens.push({ kind: 'italic', text: line.slice(i + 1, end) })
        i = end + 1
        continue
      }
      // unclosed marker — render literally
      buf += line[i]
      i += 1
      continue
    }

    buf += line[i]
    i += 1
  }

  flushText()
  return tokens
}

function InlineNodes({ line }: { line: string }): React.ReactElement {
  const tokens = parseInline(line)
  return (
    <>
      {tokens.map((t, i) => {
        switch (t.kind) {
          case 'bold':
            return (
              <strong key={i} className="font-semibold text-inherit">
                {t.text}
              </strong>
            )
          case 'italic':
            return (
              <em key={i} className="italic text-inherit">
                {t.text}
              </em>
            )
          case 'code':
            return (
              <code
                key={i}
                className="rounded bg-[var(--color-surface-interactive)] px-1 py-0.5 font-mono text-xs text-inherit"
              >
                {t.text}
              </code>
            )
          case 'text':
          default:
            return <Fragment key={i}>{t.text}</Fragment>
        }
      })}
    </>
  )
}

// ---------------------------------------------------------------------------
// Block parsing — headings, lists, hr, paragraphs.
// ---------------------------------------------------------------------------

type Block =
  | { kind: 'heading'; level: 1 | 2 | 3; text: string }
  | { kind: 'ul'; items: string[] }
  | { kind: 'ol'; items: string[] }
  | { kind: 'hr' }
  | { kind: 'paragraph'; text: string }

function parseBlocks(content: string): Block[] {
  const lines = content.split('\n')
  const blocks: Block[] = []
  let paraBuf: string[] = []
  let ulBuf: string[] = []
  let olBuf: string[] = []

  const flushPara = () => {
    if (paraBuf.length > 0) {
      blocks.push({ kind: 'paragraph', text: paraBuf.join(' ') })
      paraBuf = []
    }
  }
  const flushUl = () => {
    if (ulBuf.length > 0) {
      blocks.push({ kind: 'ul', items: ulBuf })
      ulBuf = []
    }
  }
  const flushOl = () => {
    if (olBuf.length > 0) {
      blocks.push({ kind: 'ol', items: olBuf })
      olBuf = []
    }
  }
  const flushAll = () => {
    flushPara()
    flushUl()
    flushOl()
  }

  for (const rawLine of lines) {
    const line = rawLine.replace(/\r$/, '')
    const trimmed = line.trim()

    if (trimmed.length === 0) {
      flushAll()
      continue
    }

    const headingMatch = /^(#{1,3})\s+(.*)$/.exec(trimmed)
    if (headingMatch) {
      flushAll()
      const level = headingMatch[1].length as 1 | 2 | 3
      blocks.push({ kind: 'heading', level, text: headingMatch[2] })
      continue
    }

    if (/^(-{3,}|\*{3,})$/.test(trimmed)) {
      flushAll()
      blocks.push({ kind: 'hr' })
      continue
    }

    const ulMatch = /^[-*]\s+(.*)$/.exec(trimmed)
    if (ulMatch) {
      flushPara()
      flushOl()
      ulBuf.push(ulMatch[1])
      continue
    }

    const olMatch = /^\d+\.\s+(.*)$/.exec(trimmed)
    if (olMatch) {
      flushPara()
      flushUl()
      olBuf.push(olMatch[1])
      continue
    }

    flushUl()
    flushOl()
    paraBuf.push(trimmed)
  }

  flushAll()
  return blocks
}

const HEADING_CLASS: Record<1 | 2 | 3, string> = {
  1: 'text-base font-semibold text-inherit',
  2: 'text-sm font-semibold text-inherit',
  3: 'text-sm font-semibold text-inherit',
}

export function MarkdownLite({ content, className }: { content: string; className?: string }) {
  const blocks = parseBlocks(content)

  if (blocks.length === 0) return null

  return (
    <div className={className ?? 'space-y-3'}>
      {blocks.map((block, i) => {
        switch (block.kind) {
          case 'heading': {
            const Tag = (`h${block.level + 2}` as unknown) as 'h3' | 'h4' | 'h5'
            return (
              <Tag key={i} className={HEADING_CLASS[block.level]}>
                <InlineNodes line={block.text} />
              </Tag>
            )
          }
          case 'ul':
            return (
              <ul key={i} className="list-disc space-y-1 pl-5 marker:text-accent-400">
                {block.items.map((item, j) => (
                  <li key={j} className="leading-relaxed text-inherit">
                    <InlineNodes line={item} />
                  </li>
                ))}
              </ul>
            )
          case 'ol':
            return (
              <ol key={i} className="list-decimal space-y-1 pl-5 marker:text-accent-400">
                {block.items.map((item, j) => (
                  <li key={j} className="leading-relaxed text-inherit">
                    <InlineNodes line={item} />
                  </li>
                ))}
              </ol>
            )
          case 'hr':
            return <hr key={i} className="border-t border-white/5" />
          case 'paragraph':
          default:
            return (
              <p key={i} className="leading-relaxed text-inherit whitespace-pre-wrap">
                <InlineNodes line={block.text} />
              </p>
            )
        }
      })}
    </div>
  )
}
