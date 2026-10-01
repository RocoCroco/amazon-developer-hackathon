import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { z } from 'zod';
import type { AlertStore } from './alerts.js';
import type { Confirmer } from './matcher/confirm.js';
import type { RecallProvider } from './recalls/provider.js';
import type { ItemStore } from './store.js';

export interface ToolContext {
  householdId: string;
  store: ItemStore;
  alertStore: AlertStore;
  recalls: RecallProvider;
  /** Optional second opinion from a language model; downgrade-only (see matcher/confirm.ts). */
  confirmer?: Confirmer;
}

/**
 * Voice-first result: the first text block is ONE short spoken sentence (or two); the second holds
 * the details as JSON, also exposed as structuredContent. URLs never go in the spoken summary.
 */
export function reply(summary: string, details: Record<string, unknown>): CallToolResult {
  const structured = { summary, ...details };
  return {
    content: [
      { type: 'text', text: summary },
      { type: 'text', text: JSON.stringify(structured) },
    ],
    structuredContent: structured,
  };
}

export const itemFields = {
  name: z.string().min(1).describe('What the product is, e.g. "car seat" or "space heater"'),
  brand: z.string().optional().describe('Who makes it, e.g. "Graco"'),
  model: z.string().optional().describe('Model number or name from the sticker, if known'),
  year: z.number().int().min(1950).max(2100).optional().describe('Year made or bought, if known'),
  month: z
    .number()
    .int()
    .min(1)
    .max(12)
    .optional()
    .describe(
      'Month (1-12) made or bought, if known; only needed when a recall covers a short period',
    ),
};
