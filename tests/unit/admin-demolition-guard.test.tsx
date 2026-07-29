/**
 * P007 — the two admin placeholders render, and nothing pulls a demolished
 * visual layer back in through the render tree. `scripts/check-no-legacy-front.mjs`
 * covers the repo-wide import/route sweep (see `npm run check:no-legacy-front`);
 * this suite covers the one thing a static grep cannot: that the pages actually
 * mount without throwing.
 */
import { render } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import AdminPage from '@/app/admin/page'
import RunsPage from '@/app/admin/runs/page'

describe('admin placeholders — render without a legacy dependency', () => {
  it('/admin mounts and shows the placeholder copy', () => {
    const { getByText } = render(<AdminPage />)
    expect(getByText('Aigent')).toBeTruthy()
    expect(getByText(/previous admin interface has been removed/i)).toBeTruthy()
  })

  it('/admin/runs mounts and shows the placeholder copy', () => {
    const { getByText } = render(<RunsPage />)
    expect(getByText('Runs')).toBeTruthy()
    expect(getByText(/run console has been removed/i)).toBeTruthy()
  })
})
