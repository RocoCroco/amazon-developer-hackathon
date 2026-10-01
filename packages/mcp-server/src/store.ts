import { randomUUID } from 'node:crypto';
import type { Item } from './matcher/match.js';

export interface StoredItem extends Item {
  id: string;
  createdAt: string;
}

export type NewItem = Item;

/** Household inventory storage. In-memory here; DynamoDB implements the same interface (T1.5). */
export interface ItemStore {
  addItem(householdId: string, item: NewItem): Promise<StoredItem>;
  listItems(householdId: string): Promise<StoredItem[]>;
  getItem(householdId: string, itemId: string): Promise<StoredItem | undefined>;
}

export class InMemoryItemStore implements ItemStore {
  private readonly items = new Map<string, StoredItem[]>();

  async addItem(householdId: string, item: NewItem): Promise<StoredItem> {
    const stored: StoredItem = { ...item, id: randomUUID(), createdAt: new Date().toISOString() };
    this.items.set(householdId, [...(this.items.get(householdId) ?? []), stored]);
    return stored;
  }

  async listItems(householdId: string): Promise<StoredItem[]> {
    return [...(this.items.get(householdId) ?? [])];
  }

  async getItem(householdId: string, itemId: string): Promise<StoredItem | undefined> {
    return (this.items.get(householdId) ?? []).find((i) => i.id === itemId);
  }
}
