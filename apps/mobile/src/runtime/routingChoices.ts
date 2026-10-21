// Labels for Auto's "Choose a project" list. Projects with the same name on different hosts carry the host name;
// projects with the same name on the same host carry their folder, so every row in the list is distinguishable.
import { routingLabels } from '@ramu/shared/workspace/projectRouting'

export interface RoutingChoiceProject {
  id: string
  name: string
  /** Display name of the project's host. */
  host: string
  root: string | null
}

export interface RoutingChoiceLabel {
  label: string
  /** True when the label already names the project's folder, so the caption need not repeat it. */
  showsRoot: boolean
}

/** Same name as Auto's routing compares names (case and accents ignored), via routingLabels' own duplicate check. */
const sameName = (a: RoutingChoiceProject, b: RoutingChoiceProject) =>
  routingLabels([
    { id: 'a', name: a.name, host: '-' },
    { id: 'b', name: b.name, host: '-' },
  ]).get('a') !== a.name

export function routingChoiceLabels(projects: readonly RoutingChoiceProject[]): Map<string, RoutingChoiceLabel> {
  return new Map(
    projects.map((p) => {
      const others = projects.filter((q) => q.id !== p.id && sameName(p, q))
      const otherHost = others.some((q) => q.host !== p.host)
      const sameHost = others.some((q) => q.host === p.host)
      const parts = [p.name, ...(otherHost ? [p.host] : []), ...(sameHost && p.root ? [p.root] : [])]
      return [p.id, { label: parts.join(' · '), showsRoot: sameHost && !!p.root }]
    }),
  )
}
