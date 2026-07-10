import { Button } from '@/components/catalyst/button'

/**
 * "Run tests" trigger. There is no execution runner yet, so rather than fake a
 * queued state the button reads honestly disabled — it ships when the runner
 * lands (V2). No mock, no fake success.
 */
export function RunTestsButton() {
  return (
    <Button color="accent" disabled title="Test execution ships with the runner (V2)">
      Run tests
    </Button>
  )
}
