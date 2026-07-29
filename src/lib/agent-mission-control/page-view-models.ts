/**
 * View models for the page-data loaders.
 *
 * EXTRACTED BY P006. These three shapes used to be declared inside the deleted
 * visual components (`agent-ops/factory/certified-tools-panel.tsx`,
 * `agent-ops/factory/runtimes-panel.tsx`,
 * `agent-ops/agent-detail/evolution-workbench.tsx`), and the server-side page
 * data modules imported them FROM the components — business logic depending on
 * rendering. Deleting the front would have taken the contracts with it.
 *
 * They are plain data: no JSX, no styling, no React. They describe what a
 * loader returns, which is why they belong here and not in a component.
 */

/** A tool as the Factory surfaces it — see `factory-tools-page-data.ts`. */
export interface FactoryToolRow {
  id: string
  version: string
  label: string
  summary: string
  kind: string
  mutates: boolean
  risk: 'low' | 'medium' | 'high'
  requiresConfirmation: boolean
  provenance: string
  certification: 'certified' | 'draft' | 'deprecated'
}

/** A runtime and what it can actually do — see `factory-page-data.ts`. */
export interface FactoryRuntimeRow {
  id: string
  label: string
  engine: string
  executable: boolean
  creatable: boolean
  capabilities: {
    tools: boolean
    streaming: boolean
    hitl: boolean
    checkpoints: boolean
    telemetry: boolean
  }
  note: string
}

/** A test or benchmark suite reference — see `agent-evolution-page-data.ts`. */
export interface EvolutionSuiteRef {
  id: string
  name: string
}
