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
 *  5. A consumer-active verdict invented locally. TIGHTENED, not relaxed, on
 *     2026-07-31: this rule used to demand the literal `'unknown'`, and it was
 *     RIGHT to — at the time no consumer proof existed at all, so any other
 *     value could only have been deduced from a delivery, which is a lie.
 *
 *     An authenticated consumer channel now exists, so the honest constraint is
 *     no longer "always unknown" but "only ever the verdict of
 *     consumer-activation.ts". Concretely, the guard requires ALL of:
 *
 *       5a. The `active_in_consumer` stage is produced by a dedicated resolver
 *           whose parameters are ONLY the activation verdict and its lookup
 *           flag. It must not receive `delivery`, `currentVersion`, `versions`,
 *           `lastTelemetry`, or any other lifecycle fact — a function that is
 *           never handed the delivery cannot infer activation from it.
 *       5b. Inside that resolver, `reached` is only ever assigned from
 *           `activation.activeInConsumer`, or from the two honest literals
 *           `'unknown'` / `'unavailable'`. Any other expression — a boolean, a
 *           comparison, a ternary on `delivery`/`stage`/`status` — is a
 *           violation.
 *       5c. `false` never appears as a `reached` value in that resolver, in any
 *           form. Consumer silence is ambiguous; `false` would assert a fact
 *           nobody measured.
 *       5d. Nowhere in the module does an `active_in_consumer` line couple
 *           `reached` to `delivery`, `delivered`, `stage`, or `status`.
 *
 *     The rule that has NOT moved: activation is never derived from a delivery,
 *     from an Aigent-side status, or from any boolean lying around.
 *
 *  6. VERSION DRIFT MUST BE ID-BASED, NEVER HEURISTIC. The drift resolver must
 *     compare only measured version identifiers/labels (`delivery.versionId`,
 *     telemetry `agentVersion`, and optional exact label lookup by id). It must
 *     not infer "current" from timestamps, stage rank, array position or
 *     production pointers.
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

      // 5d. A single line that couples an active_in_consumer `reached` to a
      //     delivery / status / stage fact — the original lie, still banned.
      if (
        /active_in_consumer/.test(line) &&
        /reached/.test(line) &&
        /\b(delivery|delivered|currentVersion|\bstage\b|\bstatus\b|lastTelemetry)\b/.test(line)
      ) {
        violations.push(
          `${at}  active_in_consumer.reached is coupled to a delivery/status/stage fact — activation is only ever the consumer-activation verdict: ${line.trim()}`
        )
      }
    })

    // ── Rule 5, structural. Scoped to the trace module. ──────────────────────
    if (rel.endsWith('agent-lifecycle-trace.ts')) {
      const src = lines.join('\n')

      // 5a. The stage must be produced by a dedicated resolver, and that
      //     resolver must be handed ONLY the activation verdict + lookup flag.
      const resolver = src.match(/function\s+resolveConsumerStage\s*\(([\s\S]*?)\)\s*:\s*LifecycleStage\s*\{([\s\S]*?)\n\}/)
      if (!resolver) {
        violations.push(
          `${rel}  no \`function resolveConsumerStage(...): LifecycleStage\` found — the active_in_consumer stage must be built by a dedicated resolver that receives ONLY the consumer-activation verdict`
        )
      } else {
        const [, params, body] = resolver

        const forbiddenParams = ['delivery', 'delivered', 'currentVersion', 'versions', 'lastTelemetry', 'hasV2Draft']
        for (const bad of forbiddenParams) {
          if (new RegExp(`\\b${bad}\\b`).test(params)) {
            violations.push(
              `${rel}  resolveConsumerStage receives \`${bad}\` — it must be structurally unable to infer activation from any lifecycle fact other than the consumer-activation verdict`
            )
          }
        }

        // 5b. Every `reached:` assignment inside the resolver must read from
        //     `activeInConsumer` or be one of the two honest literals.
        const assignments = [...body.matchAll(/reached:\s*([^,\n]+)/g)].map((m) => m[1].trim())
        if (assignments.length === 0) {
          violations.push(`${rel}  resolveConsumerStage assigns no \`reached\` value`)
        }
        // Un alias n'échappe pas au contrôle : si `reached` lit un identifiant,
        // on REMONTE à son assignation. Sans ça,
        // `const verdict = activation.delivered ? true : 'unknown'` passait au
        // VERT — c'est-à-dire exactement le mensonge d'origine (activation
        // dérivée d'une livraison) béni par la gate censée l'interdire.
        // Trouvé en revue croisée, sur un sabotage que l'auteur n'avait pas tenté.
        const aliasSource = (name) => {
          const m = body.match(new RegExp(String.raw`\b(?:const|let)\s+${name}\s*(?::[^=]+)?=\s*([^\n;]+)`))
          return m ? m[1].trim() : null
        }

        for (const raw of assignments) {
          // Une lecture NUE : `activation.activeInConsumer`, rien de plus. Toute
          // comparaison (`=== true`), coercition ou opérateur produit une valeur
          // qui n'est PLUS le verdict — `activeInConsumer === true` rendait un
          // `false` littéral tout en satisfaisant l'ancien test de sous-chaîne.
          const isBareVerdictRead = (v) => /^[\w.]*\bactiveInConsumer$/.test(v)
          const honest = (v) => /^'unknown'$/.test(v) || /^'unavailable'$/.test(v)
          const ternaryOfHonestLiterals = /^\w+\s*\?\s*'(unavailable|unknown)'\s*:\s*'(unavailable|unknown)'$/.test(raw)

          // `reached: verdict` → on juge ce que `verdict` VAUT, pas son nom.
          const resolved = /^[A-Za-z_$][\w$]*$/.test(raw) ? (aliasSource(raw) ?? raw) : raw
          const value = raw
          const readsVerdict = isBareVerdictRead(resolved)
          const honestLiteral = honest(resolved)

          if (!readsVerdict && !honestLiteral && !ternaryOfHonestLiterals) {
            violations.push(
              `${rel}  resolveConsumerStage assigns \`reached: ${value}\` — only the consumer-activation verdict (\`activeInConsumer\`) or the literals 'unknown' / 'unavailable' are admissible`
            )
          }
        }

        // 5c. `false` must never be a reached value, in any branch — ni écrit,
        //     ni PRODUIT. Une comparaison (`=== true`), une négation ou une
        //     coercition rend un booléen : `activeInConsumer === true` livrait
        //     un `false` littéral sans que le mot `false` n'apparaisse jamais.
        //     Trouvé en revue croisée.
        for (const value of assignments) {
          if (/[=!]==?|^!|\bBoolean\s*\(|^!!/.test(value)) {
            violations.push(
              `${rel}  resolveConsumerStage derives \`reached\` from a comparison/coercion (\`${value}\`) — that yields a BOOLEAN, and \`false\` on active_in_consumer asserts an inactivity nobody measured. Copy the verdict, do not test it.`
            )
          }
          if (/\bfalse\b/.test(value)) {
            violations.push(
              `${rel}  resolveConsumerStage can assign \`false\` to reached (\`${value}\`) — consumer silence is ambiguous and must never be asserted as inactivity`
            )
          }
        }

        // 5c bis. The verdict copied out of the activation read must not be
        //         massaged through a boolean coercion on the way in.
        if (/reached:\s*(!!|Boolean\()/.test(body)) {
          violations.push(
            `${rel}  resolveConsumerStage coerces reached to a boolean — that collapses 'unknown'/'unavailable' into false`
          )
        }
      }

      // 5a bis. EXACTLY ONE `key: 'active_in_consumer'` stage object may exist,
      //         and it must live INSIDE resolveConsumerStage. Anything else is
      //         a second construction path that bypasses every check above —
      //         which is precisely how a hand-inlined `reached: delivery !==
      //         null` slipped past an earlier version of this guard.
      const resolverBody = resolver ? resolver[0] : ''
      const stageObjectCount = (src.match(/key:\s*'active_in_consumer'/g) ?? []).length
      const inResolverCount = (resolverBody.match(/key:\s*'active_in_consumer'/g) ?? []).length
      if (stageObjectCount !== inResolverCount) {
        violations.push(
          `${rel}  ${stageObjectCount - inResolverCount} active_in_consumer stage object(s) built OUTSIDE resolveConsumerStage — every construction path must go through the resolver, or the verdict-only rule can simply be side-stepped`
        )
      }
      if (resolver && inResolverCount === 0) {
        violations.push(`${rel}  resolveConsumerStage does not build a \`key: 'active_in_consumer'\` stage`)
      }
      if (!/resolveConsumerStage\(/.test(src)) {
        violations.push(`${rel}  resolveConsumerStage is never called — the active_in_consumer stage is built some other way`)
      }

      // The unavailable ≠ unknown invariant: a failed lookup must not be
      // reported as a measured absence.
      if (!/'unavailable'/.test(src)) {
        violations.push(
          `${rel}  no 'unavailable' state present — a failed consumer-activation read must be reported as unavailable, never flattened into 'unknown'`
        )
      }

      // 6. Drift resolver must stay explicit and non-heuristic.
      const driftResolver = src.match(
        /function\s+resolveVersionDrift\s*\(([\s\S]*?)\)\s*:\s*VersionDriftReport\s*\{([\s\S]*?)\n\}/
      )
      if (!driftResolver) {
        violations.push(`${rel}  no \`resolveVersionDrift(...): VersionDriftReport\` resolver found`)
      } else {
        const [, driftParams, driftBody] = driftResolver
        for (const required of ['versions', 'delivery', 'lastTelemetry', 'telemetryLookupFailed']) {
          if (!new RegExp(`\\b${required}\\b`).test(driftParams)) {
            violations.push(
              `${rel}  resolveVersionDrift is missing required input \`${required}\` — drift cannot be measured from complete evidence`
            )
          }
        }
        if (!/delivery\??\.versionId/.test(driftBody)) {
          violations.push(
            `${rel}  resolveVersionDrift does not read \`delivery.versionId\` — delivered version must come from persisted delivery evidence`
          )
        }
        if (!/versionsMatch/.test(driftBody) || !/state:\s*'measured'/.test(driftBody)) {
          violations.push(
            `${rel}  resolveVersionDrift must compute an explicit measured match verdict when both proofs exist`
          )
        }
        const forbiddenHeuristics = ['Date.parse', 'createdAt', 'currentVersion', '\\.stage\\b', 'versions\\[0\\]']
        for (const heuristic of forbiddenHeuristics) {
          if (new RegExp(heuristic).test(driftBody)) {
            violations.push(
              `${rel}  resolveVersionDrift uses heuristic \`${heuristic}\` — drift must never be inferred from timestamps, stage or position`
            )
          }
        }
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
      'no disconnected "promoted", and active_in_consumer is decided ONLY by the consumer-activation verdict ' +
      '(never from a delivery/status/stage, never false, and a failed read stays "unavailable").'
  )
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main()
}
