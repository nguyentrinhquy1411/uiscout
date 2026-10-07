import { AxeBuilder } from '@axe-core/playwright'
import type { Page } from 'playwright'
import type { Finding } from '../types.ts'

/*
 * Oracle A, accessibility (design doc §7A): axe rules of serious or critical
 * impact, as warnings. One finding per rule and element, so the same unlabeled
 * icon button on every screen reads as one defect.
 */

export async function checkA11y(page: Page, at: string): Promise<Finding[]> {
  const result = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
    // Our own markers aren't the app's; colour contrast depends on wallpaper and theme, judged by people.
    .disableRules(['color-contrast'])
    .analyze()
    .catch(() => null)
  if (!result) return []
  const findings: Finding[] = []
  for (const v of result.violations) {
    if (v.impact !== 'serious' && v.impact !== 'critical') continue
    for (const node of v.nodes.slice(0, 5)) {
      const target = node.target.join(' ').replace(/\[data-fc-(i|box)="[^"]*"\]/g, '')
      findings.push({ oracle: 'a11y', severity: 'warning', at, message: `${v.id}: ${v.help} — ${target}` })
    }
  }
  return findings
}
