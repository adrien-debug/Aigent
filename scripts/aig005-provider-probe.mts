/**
 * AIG-AGENT-QUALITY-005 — Lots B/C/D provider probe.
 *
 * Exercises the REAL model-router (routeCompletion) against each provider with
 * a BOUNDED call budget. Prints one structured JSON line per probe so the
 * evidence (resolved provider/model, modelVerified, fallbackUsed, error, cost)
 * is captured verbatim. No retries, no parallelism, no benchmark.
 *
 * Budget contract: OpenAI ≤5, Gemini ≤5 (throws before network when no key),
 * local ≤8. Run: npx tsx --conditions=react-server --env-file=.env.local <this>
 */
import { routeCompletion } from '@/lib/agent-mission-control/model-router'

type Probe = {
  lot: string
  name: string
  provider: 'openai' | 'google' | 'local'
  model: string
  responseFormat?: 'text' | 'json'
  tool?: boolean
  allowFallback?: boolean
}

const PROBES: Probe[] = [
  // Lot B — OpenAI (real provider on an existing config)
  { lot: 'B', name: 'openai-text', provider: 'openai', model: 'gpt-5.4' },
  { lot: 'B', name: 'openai-json', provider: 'openai', model: 'gpt-5.4', responseFormat: 'json' },
  { lot: 'B', name: 'openai-tool', provider: 'openai', model: 'gpt-5.4', tool: true },
  // Lot C — Gemini forced, fallback explicitly OFF (prove no silent OpenAI fallback)
  { lot: 'C', name: 'gemini-text', provider: 'google', model: 'gemini-2.5-flash', allowFallback: false },
  // Lot D — local vLLM forced, fallback OFF (prove no silent cloud fallback)
  { lot: 'D', name: 'local-text', provider: 'local', model: 'local-qwen-7b', allowFallback: false },
  { lot: 'D', name: 'local-json', provider: 'local', model: 'local-qwen-7b', responseFormat: 'json', allowFallback: false },
  { lot: 'D', name: 'local-unknown-model', provider: 'local', model: 'local-does-not-exist', allowFallback: false },
]

const TOOL = {
  name: 'get_status',
  description: 'Return a fixed status token.',
  parameters: { type: 'object', properties: { probe: { type: 'string' } }, required: ['probe'] },
}

async function main() {
  for (const p of PROBES) {
    const started = Date.now()
    try {
      const res = await routeCompletion({
        purpose: 'run',
        modelProvider: p.provider,
        model: p.model,
        allowFallback: p.allowFallback ?? false,
        responseFormat: p.responseFormat,
        maxOutputTokens: 64,
        messages: [
          { role: 'system', content: 'You are a terse probe target. Answer in the fewest tokens.' },
          {
            role: 'user',
            content: p.tool
              ? 'Call get_status with probe="live".'
              : p.responseFormat === 'json'
                ? 'Return exactly {"status":"ok","n":42} as JSON.'
                : 'Reply with the single word: PONG',
          },
        ],
        ...(p.tool ? { tools: [TOOL], toolChoice: 'required' as const } : {}),
      })
      console.log(
        'RESULT ' +
          JSON.stringify({
            lot: p.lot,
            probe: p.name,
            ok: true,
            requestedProvider: p.provider,
            requestedModel: p.model,
            resolvedProvider: res.resolvedProvider,
            resolvedModel: res.resolvedModel,
            modelVerified: res.modelVerified,
            fallbackUsed: res.fallbackUsed,
            silentFallback: res.fallbackUsed && res.resolvedProvider !== p.provider,
            textPreview: (res.text || '').slice(0, 40),
            parsedJson: res.parsedJson ?? null,
            toolCalls: (res.toolCalls ?? []).map((t) => t.name),
            inputTokens: res.inputTokens,
            outputTokens: res.outputTokens,
            costUsd: res.costUsd,
            latencyMs: res.latencyMs,
          }),
      )
    } catch (err) {
      console.log(
        'RESULT ' +
          JSON.stringify({
            lot: p.lot,
            probe: p.name,
            ok: false,
            requestedProvider: p.provider,
            requestedModel: p.model,
            errorType: err?.constructor?.name ?? 'Error',
            errorMessage: (err instanceof Error ? err.message : String(err)).slice(0, 160),
            latencyMs: Date.now() - started,
          }),
      )
    }
  }
}

await main()
