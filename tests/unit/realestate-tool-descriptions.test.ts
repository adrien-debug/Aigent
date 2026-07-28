import { describe, expect, it } from 'vitest'

import { REALESTATE_TOOL_DESCRIPTIONS } from '@/lib/agent-mission-control/realestate/tool-descriptions'
import { REALESTATE_TOOL_HANDLERS } from '@/lib/agent-mission-control/realestate/tools'

describe('realestate tool descriptions', () => {
  it('covers every registered handler with a model-facing description', () => {
    for (const toolId of Object.keys(REALESTATE_TOOL_HANDLERS)) {
      expect(REALESTATE_TOOL_DESCRIPTIONS[toolId], toolId).toBeTruthy()
    }
  })
})
