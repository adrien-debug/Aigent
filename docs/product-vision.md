# Aigent — product vision

> What this platform is FOR. Not what is built (`docs/current-capabilities.md`),
> not how it is built (`docs/architecture.md`), not what is missing
> (`docs/known-gaps.md`).

## The one sentence

**Aigent is the central plane where LLM agents are created, qualified, shipped,
observed and improved.** It is not itself the product the end user touches — the
agents it produces run inside *consumer* products.

## The loop

```
            ┌──────────────────────────────────────────────┐
            │                  AIGENT                      │
            │                                              │
   author ──┤  create  →  qualify  →  ship                 │
            │     ↑                     │                  │
            │   improve  ←  telemetry ← │                  │
            └──────┼────────────────────┼──────────────────┘
                   │                    ▼
                   │           ┌─────────────────┐
                   └───────────┤ CONSUMER PRODUCT │
                     runtime   │ executes agents  │
                     telemetry └─────────────────┘
```

1. **Create** — an operator describes an agent in natural language; the
   architect produces a structured manifest (prompt, tools, routes, forbidden
   actions, confirmation policy, cost limits), not prose.
2. **Qualify** — tests, benchmarks, shadow, replay, release gate. An agent is
   `active` only when a real run proved it. Status is never hand-flipped.
3. **Ship** — the agent's artifacts are pushed into the consumer repository.
   The consumer workspace holds the activate / rebind / deploy gestures; Aigent
   only pushes.
4. **Execute** — the consumer product runs the agent, in the consumer's own
   infrastructure, against the consumer's own data.
5. **Telemetry back** — the deployed handler reports runs back to Aigent over a
   dedicated, narrowly-scoped ingestion endpoint. Aigent's own internal runs are
   fed into the same table, so one channel holds both.
6. **Improve** — Aigent reads that history and proposes a governed V2: analyze →
   propose → materialize a draft → compare → human decision. A V2 never
   auto-promotes.

## The non-negotiable: truth over comfort

This platform exists to say what an agent actually does, so every surface obeys
the same rule: **an unmeasured value travels as `null` plus a state, never as
`0`.** No agent is `active` because someone wrote `active`. No number renders
because a query returned an empty array. No screen claims "all systems
reporting" over three page-scoped reads.

The canonical statement of that rule and its per-metric application lives in
`docs/metrics-canon.md`; the gates that enforce it are
`npm run check:render-truth`, `check:status-truth`, `check:agent-truth`.

## What Aigent is NOT

- Not an end-user chat product.
- Not a runtime host — consumer products execute their own agents.
- Not a marketplace. The agent catalogue is Adrien's own fleet.
- Not a mock. There is no fixture path for authoring or running an agent; without
  the live backend and provider credentials, those paths return `503`.
