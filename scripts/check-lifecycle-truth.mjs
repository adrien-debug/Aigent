#!/usr/bin/env node
/**
 * Lifecycle-truth guard — five specific lies the governed lifecycle trace
 * (`src/lib/agent-mission-control/agent-lifecycle-trace.ts`) must never tell:
 *
 *  1. "deployed" claimed without consumer proof. A delivery event proves
 *     Aigent PUSHED something — never that the consumer merged, activated, or
 *     deployed it. Banned: the words "deployed"/"is live" attached to
 *     `delivery`/`deliver` in that file.
 *  2. "healthy" claimed without a telemetry diagnostic. A telemetry event
 *     proves a report ARRIVED — never that the agent is well
 *     (`telemetry-health.ts`'s own doctrine). Banned: "healthy" near
 *     `telemetry` outside of a real call to `diagnoseTelemetryHealth`.
 *  3. A false zero on telemetry. `lastTelemetry`/telemetry counts must never
 *     be coalesced to 0 with `?? 0` / `|| 0` — see render-truth's identical
 *     rule, scoped here to the telemetry fields this module owns.
 *  4. Promotion displayed without a production version. The word "promoted"
 *     must not appear disconnected from `stage === 'production'` /
 *     `currentVersion?.stage`.
 *  5. A consumer-active version inferred FROM a delivery event. The
 *     `active_in_consumer` stage's `reached` must be the literal string
 *     `'unknown'` — never derived from `delivery`.
 *
 * SCOPE — ONE file, named explicitly rather than walked: the trace module
 * itself. This guard used to also name its display component under
 * `src/components/console/`; that file was deleted by the frontend reset and was
 * never in FILES anyway, so the claim was doubly wrong. A header that advertises
 * twice the reach of the code is the same lie as a green gate on zero targets —
 * when a display layer comes back, add it to FILES *and* to this comment, in the
 * same commit.
 *
 * A file listed here but missing on disk is a VIOLATION, not a skip: this guard
 * cannot go vacuously green. Exit 0 = clean, exit 1 = violation. Read-only, no
 * network, no secret.
 */
import { readFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const FILES = [join(ROOT, 'src/lib/agent-mission-control/agent-lifecycle-trace.ts')]

// Reuses the same comment-stripping approach as render-truth/check-catalyst so
// documentation prose explaining the counter-example never trips the scan.
function stripComments(text) {
  const out = []
  let inBlock = false
  for (const raw of text.split('\n')) {
    let line = raw
    if (inBlock) {
      const end = line.indexOf('*/')
      if (end === -1) {
        out.push('')
        continue
      }
      line = ' '.repeat(end + 2) + line.slice(end + 2)
      inBlock = false
    }
    line = line.replace(/\/\*[\s\S]*?\*\//g, ' ')
    const open = line.indexOf('/*')
    if (open !== -1) {
      line = line.slice(0, open)
      inBlock = true
    }
    const lineComment = line.indexOf('//')
    if (lineComment !== -1) line = line.slice(0, lineComment)
    out.push(line)
  }
  return out
}

async function main() {
  const violations = []

  for (const file of FILES) {
    let text
    try {
      text = await readFile(file, 'utf8')
    } catch {
      violations.push(`${file}  MISSING — the lifecycle trace file this guard protects does not exist`)
      continue
    }
    const lines = stripComments(text)
    const rel = file.slice(ROOT.length + 1)

    lines.forEach((line, i) => {
      const at = `${rel}:${i + 1}`

      // 1. "deployed"/"is live" near a delivery reference, in CODE (not prose —
      //    comments are already stripped).
      if (/\b(deployed|is live)\b/i.test(line) && /deliver/i.test(line)) {
        violations.push(`${at}  claims "deployed"/"is live" on a delivery fact — delivered ≠ deployed: ${line.trim()}`)
      }

      // 2. AFFIRMATIVE "healthy" near telemetry, outside a real
      //    diagnoseTelemetryHealth call. A negated form ("does NOT prove
      //    healthy", "never asserts healthy") is the doctrine statement this
      //    guard exists to enforce, not a violation of it — only flag when no
      //    negation word appears on the same line.
      if (
        /healthy/i.test(line) &&
        /telemetry/i.test(line) &&
        !/diagnoseTelemetryHealth/.test(line) &&
        !/\b(not|never|n't|no\b)\b/i.test(line)
      ) {
        violations.push(`${at}  claims "healthy" near telemetry without diagnoseTelemetryHealth: ${line.trim()}`)
      }

      // 3. False zero on telemetry fields.
      if (/\b(lastTelemetry|agentVersion|lastEventReceivedAt|receivedAt)\b[^\n]*(?:\?\?|\|\|)\s*0\b/.test(line)) {
        violations.push(`${at}  telemetry value coalesced to 0 — an absent report is not a measured zero: ${line.trim()}`)
      }

      // 4. "promoted" disconnected from a production-stage check.
      if (/\bpromoted\b/i.test(line) && !/production/.test(line) && !/stage/.test(line)) {
        violations.push(`${at}  claims "promoted" without checking a production version/stage: ${line.trim()}`)
      }

      // 5. active_in_consumer must stay the literal 'unknown', never computed
      //    from `delivery`.
      if (/active_in_consumer/.test(line) && /reached:/.test(line) && !/'unknown'/.test(line)) {
        violations.push(`${at}  active_in_consumer.reached is not the literal 'unknown': ${line.trim()}`)
      }
    })

    // Structural check for rule 5: somewhere in the file, the active_in_consumer
    // stage object's `reached` field must be assigned the literal 'unknown'.
    if (rel.endsWith('agent-lifecycle-trace.ts')) {
      const stageBlockMatch = text.match(/key:\s*'active_in_consumer'[\s\S]{0,600}?reached:\s*([^,\n]+)/)
      if (!stageBlockMatch || stageBlockMatch[1].trim() !== `'unknown'`) {
        violations.push(
          `${rel}  active_in_consumer stage's reached field must be the literal 'unknown' — found: ${stageBlockMatch ? stageBlockMatch[1].trim() : 'NOT FOUND'}`
        )
      }
    }
  }

  if (violations.length > 0) {
    console.error(`\n✗ ${violations.length} lifecycle-truth violation(s):\n`)
    for (const v of violations) console.error('  ' + v)
    console.error('\nLifecycle-truth guard FAILED.\n')
    process.exit(1)
  }

  console.log(
    '✓ Lifecycle-truth guard passed — no unproven "deployed", no unproven "healthy", no false telemetry zero, ' +
      'no disconnected "promoted", and active_in_consumer stays the literal unknown.'
  )
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main()
}
