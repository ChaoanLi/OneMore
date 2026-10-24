/** Let command callers acknowledge results before a locale change invalidates reads. */
let pending = 0
const waiting = new Set<() => void>()

export function beginCommand(): () => void {
  pending++
  return () => {
    // A task boundary also lets the caller store one-time credentials / navigate.
    // Resolving the transport alone is too early: its await continuation is still queued.
    setTimeout(() => {
      pending--
      if (!pending) {
        const callbacks = [...waiting]
        waiting.clear()
        callbacks.forEach((run) => run())
      }
    }, 0)
  }
}

export function afterCommands(action: () => void): Promise<void> {
  return new Promise((resolve) => {
    const run = () => {
      action()
      resolve()
    }
    if (pending) waiting.add(run)
    else run()
  })
}
