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

export const projectTeamNodeStatusSchema = z.enum([
  'active',
  'waiting',
  'blocked',
  'failed',
  'idle',
  'draft',
  'unavailable',
])

export const projectTeamNodeKindSchema = z.enum(['project', 'group', 'agent'])

export const projectTeamEdgeRelationSchema = z.enum([
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
    metrics: z
      .object({
        totalRuns: z.number().int().min(0),
        runsToday: z.number().int().min(0),
        successRate: z.number().min(0).max(1).nullable(),
      })
      .strict(),
    tools: z.array(z.object({ id: z.string(), name: z.string() }).strict()),
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
      })
      .strict(),
    summary: z
      .object({
        totalAgents: z.number().int().min(0),
        activeAgents: z.number().int().min(0),
        waitingAgents: z.number().int().min(0),
        blockedAgents: z.number().int().min(0),
        failedAgents: z.number().int().min(0),
        draftAgents: z.number().int().min(0),
        runsToday: z.number().int().min(0),
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
