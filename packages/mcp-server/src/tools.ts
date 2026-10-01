import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { z } from 'zod';
import { confirmMatches, type ConfirmedMatch, type Confirmer } from './matcher/confirm.js';
import { findMatches, type Item } from './matcher/match.js';
import type { RecallProvider } from './recalls/provider.js';
import type { ItemStore } from './store.js';
import { firstSentence, spokenCheckSummary, spokenItem } from './voice.js';

export interface ToolContext {
  householdId: string;
  store: ItemStore;
  recalls: RecallProvider;
  /** Optional second opinion from a language model; downgrade-only (see matcher/confirm.ts). */
  confirmer?: Confirmer;
}

/**
 * Voice-first result: the first text block is ONE short spoken sentence (or two); the second holds
 * the details as JSON, also exposed as structuredContent. URLs never go in the spoken summary.
 */
function reply(summary: string, details: Record<string, unknown>): CallToolResult {
  const structured = { summary, ...details };
  return {
    content: [
      { type: 'text', text: summary },
      { type: 'text', text: JSON.stringify(structured) },
    ],
    structuredContent: structured,
  };
}

const itemFields = {
  name: z.string().min(1).describe('What the product is, e.g. "car seat" or "space heater"'),
  brand: z.string().optional().describe('Who makes it, e.g. "Graco"'),
  model: z.string().optional().describe('Model number or name from the sticker, if known'),
  year: z.number().int().min(1950).max(2100).optional().describe('Year made or bought, if known'),
};

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
  const status = !best ? 'no_recall' : best.level === 'strong' ? 'recalled' : 'need_info';
  return reply(spokenCheckSummary(item, matches), {
    status,
    item: spokenItem(item),
    matches: matches.slice(0, 3).map(matchSummary),
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
      const next = !input.brand
        ? 'Who makes it?'
        : !input.model
          ? 'What is the model number? It is usually on a sticker on the bottom or back.'
          : undefined;
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
        item = await ctx.store.getItem(ctx.householdId, item_id);
        if (!item)
          return reply("I couldn't find that item in your household.", { status: 'not_found' });
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
}
