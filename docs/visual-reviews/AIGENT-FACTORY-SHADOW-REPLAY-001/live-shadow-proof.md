# Live shadow proof — real LangGraph execution

Reproducible proof that `useFixture:false` runs the candidate through the **real LangGraph runtime** and persists `execution_mode: 'live_langgraph'` — the only provenance a REQUIRED promotion-gate shadow check accepts. Captured against gpu1 via the product API on a disposable copilot (created + deleted through the product routes, no direct SQL), commit `70b8288`.

## Command
```
POST /api/agent-ops/copilots/<id>/versions/<versionId>/shadow
Body: { "inputs": ["What is 2+2? ..."], "useFixture": false }
```

## Route response
```json
{"ok":true,"experimentId":"shadow-1e3d488d-826d-4d96-ad16-5813bbe2af56","verdict":"PASS","sampledRunCount":1,"wouldMutateCount":0}
```

## Persisted evidence row (shadow_experiments, read back from gpu1)
```json
[{"execution_mode":"live_langgraph","candidate_verdict":"PASS","status":"completed","sampled_run_count":1,"would_mutate_count":0}]
```

`execution_mode = live_langgraph` confirms the real Agent Server ran it (not a fixture). `would_mutate_count = 0` confirms no mutating tool executed (mutating tools interrupt at the graph approval checkpoint, never invoked).

To reproduce: `npm run dev` (dev-stack, local LangGraph on 2024), create a langgraph copilot with a read-only tool, POST the shadow route with `useFixture:false`.
