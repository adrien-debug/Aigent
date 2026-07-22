/**
 * Project Team Canvas — zod validation of the OUTGOING contract.
 *
 * The graph is assembled from several independent reads (copilots, runs, tools,
 * relations, missions). This schema is the last gate before it leaves the
 * server: a shape drift, a stray field, or a status the UI cannot render fails
 * here rather than half-rendering on the canvas.
 *
 * `.strict()` on every object is deliberate — it is what makes an accidental
 * `systemPromptSummary` (or any other unplanned field) a hard validation
 * failure instead of a silent leak.
 */
import { z } from 'zod'

import type { ProjectTeamGraph } from './types'

const projectTeamNodeStatusSchema = z.enum([
  'active',
  'waiting',
  'blocked',
  'failed',
  'idle',
  'draft',
  'unavailable',
])

const projectTeamNodeKindSchema = z.enum(['project', 'group', 'agent'])

const projectTeamEdgeRelationSchema = z.enum([
  'project-membership',
  'team-membership',
  'orchestrates',
  'depends-on',
  'sends-output-to',
  'reviews',
  'triggers',
  'shares-tool',
])

export const projectTeamEdgeOriginSchema = z.enum(['explicit', 'derived'])

/**
 * Disambiguates a `null` `latestRun`. Part of the contract, not a hint: without
 * it "never ran", "unreadable" and "outside the read window" all serialize as
 * the same `null` and the UI turns missing data into a positive claim.
 */
export const projectTeamRunHistoryStateSchema = z.enum([
  'known',
  'unreadable',
  'outside-window',
  'not-applicable',
])

export const projectTeamActivityStateSchema = z.enum(['known', 'unreadable'])

export const projectTeamLatestRunSchema = z
  .object({
    id: z.string().min(1),
    status: z.enum(['completed', 'failed', 'blocked', 'needs-confirmation', 'running']),
    startedAt: z.string().nullable(),
    completedAt: z.string().nullable(),
    costUsd: z.number().nullable(),
    latencyMs: z.number().nullable(),
  })
  .strict()

export const projectTeamNodeSchema = z
  .object({
    id: z.string().min(1),
    kind: projectTeamNodeKindSchema,
    name: z.string(),
    slug: z.string().nullable(),
    role: z.string().nullable(),
    description: z.string().nullable(),
    team: z.string().nullable(),
    runtime: z.string().nullable(),
    model: z.string().nullable(),
    status: projectTeamNodeStatusSchema,
    latestRun: projectTeamLatestRunSchema.nullable(),
    runHistory: projectTeamRunHistoryStateSchema,
    // `.nullable()` on the counts is load-bearing, not laxity: it is what lets
    // "we could not read the runs" travel to the UI as UNKNOWN instead of
    // arriving as an indistinguishable `0`.
    metrics: z
      .object({
        totalRuns: z.number().int().min(0).nullable(),
        runsToday: z.number().int().min(0).nullable(),
        successRate: z.number().min(0).max(1).nullable(),
      })
      .strict(),
    tools: z.array(z.object({ id: z.string(), name: z.string() }).strict()),
    // An empty `tools` with this flag set claims NOTHING. Without the flag the
    // renderer reads `[]` as "no tool declared" — a factual assertion produced
    // by an exception.
    toolsUnavailable: z.boolean(),
    href: z.string().nullable(),
  })
  .strict()

export const projectTeamEdgeSchema = z
  .object({
    id: z.string().min(1),
    source: z.string().min(1),
    target: z.string().min(1),
    relation: projectTeamEdgeRelationSchema,
    origin: projectTeamEdgeOriginSchema,
    // Non-null ONLY for an edge that restates a persisted `project_agent_relations`
    // row — the only edges an operator can delete. Every derived edge is null.
    relationId: z.string().min(1).nullable(),
    label: z.string().nullable(),
    active: z.boolean(),
    lastActivityAt: z.string().nullable(),
    weight: z.number(),
  })
  .strict()

export const projectTeamGraphSchema = z
  .object({
    project: z.object({ id: z.string().min(1), name: z.string() }).strict(),
    generatedAt: z.string().min(1),
    freshness: z
      .object({
        source: z.literal('LIVE'),
        latestActivityAt: z.string().nullable(),
        latestActivityState: projectTeamActivityStateSchema,
      })
      .strict(),
    summary: z
      .object({
        totalAgents: z.number().int().min(0),
        // `.nullable()` here is the same load-bearing nullability the node
        // metrics already carry: an activity count that cannot be derived
        // travels as UNKNOWN instead of arriving as an authoritative `0`.
        activeAgents: z.number().int().min(0).nullable(),
        waitingAgents: z.number().int().min(0).nullable(),
        blockedAgents: z.number().int().min(0).nullable(),
        failedAgents: z.number().int().min(0).nullable(),
        draftAgents: z.number().int().min(0),
        unavailableAgents: z.number().int().min(0),
        runsToday: z.number().int().min(0).nullable(),
      })
      .strict(),
    nodes: z.array(projectTeamNodeSchema),
    edges: z.array(projectTeamEdgeSchema),
  })
  .strict()

/** Throws a ZodError on a contract violation. */
export function parseProjectTeamGraph(value: unknown): ProjectTeamGraph {
  return projectTeamGraphSchema.parse(value) as ProjectTeamGraph
}

/** Non-throwing variant, for callers that want to degrade rather than 500. */
export function safeParseProjectTeamGraph(
  value: unknown
): { success: true; data: ProjectTeamGraph } | { success: false; error: z.ZodError } {
  const result = projectTeamGraphSchema.safeParse(value)
  if (result.success) return { success: true, data: result.data as ProjectTeamGraph }
  return { success: false, error: result.error }
}
