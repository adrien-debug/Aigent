# TradeAgent trading gamme — static delivery packages (AIG-PACK-015)

Deterministic, reproducible, checksummed export of the **six founding trading
copilots** — Atlas, Vector, Sentinel, Pulse, Meridian, Sage — from the **truth
materialized at commit `d448441`** (`feat(trading-factory): materialize +
benchmark + V2 the 6 agents to >=90%`).

This is a **SNAPSHOT-ONLY** artifact. Generating it calls no LLM, hits no
network, reads no secret, and regenerates no benchmark. It is a pure function of
one frozen input: `_snapshot/db-truth.json` (captured once from the gpu1
`aigent` PostgREST perimeter, then committed).

## Layout

```
delivery/tradeagent/
  manifest.json                 # global manifest: per-package checksums + global checksum
  README.md                     # this file
  _snapshot/db-truth.json       # FROZEN input — the materialized DB truth (never edited by the exporter)
  <slug>/
    package.json                # identity, version, model, prompt/contract, tools, provenance, evidence, benchmark, markets
    contract.json               # the versioned output-contract descriptor (v1.0.0)
    checksum.txt                # sha256 of package.json and contract.json
```

The six slugs: `atlas-market-structure`, `vector-quant-regime`,
`sentinel-risk-manager`, `pulse-execution-scout`, `meridian-macro-context`,
`sage-trading-coach`.

## What each package records

- **identity / version / model** — slug, name, delivered version label
  (`v0.2.0-draft`, the V2 improved version), stage, `gpt-5.4` / openai.
- **prompt** — the full authorized system prompt verbatim, plus
  confirmationPolicy, forbiddenActions, allowedRoutes, alwaysConfirmActions, and
  step/cost caps.
- **contract** — the versioned output contract (`contractVersion v1.0.0`,
  schemaName, invariants) the consumer pins.
- **tools** — every manifest tool resolved to name / provider / riskLevel /
  confirmation. All internal, low-risk, read-only (`toolGuarantee.allReadOnly`).
- **provenance** — source commit `d448441`, backend, snapshot file, copilotId,
  assistantId, projectId (`null` = validation bench), targetProjectIds, tags.
- **evidenceLevel** — `FIXTURE` (scored offline on a frozen scenario; truth
  stays FIXTURE, never presented as LIVE).
- **benchmark** — the EXISTING persisted benchmark read from
  `copilot_versions.scores` (global `0.985`, testPassRate `1`,
  contractCompliance `1`, unsafeActionCount `0`). Never recomputed here.
- **marketCompatibility** — reconciled to the **real TradeAgent backend**:
  `backendExecutableMarkets: [ETH, BTC, SOL, XAU]`. "ETH-only" is only a runtime
  retail-surface allowlist (`MARKET_EXECUTABLE_SYMBOLS`), **not** a backend
  capability limit. The agents were authored against the ETH executable pairs
  with BTC as correlation context.

## Reproduce

```bash
node scripts/export-trading-packages.mjs          # writes into delivery/tradeagent/
node scripts/export-trading-packages.mjs --out /tmp/exp2
diff -r delivery/tradeagent /tmp/exp2             # (ignore _snapshot) -> identical
```

Two exports are **byte-identical** (canonical JSON: recursively sorted keys,
2-space indent, LF, trailing newline; no wall-clock timestamp). The current
global checksum is recorded in `manifest.json` (`globalChecksum`).

## Verify integrity

Each `checksum.txt` and the global `manifest.json` carry recomputable sha256s:

```bash
# per package
shasum -a 256 delivery/tradeagent/sentinel-risk-manager/package.json
cat        delivery/tradeagent/sentinel-risk-manager/checksum.txt

# global — a re-export must reproduce manifest.json's globalChecksum
node scripts/export-trading-packages.mjs --out /tmp/verify
```

Any single flipped byte in a package changes its sha256 and no longer matches
the manifest-recorded value — tamper is detected.

## Safety gate

`sentinel-risk-manager` (risk authority) and `pulse-execution-scout` (execution
gate) are safety-critical. If either agent's contract descriptor is invalid at
export time, the exporter **aborts non-zero and writes nothing** — an invalid
safety contract is never delivered.

## Tests

`tests/unit/export-trading-packages.test.ts` (pure, offline, run via
`npm test`) proves: structure + required fields, per-package and global checksum
correctness, two-export byte-identity, idempotent re-export, one-byte tamper
detection, and the Sentinel/Pulse safety-gate block.

## Boundary

These packages **activate nothing**. No promotion to production, no push to the
TradeAgent repo, no order/account/mainnet path. Delivery/push is a separate,
human-gated step outside this artifact.
