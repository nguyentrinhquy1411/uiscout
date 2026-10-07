/*
 * Builds the website: the landing page in site/ as is, plus one page per guide
 * chapter rendered from docs/guide/*.md, so the guide has a single source.
 *
 *   node scripts/build-site.ts [outDir]     (default: site-dist)
 */
import { cpSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { marked } from 'marked'

const out = process.argv[2] ?? 'site-dist'
const REPO = 'https://github.com/nguyentrinhquy1411/uiscout'

/** The sidebar, in reading order. Prev and next follow it. */
const GROUPS: Array<[string, Array<[file: string, title: string]>]> = [
  ['Start', [
    ['README', 'Overview'],
    ['01-install', 'Install and first run'],
    ['02-check', 'The check command'],
    ['03-config', 'Configuration'],
    ['04-graph', 'The graph page'],
  ]],
  ['Regressions', [
    ['05-baseline', 'Baselines'],
    ['06-network', 'Network modes'],
    ['10-plugin-affected', 'Plugin and affected runs'],
    ['11-ci', 'Running in CI'],
  ]],
  ['Deeper checks', [
    ['07-rules-intent', 'Rules and intent'],
    ['08-fuzz', 'Fuzzing'],
    ['09-adapters', 'Widget adapters'],
  ]],
  ['Beyond tests', [
    ['12-mcp', 'MCP for agents'],
    ['15-usage', 'Production usage'],
  ]],
  ['Reference', [
    ['13-safety', 'Safety'],
    ['14-troubleshooting', 'Troubleshooting'],
    ['cli-reference', 'CLI reference'],
  ]],
]
const PAGES = GROUPS.flatMap(([group, pages]) => pages.map(([file, title]) => ({ file, title, group })))
const pageName = (file: string) => (file === 'README' ? 'index' : file)

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!)
const slug = (html: string) =>
  html.replace(/<[^>]+>/g, '').replace(/&[a-z]+;/g, '').toLowerCase().trim().replace(/[^\w\s-]/g, '').replace(/\s+/g, '-')

/** Dims trailing comments in shell, YAML and TypeScript blocks. */
function dimComments(code: string, lang: string): string {
  const mark = /^(sh|bash|yaml|yml|text)$/.test(lang) ? /(^|\s)(#\s.*)$/ : /^(ts|js|tsx|json)$/.test(lang) ? /(^|\s)(\/\/.*)$/ : null
  if (!mark) return code
  return code.split('\n').map((l) => l.replace(mark, '$1<span class="c">$2</span>')).join('\n')
}

function render(md: string): { title: string; body: string } {
  // The chapter's own "Next:" line is replaced by the pager.
  md = md.replace(/^Next: .*$/m, '')
  let html = marked.parse(md, { async: false })
  let title = ''
  html = html.replace(/<h1>(.*?)<\/h1>/, (_, t: string) => {
    title = t.replace(/^\d+\.\s*/, '')
    return ''
  })
  html = html
    .replace(/<h([23])>(.*?)<\/h\1>/g, (_, n: string, t: string) => {
      const id = slug(t)
      return `<h${n} id="${id}">${t}<a class="anchor" href="#${id}" aria-label="Link to this section">#</a></h${n}>`
    })
    .replace(/<table>/g, '<div class="tbl"><table>')
    .replace(/<\/table>/g, '</table></div>')
    .replace(/<pre><code(?: class="language-([\w-]+)")?>([\s\S]*?)<\/code><\/pre>/g, (_, lang = '', code: string) =>
      `<pre class="code"><code>${dimComments(code.replace(/\n$/, ''), lang)}</code></pre>`)
    // Links between chapters, and out to the repository.
    .replace(/href="([\w-]+)\.md(#[\w-]+)?"/g, (_, f: string, hash = '') => `href="${pageName(f)}.html${hash}"`)
    .replace(/href="\.\.\/\.\.\/([^"]+)"/g, `href="${REPO}/blob/main/$1"`)
    .replace(/href="\.\.\/([^"]+)"/g, `href="${REPO}/blob/main/docs/$1"`)
  return { title: title.replace(/<[^>]+>/g, ''), body: html }
}

function header(prefix: string): string {
  return `<header class="top">
  <div class="wrap">
    <a class="brand" href="${prefix}index.html" aria-label="uiscout home">
      <svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><circle cx="5" cy="12" r="3" fill="currentColor"/><circle cx="19" cy="5" r="3" stroke="currentColor" stroke-width="2"/><circle cx="19" cy="19" r="3" stroke="currentColor" stroke-width="2"/><path d="M8 11 16 6.5M8 13l8 4.5" stroke="currentColor" stroke-width="2"/></svg>
      uiscout
    </a>
    <nav>
      <a href="${prefix}index.html#how" class="hide-sm">How it works</a>
      <a href="${prefix}docs/index.html">Docs</a>
      <a href="${REPO}">GitHub</a>
    </nav>
  </div>
</header>`
}

function page(i: number): string {
  const p = PAGES[i]
  const { title, body } = render(readFileSync(join('docs/guide', `${p.file}.md`), 'utf8'))
  const toc = GROUPS.map(([group, pages]) =>
    `<p>${group}</p>\n` + pages.map(([file, label]) =>
      `<a href="${pageName(file)}.html"${file === p.file ? ' aria-current="page"' : ''}>${esc(label)}</a>`).join('\n')).join('\n')
  const prev = PAGES[i - 1], next = PAGES[i + 1]
  const pager = `<nav class="pager" aria-label="Chapters">
${prev ? `<a class="prev" href="${pageName(prev.file)}.html"><small>Previous</small>${esc(prev.title)}</a>` : ''}
${next ? `<a class="next" href="${pageName(next.file)}.html"><small>Next</small>${esc(next.title)}</a>` : ''}
</nav>`
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<title>${esc(title)} · uiscout</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Archivo:wdth,wght@112,500;112,700;125,800&family=IBM+Plex+Sans:wght@400;500;600&family=IBM+Plex+Mono:wght@400;500&display=swap">
<link rel="stylesheet" href="../style.css">
</head>
<body>
${header('../')}
<main class="manual">
  <div class="wrap">
    <nav class="toc" aria-label="Guide">
${toc}
    </nav>
    <article class="doc">
      <div class="num">${esc(p.group.toUpperCase())}</div>
      <h1>${esc(title)}</h1>
${body}
      <p class="edit"><a href="${REPO}/blob/main/docs/guide/${p.file}.md">Edit this page on GitHub</a></p>
${pager}
    </article>
  </div>
</main>
<script src="../site.js"></script>
</body>
</html>
`
}

rmSync(out, { recursive: true, force: true })
mkdirSync(join(out, 'docs'), { recursive: true })
cpSync('site', out, { recursive: true })
for (let i = 0; i < PAGES.length; i++) writeFileSync(join(out, 'docs', `${pageName(PAGES[i].file)}.html`), page(i))
console.log(`${out}/: landing page and ${PAGES.length} guide pages`)
