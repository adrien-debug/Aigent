/**
 * Detect rows written by `scripts/dev-seed.mjs` so fleet surfaces can hide
 * dev-only fixtures from production-oriented views (performance leaderboard,
 * etc.). Disclosure lives in the seed labels; this module is the machine
 * check — NOT `seed-fixtures.ts` (type fixtures for seed-amc, never imported
 * from the app per `check:ds`).
 */
import type { Copilot, Project } from './types'

const SEED_PREFIX = 'seed-'
const SEED_NAME_PREFIX = 'seed · '

export function isDevSeedCopilot(copilot: Pick<Copilot, 'id' | 'slug' | 'name' | 'tags'>): boolean {
  if (copilot.tags.includes('seed')) return true
  if (copilot.name.startsWith(SEED_NAME_PREFIX)) return true
  if (copilot.id.startsWith(SEED_PREFIX) || copilot.slug.startsWith(SEED_PREFIX)) return true
  return false
}

export function isDevSeedProject(project: Pick<Project, 'id' | 'slug' | 'name'>): boolean {
  if (project.name.startsWith(SEED_NAME_PREFIX)) return true
  if (project.id.startsWith(SEED_PREFIX) || project.slug.startsWith(SEED_PREFIX)) return true
  return false
}
