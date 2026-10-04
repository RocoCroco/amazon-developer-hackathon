import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { MODEL_QUESTION, spokenList } from './matcher/clarify.js';
import { cleanBrandField } from './matcher/phonetic.js';
import type { Item } from './matcher/match.js';
import type { StoredItem } from './store.js';
import { itemFields, reply, type ToolContext } from './tool-common.js';
import { spokenCount, spokenItem, withArticle } from './voice.js';

/** "Graco car seat": brand and product only, for lists (model codes are tedious to listen to). */
export function spokenName(item: Item): string {
  return [item.brand, item.name].filter(Boolean).join(' ');
}

const MAX_SPOKEN_ITEMS = 4;

/** "You have 3 items: a Graco car seat, a Govee space heater, and a Britax stroller." */
export function spokenInventory(items: StoredItem[]): string {
  if (items.length === 0) {
    return "You haven't registered anything yet. Tell me about something you own and I'll watch it for recalls.";
  }
  const named = items.slice(0, MAX_SPOKEN_ITEMS).map((i) => withArticle(spokenName(i)));
  const more = items.length - named.length;
  if (more > 0) named.push(`${spokenCount(more)} more`);
  const count = items.length === 1 ? 'one item' : `${spokenCount(items.length)} items`;
  return `You have ${count}: ${spokenList(named, 'and')}.`;
}

const view = (item: StoredItem) => ({
  item_id: item.id,
  name: item.name,
  brand: item.brand,
  model: item.model,
  year: item.year,
  month: item.month,
});

/** What the assistant should still ask about a registered item. */
function stillNeeded(item: Item): { missing: string[]; next?: string } {
  const missing = [!item.brand && 'brand', !item.model && 'model'].filter(Boolean) as string[];
  const next = !item.brand ? 'Who makes it?' : !item.model ? MODEL_QUESTION : undefined;
  return { missing, next };
}

export function registerInventoryTools(
  server: McpServer,
  ctx: ToolContext,
  checkOnSave: (
    saved: StoredItem,
  ) => Promise<({ summary: string; status: string } & Record<string, unknown>) | undefined>,
): void {
  server.registerTool(
    'list_items',
    {
      title: 'List household items',
      description: 'List everything registered for this household, newest last.',
      annotations: { readOnlyHint: true },
    },
    async () => {
      const items = await ctx.store.listItems(ctx.householdId);
      return reply(spokenInventory(items), { count: items.length, items: items.map(view) });
    },
  );

  server.registerTool(
    'update_item',
    {
      title: 'Update a registered item',
      description:
        'Change details of a registered item, for example add the model number or the year once the ' +
        'user finds out, or the brand once the user confirms a "do you mean ...?" suggestion (always call it ' +
        'then: the item is only checked against recalls under the corrected brand). Only the fields you pass ' +
        'are changed.',
      inputSchema: {
        item_id: z.string().describe('ID from add_item or list_items'),
        ...itemFields,
        name: itemFields.name.optional(),
      },
      annotations: { idempotentHint: true },
    },
    async ({ item_id, ...fields }) => {
      // A spelled brand is joined; a description given as the brand ("white") is not taken as one.
      const patch = cleanBrandField(fields);
      const item = await ctx.store.updateItem(ctx.householdId, item_id, patch);
      if (!item) {
        return reply("I couldn't find that item in your household.", { status: 'not_found' });
      }
      const checked = await checkOnSave(item);
      if (checked) {
        const { summary, ...details } = checked;
        return reply(`Okay, I updated your ${spokenItem(item)}. ${summary}`, {
          ...view(item),
          ...details,
        });
      }
      const { missing, next } = stillNeeded(item);
      return reply(`Okay, I updated your ${spokenItem(item)}.${next ? ` ${next}` : ''}`, {
        status: 'updated',
        still_needed: missing,
        ...view(item),
      });
    },
  );

  server.registerTool(
    'remove_item',
    {
      title: 'Remove an item from the household',
      description:
        'Remove a registered item. This cannot be undone, so it takes two steps: call it first WITHOUT ' +
        'confirm; it answers with a question to ask the user. Only after the user says yes, call it again ' +
        'with confirm=true.',
      inputSchema: {
        item_id: z.string().describe('ID from add_item or list_items'),
        confirm: z
          .boolean()
          .optional()
          .describe('true only after the user explicitly agreed to remove it'),
      },
      annotations: { destructiveHint: true },
    },
    async ({ item_id, confirm }) => {
      const item = await ctx.store.getItem(ctx.householdId, item_id);
      if (!item) {
        return reply("I couldn't find that item in your household.", { status: 'not_found' });
      }
      const what = spokenName(item);
      if (confirm !== true) {
        return reply(`Do you want me to remove your ${what}? Say yes to confirm.`, {
          status: 'needs_confirmation',
          ...view(item),
        });
      }
      await ctx.store.removeItem(ctx.householdId, item_id);
      return reply(`Okay, I removed your ${what}.`, { status: 'removed', item_id });
    },
  );
}
