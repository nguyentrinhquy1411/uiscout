import { existsSync } from 'node:fs'
import { cp, mkdir, readdir, readFile, rm, writeFile } from 'node:fs/promises'
import path from 'node:path'

/*
 * uiscout site: the last run as a static site to host, one per pull request:
 * the graph page as index.html, its screenshots and the reports. What must not
 * be published is left out: the dev server's log, and anything else in the run
 * directory. Screenshots only with --screenshots. The graph page itself holds
 * each screen's text: host it where only the team can see it.
 */

const FILES = ['graph.json', 'findings.json', 'report.md', 'report.txt']
/** Marks a directory this command wrote, the only kind it will empty. */
const MARKER = '.uiscout-site'

export async function buildReportSite(out: string, to: string, { screens = false } = {}): Promise<string[]> {
  const page = path.join(out, 'graph.html')
  if (!existsSync(page)) throw new Error(`no ${page}: run uiscout check first`)
  if (existsSync(to)) {
    if ((await readdir(to)).length && !existsSync(path.join(to, MARKER))) throw new Error(`${to} exists and wasn't written by uiscout site: pick an empty or new directory`)
    await rm(to, { recursive: true, force: true })
  }
  await mkdir(to, { recursive: true })
  await writeFile(path.join(to, MARKER), '')
  // Reports of a private app: keep them out of search engines.
  const html = (await readFile(page, 'utf8')).replace(/<head>/i, '<head>\n<meta name="robots" content="noindex, nofollow">')
  await writeFile(path.join(to, 'index.html'), html)
  const written = ['index.html']
  for (const f of FILES) {
    if (!existsSync(path.join(out, f))) continue
    await cp(path.join(out, f), path.join(to, f))
    written.push(f)
  }
  // Screenshots show whatever the app showed: published only when asked for.
  if (screens && existsSync(path.join(out, 'screens'))) {
    await cp(path.join(out, 'screens'), path.join(to, 'screens'), { recursive: true })
    written.push('screens/')
  }
  return written
}
