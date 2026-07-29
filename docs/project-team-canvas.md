ARCHIVED — historical state, not current doctrine

# My Team — project agent canvas (AIG-TEAM-CANVAS-002)

Live map of every agent attached to a project, as a graph.

- **Route** — `/admin/projects/[id]/team`
- **API** — `GET /api/agent-ops/projects/[id]/team`
- **Sub-nav** — `Overview · Agent Builder · My Team`

The tab set contains only project routes that actually exist. `Runs`, `Tools`,
`Benchmarks` and `Settings` are **not** listed because there are no such project
pages today — listing them would ship links to 404s.

## Architecture

```
src/lib/agent-mission-control/project-team/
  types.ts      ProjectTeamGraph / Node / Edge — the single contract
  schema.ts     zod (.strict()) validation of the outgoing payload
  status.ts     pure status derivation
  relations.ts  pure edge derivation + the truth rules
  layout.ts     pure deterministic layout (no React, no DOM, no clock)
  data.ts       getProjectTeamGraph(projectId) — server-only
```

The rendering layer (ReactFlow canvas, nodes/edges, toolbar, panel, empty states,
polling hook) lived under `src/components/agent-ops/project-team/` and was removed
with the legacy dashboard front (P007). The contract below (`getProjectTeamGraph`,
node/edge sourcing, status derivation, layout) is backend and still live.

`getProjectTeamGraph` is the **single** source: the page calls it server-side,
the API route calls the same function. No logic is duplicated between them.

The canvas is deliberately presentational — it fetches nothing, reads no URL and
owns no filter logic. That is what makes it portable to another project: hand it
a `ProjectTeamGraph` and it draws.

### Engine

`@xyflow/react` 12.11.2 for the interactive surface. **elkjs is deliberately not
used**: the mission requires a deterministic layout and unit-testable placement,
and an async/worker layout engine makes both harder. `layout.ts` is a pure
function — same input, byte-identical output — so it is tested directly.

The fixed 5-node LangGraph execution diagram (`graph-canvas-svg.tsx`, deleted with
the legacy dashboard front, P007) was **not** reused here — it had hardcoded
positions and no zoom/pan/minimap; the two surfaces answered different questions.

## Where nodes come from

| Node kind | Source | Counted as an agent? |
|---|---|---|
| `project` | `projects` row | no |
| `group` | derived from `copilots.tags` (see below) | no |
| `agent` | `copilots` where `project_id = <id>` | yes |

Isolation is enforced twice: the query is scoped `project_id=eq.<id>`, and the
result is re-filtered in memory on strict equality. A copilot with a **NULL**
`project_id` (6 exist in the live DB) can therefore never appear, and neither
can one merely *targeting* the project via `target_project_ids`.

## Where edges come from — explicit vs derived

`origin` is mechanical: **`explicit` ⟺ a persisted row states this exact edge.**

| Relation | Origin | Backed by |
|---|---|---|
| `project-membership` (agent → project) | `explicit` | `copilots.project_id`, verbatim |
| `project-membership` (group → project) | `derived` | the group itself is a construct |
| `team-membership` (agent → group) | `derived` | `copilots.tags` + `TEAM_TAG_RULES` |
| `orchestrates` | `derived` | `mission_runs.orchestrator_copilot_id` + participants |
| `shares-tool` | `derived` | two agents declaring the same `tools.name` |
| `depends-on`, `sends-output-to`, `reviews`, `triggers` | `explicit` | `project_agent_relations` rows |

Derived edges render **dashed** and are worded as derived in the panel. Nothing
in the UI may present a derived edge as something an operator configured.

**Never inferred**, by design: an orchestrator from an agent's *name*; hierarchy
from the *model* used; a dependency from mere project co-membership; a workflow
from temporal proximity. `triggers` derives nothing today because no persisted
reference exists — it stays empty rather than being guessed.

### Team grouping

Groups come from `copilots.tags` via the exported ordered allowlist
`TEAM_TAG_RULES`. `PROVENANCE_TAGS` (`drafted`, `agent-builder`, `repo-aware`,
`bench`, `internal`, `controlled`, …) can never form a team: they describe how an
agent was *born*, not what it *does*. An agent matching no functional tag gets
`team: null` and attaches straight to the project node. A group is only created
at `MIN_GROUP_SIZE = 2` — a lone agent never gets one.

### The commodity-tool threshold

`shares-tool` is only emitted for a tool name held by at most
`SHARED_TOOL_MAX_AGENTS = 4` agents in the project. In the live DB
`read_copilot_summary` sits on 14 copilots; without the cap that single tool
would emit 91 edges of pure noise. A tool everyone has carries no signal.

## Status derivation

Priority order, in `status.ts` (pure, unit-tested):

1. `draft` — copilot not materialised
2. `unavailable` — runs unreadable (evaluated early: if the runs cannot be read,
   rules 3–6 cannot be answered honestly)
3. `active` — a run is genuinely `running`
4. `waiting` — a run is `needs-confirmation`
5. `blocked` — latest terminal run blocked, no newer success
6. `failed` — latest terminal run failed, no newer success
7. `idle` — available, no current activity

`active` is **never** derived from `copilots.status`. A copilot configured as
"active" with no running run is `idle`. Availability, activity and last run are
displayed as three separate facts.

An empty run list is a real `idle`, not `unavailable` — never having run is a
fact; being unable to read is not.

## Missing data is never a zero

The rule the whole feature is built around: **a measured zero and an unknown are
different facts and must never render identically.**

- `summary.{active,waiting,blocked,failed}Agents` are `number | null`. They are
  facts only when `unavailableAgents === 0`; otherwise they are `null`, because
  publishing the countable subset would publish a floor as a total.
- `summary.unavailableAgents` is always a fact — it is the number that *explains*
  why the others are dashes.
- `node.runHistory` is `'known' | 'unreadable' | 'outside-window' |
  'not-applicable'`, so "never ran" is distinguishable from "could not read" and
  from "older than the read window".
- `node.toolsUnavailable` distinguishes "declares no tool" from "tools unreadable".
- `freshness.latestActivityState` distinguishes "never active" from "unreadable".
- `projectNode.totalRuns` is **exact** (PostgREST `count=exact` via
  `Content-Range`), never the length of a truncated window.

Unknown values render as an em dash — never `0`, never the string `null`.

## Edge activity

An edge is `active` only when a **persisted fact evidences an event on that
relation** — today, a `mission_runs` row tying an orchestrator to a participant.
Two agents merely having run recently is *co-activity*, not traffic, and can no
longer light an edge or animate flow. Membership and `shares-tool` are
structurally incapable of being active: "belongs to" and "declares the same tool"
are not channels.

Because `mission_runs.orchestrator_copilot_id` is written `null` today, **every
edge is currently `active: false` and the Activity view animates nothing.** That
is the correct output, not a regression: nothing persisted evidences traffic.
Flow lights up on its own once orchestrators start being recorded.

## View modes

`structure` (default) · `activity` · `dependencies`. They change **visual
priority only** — never the data, never the node set.

## Refresh

Client polling every 10s (`use-project-team-refresh.ts`): paused while the tab is
hidden, `AbortController` cancels in-flight requests, and the graph is swapped
only when the payload really changed, so the `aria-live` region stays silent on
identical polls. No WebSocket, no SSE.

## Layout

Deterministic, in three layers: project anchor → groups → agents. Clusters are
placed radially for 3–8 clusters and shelf-packed otherwise; the rule is
documented in `layout.ts`. Non-overlap is by construction with a minimum
separation of 24px.

`computeTeamLayout` **structurally cannot see a status** — its input type omits
status, metrics and runs — so a status refresh physically cannot move a node.
The canvas additionally memoizes on `teamLayoutSignature` (ids, kinds,
membership) to keep position objects reference-stable across polls.

## API status codes

| Situation | Code |
|---|---|
| No session / no `x-amc-key` | 401 (central gate, `src/proxy.ts`) |
| Malformed project id | 400 |
| Backend not configured | 503 |
| Unknown project | 404 |
| PostgREST timeout | 504 |
| Request-time upstream failure | 502 |
| Payload fails its own contract | 500 |

502-vs-503 follows the repo convention (503 is reserved for "not configured"),
which is narrower than the mission brief's "backend unavailable → 503".

The payload never carries `manifests.system_prompt_summary`, tokens, secrets or
full configuration. Errors are logged server-side and answered with a generic
body; `pgrestDetail` never reaches a client.

## Migration

`supabase/migrations/0019_project_agent_relations.sql` adds
`project_agent_relations` (FKs with cascade, `CHECK` on the relation enum, no
self-edge, unique directed pair, three indexes, RLS deny-by-default, service_role
grants).

**Cross-project relations are rejected at read time, not by a DB constraint.** A
composite FK would break against the NULL-`project_id` copilots and freeze
reassignment. `buildTeamEdges` drops any row whose `project_id` mismatches or
whose endpoints are not both members. There is **no write path today** — a future
writer MUST re-verify both endpoints' `project_id`.

### Adding an explicit relation

```sql
insert into project_agent_relations
  (id, project_id, source_copilot_id, target_copilot_id, relation_type, label)
values
  (gen_random_uuid()::text, 'proj-x', 'copilot-a', 'copilot-b', 'depends-on', 'Reads its output');
```

Both copilots must belong to `project_id` or the edge is dropped on read.

## V1 limits

- No write path for `project_agent_relations` (SQL only).
- `orchestrates` derives nothing until `mission_runs.orchestrator_copilot_id` is
  actually written; consequently no edge is ever `active` yet.
- `node.role` is always `null` — there is no role column, and deriving one from
  the name is exactly the inference the doctrine forbids. The field is in the
  contract so a persisted role slots in later.
- Node positions are not persisted; manual drag is session-local.
- Renderer helpers have no unit tests: vitest runs under
  `resolve.conditions: ['react-server', …]` and `@headlessui/react` throws at
  import, so no `.tsx` component test can run in this harness today.

## Performance

Aggregation is server-side: one query per concern (copilots, runs, tools,
relations, missions), tools chunked at 100 ids. **No fetch per agent, no query
per edge.** The copilot read is scoped to the project and deliberately avoids
`getCopilots()`, whose health enrichment costs 5 extra cross-table round trips
the graph never reads.

## Validation

```bash
npm run typecheck
npm run lint
npm run test
npm run build
# or all of it:
npm run verify
```

Browser checks that matter: canvas share of viewport, no horizontal scroll at
375px, empty state on a project with no agent, `?agent=`/`?view=` round-trip,
Escape closing the panel, and reduced-motion.
