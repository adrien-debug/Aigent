# Aigent — product vision

> **ARCHIVE — remplacé par `PRODUCT_DOCTRINE.md` (2026-08-03).**
>
> Ce document n'est plus une autorité. Il est conservé parce qu'il décrit
> fidèlement l'intention d'origine et la raison d'être de la boucle, ce qui reste
> utile à lire.
>
> **Il contient une affirmation désormais fausse** : « Not a runtime host —
> consumer products execute their own agents » (§ *What Aigent is NOT*). La
> décision d'architecture retenue est l'inverse — Aigent **est** le runtime
> gouverné canonique, et les produits consommateurs l'appellent. Voir
> `PRODUCT_DOCTRINE.md` §3.
>
> Ne pas citer ce fichier comme règle.

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

## Truth over comfort — why the product is shaped this way

Aigent exists to say what an agent actually does, so the whole platform is built
around one rule: **an unmeasured value travels as `null` plus a state, never as
`0`.** No agent is `active` because someone wrote `active`. No number is produced
because a query returned an empty array. No aggregate claims "all systems
reporting" over a handful of scoped reads.

> This section explains a design intent, it does not legislate. **The rule itself
> is stated in `AGENTS.md` § « Vérité des données »** — that file owns it. Its
> per-metric application is in `docs/metrics-canon.md`; which gates actually
> enforce it (and how narrow they are) is in `scripts/README-gates.md`.

## What Aigent is NOT

- Not an end-user chat product.
- Not a runtime host — consumer products execute their own agents.
- Not a marketplace. The agent catalogue is Adrien's own fleet.
- Not a mock. There is no fixture path for authoring or running an agent; without
  the live backend and provider credentials, those paths return `503`.
