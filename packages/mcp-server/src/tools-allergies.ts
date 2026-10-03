import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import {
  allergensInRecall,
  canonicalAllergen,
  spokenAllergen,
  type Allergy,
} from './matcher/allergens.js';
import { spokenList } from './matcher/clarify.js';
import type { Recall } from './recalls/types.js';
import { reply, type ToolContext } from './tool-common.js';

/** Recent food recalls for undeclared allergens (openFDA), newest first. Injected so tests run offline. */
export type AllergenFeed = (days: number) => Promise<Recall[]>;

const MAX_DAYS = 90;
const MAX_SPOKEN = 3;

/** "Leo is allergic to peanuts" / "someone in the family is allergic to milk". */
function spokenAllergy(a: Allergy): string {
  return `${a.person ?? 'someone in the family'} is allergic to ${spokenAllergen(a.allergen)}`;
}

/** "Mercer's brand 6 ICE CREAM SANDWICHES TO GO; packaged in ..." -> "Mercer's brand 6 ice cream sandwiches to go". */
function shortProduct(recall: Recall): string {
  const name = recall.products[0]?.name ?? recall.title;
  const first = (name.split(/[,;(]/)[0] ?? name).trim();
  // Stop at packaging details ("NET WT 15oz", "packaged in", "12 oz") and keep it short to listen to.
  const words: string[] = [];
  for (const w of first.split(/\s+/)) {
    if (/^(net|packaged|in|upc|lot|wt\.?)$/i.test(w) || /^\d+(\.\d+)?(oz|g|lb|ml)$/i.test(w)) break;
    words.push(w);
    if (words.length === 8) break;
  }
  // Never end on a dangling "with" / "and" after the cut.
  while (words.length > 1 && /^(with|and|or|of|in|for|the|a)$/i.test(words.at(-1)!)) words.pop();
  // Labels shout in capitals; a voice and a reader both prefer lower case. Mixed-case names stay.
  return words.map((w) => (/^[A-Z]{2,}$/.test(w) ? w.toLowerCase() : w)).join(' ');
}

export function registerAllergyTools(
  server: McpServer,
  ctx: ToolContext,
  allergenFeed: AllergenFeed | undefined,
): void {
  server.registerTool(
    'update_allergies',
    {
      title: 'Record food allergies in the family',
      description:
        'Save who in the family is allergic to what ("my son Leo is allergic to peanuts"), or remove one. ' +
        'Food recalls for an undeclared allergen are then flagged for the person concerned. Call with no ' +
        'arguments to hear the current list.',
      inputSchema: {
        add: z
          .array(
            z.object({
              allergen: z.string().describe('e.g. "peanuts", "milk", "tree nuts", "gluten"'),
              person: z.string().optional().describe('who is allergic, e.g. "Leo", if said'),
            }),
          )
          .optional(),
        remove: z.array(z.string()).optional().describe('allergens to forget, e.g. ["milk"]'),
      },
      annotations: { idempotentHint: true },
    },
    async ({ add = [], remove = [] }) => {
      const gone = new Set(remove.map(canonicalAllergen));
      const known = (await ctx.store.getAllergies(ctx.householdId)).filter(
        (a) => !gone.has(a.allergen),
      );
      for (const { allergen, person } of add) {
        const entry: Allergy = {
          allergen: canonicalAllergen(allergen),
          ...(person ? { person } : {}),
        };
        const same = known.findIndex(
          (a) => a.allergen === entry.allergen && (a.person ?? '') === (entry.person ?? ''),
        );
        if (same === -1) known.push(entry);
      }
      if (add.length || remove.length) await ctx.store.setAllergies(ctx.householdId, known);

      const view = known.map((a) => ({ allergen: a.allergen, person: a.person }));
      if (known.length === 0) {
        return reply("I don't have any food allergies saved for your family.", { allergies: view });
      }
      const list = spokenList(known.map(spokenAllergy), 'and');
      const summary =
        add.length > 0
          ? `Okay. ${list.charAt(0).toUpperCase()}${list.slice(1)}. I'll warn you about recalls with undeclared ${spokenList(
              [...new Set(known.map((a) => spokenAllergen(a.allergen)))],
              'or',
            )}.`
          : `${list.charAt(0).toUpperCase()}${list.slice(1)}.`;
      return reply(summary, { allergies: view });
    },
  );

  server.registerTool(
    'recent_allergen_recalls',
    {
      title: 'Recent recalls for an undeclared allergen',
      description:
        'Food recalls of the last weeks for an undeclared allergen (openFDA), for questions like "any recent ' +
        'peanut recalls?". Without an allergen it uses the family\'s saved allergies.',
      inputSchema: {
        allergen: z
          .string()
          .optional()
          .describe('e.g. "peanuts"; omit to use the family allergies'),
        days: z.number().int().min(1).max(MAX_DAYS).optional().describe('how far back, default 30'),
      },
      annotations: { readOnlyHint: true },
    },
    async ({ allergen, days = 30 }) => {
      const wanted = allergen
        ? [canonicalAllergen(allergen)]
        : [...new Set((await ctx.store.getAllergies(ctx.householdId)).map((a) => a.allergen))];
      if (wanted.length === 0) {
        return reply('Which allergen should I look for? For example peanuts or milk.', {
          status: 'need_info',
          still_needed: ['allergen'],
        });
      }
      if (!allergenFeed) {
        return reply("I can't look up food recalls right now.", { status: 'source_unavailable' });
      }
      let recent: Recall[];
      try {
        recent = await allergenFeed(days);
      } catch {
        return reply(
          "I couldn't reach the FDA recall database just now. Please ask me again later.",
          {
            status: 'source_unavailable',
            unavailable: ['openFDA'],
          },
        );
      }
      const hits = recent.filter((r) =>
        allergensInRecall(`${r.hazard} ${r.title}`).some((a) => wanted.includes(a)),
      );
      const what = spokenList(wanted.map(spokenAllergen), 'or');
      const recalls = hits.map((r) => ({
        recall_id: r.id,
        product: shortProduct(r),
        firm: r.brands[0],
        reason: r.hazard,
        published: r.publishedAt,
        severity: r.severity,
      }));
      if (hits.length === 0) {
        return reply(
          `Good news: no food recalls for undeclared ${what} in the last ${days} days.`,
          {
            status: 'none',
            allergens: wanted,
            recalls,
          },
        );
      }
      const named = hits.slice(0, MAX_SPOKEN).map(shortProduct);
      const more = hits.length - named.length;
      const count = hits.length === 1 ? 'one food recall' : `${hits.length} food recalls`;
      const list = more > 0 ? `${named.join(', ')}, and ${more} more` : spokenList(named, 'and');
      return reply(
        `In the last ${days} days there ${hits.length === 1 ? 'was' : 'were'} ${count} for undeclared ${what}: ${list}. If you have one of these, tell me and I'll check the lot code with you.`,
        { status: 'found', allergens: wanted, recalls },
      );
    },
  );
}
