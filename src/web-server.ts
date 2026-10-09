import { type ChildProcess, spawn } from 'node:child_process'
import { createWriteStream } from 'node:fs'
import { mkdir } from 'node:fs/promises'
import path from 'node:path'
import type { WebServerConfig } from './config.ts'

/** Whether something answers at `url` (any HTTP status counts: the server is up). */
async function answers(url: string): Promise<boolean> {
  try {
    await fetch(url, { signal: AbortSignal.timeout(2000) })
    return true
  } catch {
    return false
  }
}

/**
 * Makes sure the app is running: reuses one already answering at the URL, or
 * starts `command` (output to <out>/server.log) and waits for it. Returns a
 * function that stops what was started (the whole process group, so a dev
 * server's own children go too); a reused server is left alone.
 */
export async function ensureWebServer(
  config: WebServerConfig,
  fallbackUrl: string,
  { cwd, out, log }: { cwd: string; out: string; log: (line: string) => void },
): Promise<() => Promise<void>> {
  const url = config.url ?? fallbackUrl
  if ((config.reuseExisting ?? true) && (await answers(url))) {
    log(`web server: using the one already at ${url}`)
    return async () => {}
  }
  await mkdir(out, { recursive: true })
  const logFile = path.join(out, 'server.log')
  const output = createWriteStream(logFile)
  log(`web server: starting "${config.command}" (output in ${path.relative(process.cwd(), logFile)})`)
  const child: ChildProcess = spawn(config.command, { cwd, shell: true, detached: true, stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env, BROWSER: 'none' } })
  child.stdout?.pipe(output)
  child.stderr?.pipe(output)
  let exited: number | null = null
  child.on('exit', (code) => {
    exited = code ?? 0
  })

  const stop = async () => {
    if (exited !== null || child.pid === undefined) return
    try {
      process.kill(-child.pid, 'SIGTERM')
    } catch {
      // already gone
    }
    await new Promise((r) => setTimeout(r, 300))
  }
  // Don't leave a dev server running, however uiscout ends (exit codes included).
  process.once('exit', () => {
    if (exited === null && child.pid !== undefined) {
      try {
        process.kill(-child.pid, 'SIGTERM')
      } catch {
        // already gone
      }
    }
  })
  for (const signal of ['SIGINT', 'SIGTERM'] as const) process.once(signal, () => process.exit(130))

  const deadline = Date.now() + (config.timeout ?? 60) * 1000
  while (Date.now() < deadline) {
    if (exited !== null) throw new Error(`web server "${config.command}" exited with code ${exited} before answering: see ${logFile}`)
    if (await answers(url)) {
      log(`web server: up at ${url}`)
      return stop
    }
    await new Promise((r) => setTimeout(r, 500))
  }
  await stop()
  throw new Error(`web server "${config.command}" didn't answer at ${url} within ${config.timeout ?? 60}s: see ${logFile}`)
}
