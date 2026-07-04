/**
 * scheduler.ts - the loop engine for recurring async tasks.
 *
 * TODO:
 *   - class TaskScheduler(connector: LightConnector, onEvent: (msg: string) => void)
 *   - schedule(task): string  -> store task, start setInterval(intervalMs), return short id.
 *   - private tick(id): each interval, run up to N attempts:
 *       1. apply(task)      -> map TaskAction to a connector call (cycleColor advances hue each tick)
 *       2. verify           -> re-read connector.getState and check it matches intent
 *       3. retry w/ backoff -> on throw/mismatch, wait then retry; mark "error" after max tries
 *     Update runCount/lastRun/lastError and call onEvent(...) with a status line.
 *   - list(): ScheduledTask[]   cancel(id)   cancelAll()  (clearInterval + remove)
 *
 * Uses node:crypto randomUUID for ids. setInterval keeps the process alive (REPL must stay open).
 */
