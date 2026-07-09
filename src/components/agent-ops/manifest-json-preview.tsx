import type { AgentManifest } from '@/lib/agent-mission-control/types'

/**
 * Calm, deterministic JSON syntax tinting — the single subtle accent lives on
 * property names; string values stay zinc so the pane reads as one quiet block
 * (green is reserved for success/active semantics elsewhere in the doctrine).
 * No client JS, no external lib.
 */
function HighlightedLine({ line }: { line: string }) {
  // `"key": value` lines (2-space JSON.stringify output)
  const keyMatch = line.match(/^(\s*)("(?:[^"\\]|\\.)*")(: )(.*)$/)
  if (keyMatch) {
    const [, indent = '', key = '', separator = '', rest = ''] = keyMatch
    return (
      <>
        {indent}
        <span className="text-green-700/80 dark:text-green-400/80">{key}</span>
        <span className="text-zinc-500">{separator}</span>
        <HighlightedValue raw={rest} />
        {'\n'}
      </>
    )
  }

  // Bare string array items, e.g. `  "/admin/accounts/*",`
  const itemMatch = line.match(/^(\s*)("(?:[^"\\]|\\.)*")(,?)$/)
  if (itemMatch) {
    const [, indent = '', str = '', comma = ''] = itemMatch
    return (
      <>
        {indent}
        <span className="text-zinc-600 dark:text-zinc-300">{str}</span>
        <span className="text-zinc-500">{comma}</span>
        {'\n'}
      </>
    )
  }

  // Pure structural lines: `{`, `},`, `],` …
  if (/^\s*[{}[\],]+$/.test(line)) {
    return (
      <>
        <span className="text-zinc-500">{line}</span>
        {'\n'}
      </>
    )
  }

  // Numbers, booleans, null (inherit the base value color)
  return (
    <>
      {line}
      {'\n'}
    </>
  )
}

function HighlightedValue({ raw }: { raw: string }) {
  const stringMatch = raw.match(/^("(?:[^"\\]|\\.)*")(,?)$/)
  if (stringMatch) {
    const [, str = '', comma = ''] = stringMatch
    return (
      <>
        <span className="text-zinc-600 dark:text-zinc-300">{str}</span>
        <span className="text-zinc-500">{comma}</span>
      </>
    )
  }
  return <>{raw}</>
}

/**
 * Read-only raw manifest preview on a doctrine nested surface.
 * Server-safe: the JSON is serialized once at render time.
 */
export function ManifestJsonPreview({ manifest }: { manifest: AgentManifest }) {
  const lines = JSON.stringify(manifest, null, 2).split('\n')

  return (
    <div className="overflow-hidden rounded-lg bg-zinc-50 ring-1 ring-zinc-950/5 dark:bg-zinc-950/50 dark:ring-white/5">
      <div className="flex items-center justify-between gap-4 border-b border-zinc-950/5 dark:border-white/5 px-4 py-3">
        <span className="font-mono text-xs text-zinc-700 dark:text-zinc-300">manifest.json</span>
        <span className="font-mono text-xs tabular-nums text-zinc-500">{manifest.version}</span>
      </div>
      <pre className="whitespace-pre-wrap break-words p-4 font-mono text-xs/5 text-zinc-600 dark:text-zinc-300">
        <code>
          {lines.map((line, index) => (
            <HighlightedLine key={index} line={line} />
          ))}
        </code>
      </pre>
    </div>
  )
}
