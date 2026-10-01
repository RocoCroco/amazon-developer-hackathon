import { createHash } from 'node:crypto';
import { BedrockRuntimeClient, ConverseCommand } from '@aws-sdk/client-bedrock-runtime';
import { fingerprint } from '../recalls/cache.js';
import type { Item, Match } from './match.js';

/** A second opinion from a language model on one item-recall pair. */
export interface Verdict {
  match: 'yes' | 'no' | 'unsure';
  /** 0..1, how sure the model is of `match`. */
  confidence: number;
  reason: string;
  /** One short question the owner can answer (where the sticker is, which year...), when unsure. */
  clarifying_question?: string;
}

export interface Confirmer {
  confirm(item: Item, match: Match): Promise<Verdict>;
}

/** Cheapest suitable model (see BLOCKERS B1). Override with CONFIRM_MODEL_ID. */
export const CONFIRM_MODEL_ID = 'us.anthropic.claude-haiku-4-5-20251001-v1:0';

const PROMPT_VERSION = 'v1';

export const SYSTEM_PROMPT = `You double-check whether a household's product is covered by an official recall.
You get the owner's item and the recall's official text. Answer with ONE JSON object and nothing else:
{"match":"yes"|"no"|"unsure","confidence":0..1,"reason":"one short sentence","clarifying_question":"optional"}
Rules:
- "yes" only if the recall text itself identifies this item: brand, product type, and model or dates all fit.
- "no" only if the text clearly excludes it (another model, another size or form, dates outside the recalled period).
- Otherwise "unsure", with ONE short spoken question the owner can answer without tools, for example where the model number sticker is, or roughly which year it was made or bought.
- Never invent facts. Use only the text given. Unknown owner details are unknown, not guesses.`;

const clip = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1)}...` : s);

/** The user message: the item as told, the recall as published, and what the deterministic check found. */
export function buildPrompt(item: Item, match: Match): string {
  const r = match.recall;
  const models = [...new Set(r.products.flatMap((p) => p.models))].slice(0, 20);
  return [
    'RECALL',
    `source: ${r.source}; published: ${r.publishedAt}; category: ${r.category}`,
    `title: ${r.title}`,
    `text: ${clip(r.summary, 1500)}`,
    `hazard: ${clip(r.hazard, 300)}`,
    `listed models: ${models.join(', ') || 'none listed'}`,
    `model years: ${r.years.join(', ') || 'not stated'}`,
    `production window: ${r.manufacturedFrom && r.manufacturedTo ? `${r.manufacturedFrom} to ${r.manufacturedTo}` : 'not stated'}`,
    '',
    'OWNER ITEM (what the owner told us)',
    `product: ${item.name}`,
    `brand: ${item.brand ?? 'unknown'}`,
    `model: ${item.model ?? 'unknown'}`,
    `year made or bought: ${item.year ?? 'unknown'}`,
    '',
    `AUTOMATIC CHECK: ${match.level}; still open: ${match.missing.join(', ') || 'nothing'}`,
  ].join('\n');
}

/** Parses the model's reply. Anything malformed becomes a safe "unsure" (never a yes). */
export function parseVerdict(text: string): Verdict {
  const unsure = (reason: string): Verdict => ({ match: 'unsure', confidence: 0, reason });
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start === -1 || end <= start) return unsure('The model gave no JSON answer.');
  try {
    const raw = JSON.parse(text.slice(start, end + 1)) as Partial<Verdict>;
    if (raw.match !== 'yes' && raw.match !== 'no' && raw.match !== 'unsure') {
      return unsure('The model gave an invalid verdict.');
    }
    const confidence = Number(raw.confidence);
    const verdict: Verdict = {
      match: raw.match,
      confidence: Number.isFinite(confidence) ? Math.min(Math.max(confidence, 0), 1) : 0,
      reason: typeof raw.reason === 'string' ? clip(raw.reason, 300) : '',
    };
    if (typeof raw.clarifying_question === 'string' && raw.clarifying_question.trim()) {
      verdict.clarifying_question = clip(raw.clarifying_question.trim(), 200);
    }
    return verdict;
  } catch {
    return unsure('The model answer was not valid JSON.');
  }
}

/** Claude on Amazon Bedrock (Converse API), temperature 0, JSON answer. */
export class BedrockConfirmer implements Confirmer {
  constructor(
    private readonly modelId = process.env.CONFIRM_MODEL_ID ?? CONFIRM_MODEL_ID,
    private readonly client = new BedrockRuntimeClient({ region: 'us-east-1' }),
  ) {}

  async confirm(item: Item, match: Match): Promise<Verdict> {
    const res = await this.client.send(
      new ConverseCommand({
        modelId: this.modelId,
        system: [{ text: SYSTEM_PROMPT }],
        messages: [{ role: 'user', content: [{ text: buildPrompt(item, match) }] }],
        inferenceConfig: { maxTokens: 300, temperature: 0 },
      }),
    );
    const text = (res.output?.message?.content ?? []).map((b) => b.text ?? '').join('');
    return parseVerdict(text);
  }
}

// ---------------------------------------------------------------------------------------------
// Caching: one Bedrock call per distinct item x recall (x recall revision), not per daily run.
// ---------------------------------------------------------------------------------------------

export interface VerdictCache {
  get(key: string): Promise<Verdict | undefined>;
  set(key: string, verdict: Verdict): Promise<void>;
}

export class InMemoryVerdictCache implements VerdictCache {
  private readonly entries = new Map<string, Verdict>();
  async get(key: string) {
    return this.entries.get(key);
  }
  async set(key: string, verdict: Verdict) {
    this.entries.set(key, verdict);
  }
}

/** Same item facts + same recall content + same automatic result = same question to the model. */
export function cacheKey(item: Item, match: Match): string {
  const facts = [item.name, item.brand ?? '', item.model ?? '', item.year ?? '']
    .map((s) => String(s).trim().toLowerCase())
    .join('|');
  return createHash('sha256')
    .update(
      [
        PROMPT_VERSION,
        facts,
        match.recall.id,
        fingerprint(match.recall),
        match.level,
        match.missing.join(','),
      ].join('#'),
    )
    .digest('hex');
}

export class CachedConfirmer implements Confirmer {
  constructor(
    private readonly inner: Confirmer,
    private readonly cache: VerdictCache = new InMemoryVerdictCache(),
  ) {}

  async confirm(item: Item, match: Match): Promise<Verdict> {
    const key = cacheKey(item, match);
    const hit = await this.cache.get(key);
    if (hit) return hit;
    const verdict = await this.inner.confirm(item, match);
    await this.cache.set(key, verdict);
    return verdict;
  }
}

/** Plays back fixed verdicts, by recall id (tests, offline demo). */
export class ScriptedConfirmer implements Confirmer {
  readonly calls: { item: Item; recallId: string }[] = [];
  constructor(
    private readonly verdicts: Record<string, Verdict>,
    private readonly fallback: Verdict = { match: 'unsure', confidence: 0, reason: 'no script' },
  ) {}

  async confirm(item: Item, match: Match): Promise<Verdict> {
    this.calls.push({ item, recallId: match.recall.id });
    return this.verdicts[match.recall.id] ?? this.fallback;
  }
}

// ---------------------------------------------------------------------------------------------
// Combining the automatic result with the model's opinion.
// ---------------------------------------------------------------------------------------------

/** A match after the model's second opinion. */
export interface ConfirmedMatch extends Match {
  verdict?: Verdict;
  /** Question to ask the owner (the model's, else derived from `missing`). */
  question?: string;
  /** True when the model's doubt turned a strong match into a question. */
  downgraded?: boolean;
}

/** How sure the model must be to drop a match entirely. */
export const DROP_CONFIDENCE = 0.9;

/**
 * The model can only make the answer MORE careful, never less:
 *  - strong + yes          -> stays strong
 *  - strong + unsure/no    -> possible, with the model's question (we never claim a recall we doubt)
 *  - possible + yes        -> stays possible (it may not upgrade without the missing facts)
 *  - possible + unsure     -> possible, with the model's question
 *  - possible + no (sure)  -> dropped
 * Returns null when the match is dropped.
 */
export function applyVerdict(match: Match, verdict: Verdict): ConfirmedMatch | null {
  if (
    verdict.match === 'no' &&
    match.level === 'possible' &&
    verdict.confidence >= DROP_CONFIDENCE
  ) {
    return null;
  }
  const keepStrong = match.level === 'strong' && verdict.match === 'yes';
  return {
    ...match,
    level: keepStrong ? 'strong' : 'possible',
    verdict,
    question: keepStrong ? undefined : verdict.clarifying_question,
    downgraded: match.level === 'strong' && !keepStrong,
  };
}

/**
 * Second opinion on the best few matches. The model is a safety net, not a gate: if the call fails
 * (outage, no access), the automatic result stands unchanged, so an outage can neither invent nor erase
 * a recall warning.
 */
export async function confirmMatches(
  item: Item,
  matches: Match[],
  confirmer: Confirmer,
  limit = 3,
): Promise<ConfirmedMatch[]> {
  const out: ConfirmedMatch[] = [];
  for (const match of matches.slice(0, limit)) {
    let verdict: Verdict;
    try {
      verdict = await confirmer.confirm(item, match);
    } catch {
      out.push({ ...match });
      continue;
    }
    const confirmed = applyVerdict(match, verdict);
    if (confirmed) out.push(confirmed);
  }
  return out;
}
