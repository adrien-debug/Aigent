# Known gaps — what is honestly missing

> Companion to `docs/current-capabilities.md`. That file says what state each
> capability is in; this one says why the gap matters and what closing it means.
> Nothing here is speculation — every gap was established by reading the code.

## 1. The console is a read console. The lifecycle has no buttons.

The single biggest gap. Six screens render the fleet honestly, but the only
write surface in the whole console is the project builder. Qualify, promote,
improve, ship, shadow, replay, run a test suite, launch a benchmark — all of it
is real, tested HTTP, reachable only with `curl` or a script.

Proof: `grep "fetch("` across `src/components/console/*.tsx` returns exactly
three endpoints, all under `projects/[id]/builder/`.

Consequence: an operator cannot drive the product loop from the product. The
loop described in `docs/product-vision.md` is true of the *platform*, not yet of
the *interface*.

## 2. Telemetry comes back and then stops.

Ingestion is solid — dedicated token, hardened payload handling, a table that
holds both consumer-reported runs and Aigent's own. But of the data going in:

- `summarizeRuntimeTelemetry` (per-agent) is read by the improvement loop. ✅
- `summarizeFleetRuntimeTelemetry` and `listRecentRuntimeTelemetryEvents` have
  **zero production callers** — only unit tests.
- `telemetry-health.ts` is imported by **nothing** under `src/`.

So there is no fleet-level view of what deployed agents are actually doing, and
no diagnostic that tells you whether the return channel is even alive. The
`/admin/telemetry` route that would have shown it was deleted and is now
forbidden by `check-no-legacy-front.mjs`.

## 3. Shipping is double-gated off by default.

`push-agent` writes to a real GitHub repo only when **both** `confirm: true` is
in the body and `GITHUB_PUSH_ENABLED=1` is in the environment. Otherwise it is a
dry run. That is the correct default for a destructive remote write — but it
means the shipping leg of the loop is not exercised in normal operation, and
"Aigent ships agents" is a claim about a path that is off unless someone turns
it on deliberately.

## 4. The tool builder builds one tool.

`count_words` is the only tool with a sandbox. The build-mission machinery
(`tool_build_missions`, migration `0043`) is general; the sandbox coverage is not.

## 5. `mistral` is declared and not wired.

It throws a typed error rather than falling back silently — which is the right
failure — but any doc or config that lists it as a provider option is listing
something that cannot run.

## 6. Documentation drift is a recurring failure mode here.

Before this pass, `CLAUDE.md` and `AGENTS.md` both asserted that `/admin` and
`/admin/runs` were neutral placeholders and that visual reconstruction had not
begun, while `src/app/admin/` held six live screens and ~4 600 lines of console
components. `README.md` documented `/admin/factory`, `/admin/performance` and
`/admin/agents/new` — three routes that the build gate now actively forbids.

There is no gate that checks a doc against the code. Until there is, this file
and `docs/current-capabilities.md` are only as fresh as the last person who read
the source.

## 7. Visual doctrine is thin relative to the console that exists.

`AGENTS.md` holds the accent rule and the Catalyst-primitives rule, and
`check:render-truth` / `check:status-truth` enforce truthful rendering. But the
gates that once guarded the design system itself — `check:ds`, `check:contrast`,
`check:catalyst`, `check:danger`, `check:views` — were removed with the old
dashboard and were never re-added for the new console. The doctrine that a rule
only counts when a tool enforces it currently has a hole here.

## Not verified in this pass

- Whether the live GPU1 backend currently holds the canonical TradeAgent roster
  in the documented state. That needs a live read; nothing here was run against
  the database.
- Whether the deployed consumer products are in fact emitting telemetry. The
  endpoint accepts it; whether anything calls it in production was not checked.
- Runtime behaviour of any kind. This pass read source only — no server was
  started, no test suite was run.
