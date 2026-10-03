import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import {
  brandChoice,
  MODEL_QUESTION,
  periodMiss,
  questionFor,
  suggestBrands,
} from './matcher/clarify.js';
import { confirmMatches, type ConfirmedMatch } from './matcher/confirm.js';
import { allergiesHit, allergyNote } from './matcher/allergens.js';
import { findMatches, type Item } from './matcher/match.js';
import { unspell } from './matcher/phonetic.js';
import { recordAlerts } from './household-check.js';
import { searchRecalls } from './recalls/provider.js';
import { registerAlertTools } from './tools-alerts.js';
import { registerAllergyTools } from './tools-allergies.js';
import { registerInventoryTools } from './tools-inventory.js';
import { itemFields, reply, type ToolContext } from './tool-common.js';
import { definedFields, type StoredItem } from './store.js';
import {
  firstSentence,
  spokenBrandNotFound,
  spokenCheckSummary,
  spokenItem,
  spokenPeriodMiss,
  spokenSourcesDown,
} from './voice.js';

/** Puts a note right after the first sentence: "Your X may be recalled. <note> What is the lot code?" */
export function withNote(summary: string, note: string | undefined): string {
  if (!note) return summary;
  const cut = summary.search(/[.!?]\s/);
  return cut === -1
    ? `${summary} ${note}`
    : `${summary.slice(0, cut + 1)} ${note}${summary.slice(cut + 1)}`;
}

function matchSummary(m: ConfirmedMatch) {
  return {
    recall_id: m.recall.id,
    confidence: m.level,
    title: m.recall.title,
    hazard: m.recall.hazard,
    remedy: m.recall.remedy,
    remedy_options: m.recall.remedyOptions,
    contact: m.recall.contact,
    published: m.recall.publishedAt,
    url: m.recall.url,
    image_url: m.recall.imageUrl,
    product: m.product,
    details: m.recall.summary.slice(0, 600),
    reasons: m.reasons,
    still_needed: m.missing,
    second_opinion: m.verdict?.reason,
  };
}

async function check(item: Item, ctx: ToolContext, saved?: StoredItem) {
  if (!item.brand) {
    return reply(`Who makes your ${item.name}? I need the brand to check it.`, {
      status: 'need_info',
      still_needed: ['brand'],
    });
  }
  const { recalls: candidates, unavailable } = await searchRecalls(ctx.recalls, item);
  const found = findMatches(item, candidates);
  const matches: ConfirmedMatch[] = ctx.confirmer
    ? await confirmMatches(item, found, ctx.confirmer)
    : found;
  const best = matches[0];
  // A saved item that matches something gets an alert, so get_remedy / get_alerts can pick it up.
  if (saved && best) {
    await recordAlerts(ctx.alertStore, ctx.householdId, [{ item: saved, matches }], {
      supersede: true,
    });
  }

  // We never claim a recall for a brand we cannot pin down: ask which one.
  if (best?.level !== 'strong') {
    const choice = brandChoice(item, matches);
    if (choice) {
      return reply(choice.question, {
        status: 'need_info',
        still_needed: ['brand'],
        options: choice.options,
      });
    }
  }

  if (!best) {
    const suggestion = suggestBrands(item.brand, candidates, item.name);
    if (suggestion) {
      return reply(spokenBrandNotFound(item, suggestion), {
        status: 'need_info',
        still_needed: ['brand'],
        options: suggestion.options,
      });
    }
    const miss = periodMiss(item, candidates);
    if (miss) {
      return reply(spokenPeriodMiss(item, miss), {
        status: 'outside_period',
        recalled_period: miss.period,
        recall_id: miss.recall.id,
        title: miss.recall.title,
      });
    }
  }

  // Never call an item clear when a source we would need was down: say so and keep watching.
  if (!best && unavailable.length) {
    return reply(spokenSourcesDown(item, unavailable, !!saved), {
      status: 'source_unavailable',
      unavailable,
      item: spokenItem(item),
    });
  }

  const status = !best ? 'no_recall' : best.level === 'strong' ? 'recalled' : 'need_info';
  const clarification = best && best.level !== 'strong' ? questionFor(best, matches) : undefined;
  // A food recall for an undeclared allergen: say right away whether it matters for this family.
  const allergies = best ? await ctx.store.getAllergies(ctx.householdId) : [];
  const note = best
    ? allergyNote(`${best.recall.hazard} ${best.recall.title}`, allergies)
    : undefined;
  const hits = best ? allergiesHit(`${best.recall.hazard} ${best.recall.title}`, allergies) : [];
  return reply(withNote(spokenCheckSummary(item, matches), note), {
    status,
    ...(note ? { allergy_note: note, allergy_alert: hits.length > 0 } : {}),
    item: spokenItem(item),
    matches: matches.slice(0, 3).map(matchSummary),
    ...(clarification ? { question: clarification.question, options: clarification.options } : {}),
    ...(best?.level === 'strong' ? { first_step: firstSentence(best.recall.remedy) } : {}),
  });
}

/**
 * A saved item with brand and model (or year) is checked right away, so a recalled product is reported, and
 * raises its alert, in the same turn it is registered. Without those details we keep asking for them.
 */
type Checked = { summary: string; status: string } & Record<string, unknown>;

async function checkOnSave(saved: StoredItem, ctx: ToolContext): Promise<Checked | undefined> {
  if (!saved.brand) return undefined;
  if (saved.model || saved.year) {
    return (await check(saved, ctx, saved)).structuredContent as Checked;
  }
  // Brand and product only: check before asking for anything else. The model number is hard to find, so
  // ask for it only when a recall for this brand and kind of product exists; otherwise just keep watching.
  // A first look records nothing (an ad hoc check); a possible recall is then checked again for real.
  const peek = (await check(saved, ctx)).structuredContent as Checked;
  const stillNeeded = (peek.still_needed ?? []) as string[];
  if (peek.status === 'need_info' && stillNeeded.includes('brand')) {
    // nothing under this brand, but it sounds like one that has recalls: confirm the brand first
    return (await brandHeardRight(saved, ctx)) ?? peek;
  }
  if (peek.status === 'need_info' || peek.status === 'source_unavailable') {
    return (await check(saved, ctx, saved)).structuredContent as Checked;
  }
  const heard = await brandHeardRight(saved, ctx);
  if (heard) return heard;
  return {
    summary: `I found no recalls for ${spokenItem({ name: saved.name, brand: saved.brand })} products like this, so there is nothing more you need to look up. I'll keep watching it.`,
    status: 'no_recall',
    still_needed: [],
  };
}

/**
 * Before asking for the model, make sure we heard the brand right: speech recognition writes unusual brands as
 * common words ("Aitjunz" -> "iTunes"). When the brand matches no recalled brand for this kind of product but
 * sounds like one, ask "Do you mean Aitjunz, A-I-T-J-U-N-Z?" now, instead of after the owner found the model.
 */
async function brandHeardRight(saved: StoredItem, ctx: ToolContext) {
  const { recalls } = await searchRecalls(ctx.recalls, saved);
  const suggestion = suggestBrands(saved.brand ?? '', recalls, saved.name);
  if (!suggestion) return undefined;
  return {
    summary: `Just to be sure I heard the brand right: ${suggestion.question.replace(/^Do you mean/, 'do you mean')}`,
    status: 'need_info',
    still_needed: ['brand', 'model'],
    options: suggestion.options,
  };
}

export function registerTools(server: McpServer, ctx: ToolContext): void {
  server.registerTool(
    'add_item',
    {
      title: 'Add item to household',
      description:
        'Register a product the household owns (car seat, heater, stroller...). ' +
        'Ask the user for brand and model only if missing. Saves the item and says what is still needed; ' +
        'with brand and model (or year) it also checks recalls right away and returns the check status.',
      inputSchema: itemFields,
    },
    async (fields) => {
      // "A I T J U N Z": the owner spelled the brand letter by letter.
      const input = fields.brand ? { ...fields, brand: unspell(fields.brand) } : fields;
      const item = await ctx.store.addItem(ctx.householdId, input);
      const checked = await checkOnSave(item, ctx);
      if (checked) {
        const { summary, ...details } = checked;
        return reply(`Okay, I saved your ${spokenItem(input)}. ${summary}`, {
          item_id: item.id,
          ...details,
        });
      }
      const missing = [!input.brand && 'brand', !input.model && 'model'].filter(
        Boolean,
      ) as string[];
      const next = !input.brand ? 'Who makes it?' : !input.model ? MODEL_QUESTION : undefined;
      const summary = `Okay, I saved your ${spokenItem(input)}.${next ? ` ${next}` : ''}`;
      return reply(summary, { item_id: item.id, still_needed: missing });
    },
  );

  server.registerTool(
    'check_item',
    {
      title: 'Check an item for recalls',
      description:
        'Check one product for official recalls. Pass item_id for a registered item, or ' +
        'name/brand/model/year for any product. Never tell the user an item is recalled unless ' +
        'status is "recalled"; if status is "need_info", ask the question in the summary.',
      inputSchema: {
        item_id: z.string().optional().describe('ID returned by add_item'),
        ...itemFields,
        name: itemFields.name.optional(),
      },
    },
    async ({ item_id, ...fields }) => {
      let item: Item | undefined;
      let saved: StoredItem | undefined;
      if (item_id) {
        saved = await ctx.store.getItem(ctx.householdId, item_id);
        if (!saved)
          return reply("I couldn't find that item in your household.", { status: 'not_found' });
        // Details given now (a year, a month, the model) win over what was saved, for this check only.
        item = { ...saved, ...definedFields(fields) };
      } else if (fields.name) {
        item = { ...fields, name: fields.name };
      } else {
        return reply('What product would you like me to check?', {
          status: 'need_info',
          still_needed: ['name'],
        });
      }
      return check(item, ctx, saved);
    },
  );

  registerInventoryTools(server, ctx, (saved) => checkOnSave(saved, ctx));
  registerAlertTools(server, ctx);
  registerAllergyTools(server, ctx, ctx.allergenFeed);
}
