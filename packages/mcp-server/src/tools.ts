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
import { findMatches, type Item } from './matcher/match.js';
import { registerInventoryTools } from './tools-inventory.js';
import { itemFields, reply, type ToolContext } from './tool-common.js';
import { definedFields } from './store.js';
import {
  firstSentence,
  spokenBrandNotFound,
  spokenCheckSummary,
  spokenItem,
  spokenPeriodMiss,
} from './voice.js';

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
    product: m.product,
    details: m.recall.summary.slice(0, 600),
    reasons: m.reasons,
    still_needed: m.missing,
    second_opinion: m.verdict?.reason,
  };
}

async function check(item: Item, ctx: ToolContext) {
  if (!item.brand) {
    return reply(`Who makes your ${item.name}? I need the brand to check it.`, {
      status: 'need_info',
      still_needed: ['brand'],
    });
  }
  const candidates = await ctx.recalls.candidates(item);
  const found = findMatches(item, candidates);
  const matches: ConfirmedMatch[] = ctx.confirmer
    ? await confirmMatches(item, found, ctx.confirmer)
    : found;
  const best = matches[0];

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
    const suggestion = suggestBrands(item.brand, candidates);
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

  const status = !best ? 'no_recall' : best.level === 'strong' ? 'recalled' : 'need_info';
  const clarification = best && best.level !== 'strong' ? questionFor(best, matches) : undefined;
  return reply(spokenCheckSummary(item, matches), {
    status,
    item: spokenItem(item),
    matches: matches.slice(0, 3).map(matchSummary),
    ...(clarification ? { question: clarification.question, options: clarification.options } : {}),
    ...(best?.level === 'strong' ? { first_step: firstSentence(best.recall.remedy) } : {}),
  });
}

export function registerTools(server: McpServer, ctx: ToolContext): void {
  server.registerTool(
    'add_item',
    {
      title: 'Add item to household',
      description:
        'Register a product the household owns (car seat, heater, stroller...). ' +
        'Ask the user for brand and model only if missing. Saves the item and says what is still needed.',
      inputSchema: itemFields,
    },
    async (input) => {
      const item = await ctx.store.addItem(ctx.householdId, input);
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
      if (item_id) {
        const saved = await ctx.store.getItem(ctx.householdId, item_id);
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
      return check(item, ctx);
    },
  );

  registerInventoryTools(server, ctx);
}
