import type { Recall, Severity } from './types.js';

/** Hazards that can kill or seriously injure quickly. Used only when the source gives no severity. */
const SERIOUS =
  /\b(death|die|fatal|fire|burn|choking|suffocat|asphyxia|strangul|drown|electrocut|shock|carbon monoxide|explo|crash|entrap|laceration|amputat|poison|salmonella|listeria|botulism|e\. coli)/i;

/** Source severity when there is one (FDA class, NHTSA do-not-drive); otherwise a keyword reading of the hazard. */
export function severityOf(recall: Recall): Severity {
  if (recall.severity) return recall.severity;
  return SERIOUS.test(`${recall.hazard} ${recall.title}`) ? 'high' : 'medium';
}

const RANK: Record<Severity, number> = { high: 0, medium: 1, low: 2 };

/** Sort key: lower is more urgent. */
export const severityRank = (s: Severity): number => RANK[s];
