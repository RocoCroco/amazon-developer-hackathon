import { randomUUID } from 'node:crypto';
import type { Allergy } from './matcher/allergens.js';
import type { Item } from './matcher/match.js';

export interface StoredItem extends Item {
  id: string;
  createdAt: string;
}

export type NewItem = Item;

/** Fields an update may change. `undefined` means "leave as is". */
export type ItemPatch = Partial<NewItem>;

/** Household inventory storage. In-memory here; DynamoDB implements the same interface. */
export interface ItemStore {
  addItem(householdId: string, item: NewItem): Promise<StoredItem>;
  listItems(householdId: string): Promise<StoredItem[]>;
  getItem(householdId: string, itemId: string): Promise<StoredItem | undefined>;
  /** Returns the updated item, or undefined if this household has no such item. */
  updateItem(
    householdId: string,
    itemId: string,
    patch: ItemPatch,
  ): Promise<StoredItem | undefined>;
  /** True if an item was removed. */
  removeItem(householdId: string, itemId: string): Promise<boolean>;
  /** Food allergies in the family, checked against undeclared-allergen recalls. */
  getAllergies(householdId: string): Promise<Allergy[]>;
  setAllergies(householdId: string, allergies: Allergy[]): Promise<void>;
}

/** Every household with its items: what the daily watcher checks new recalls against. */
export interface HouseholdSource {
  listAllHouseholds(): Promise<{ householdId: string; items: StoredItem[] }[]>;
}

/** The fields of a patch that are actually set. */
export function definedFields(patch: ItemPatch): ItemPatch {
  return Object.fromEntries(Object.entries(patch).filter(([, v]) => v !== undefined)) as ItemPatch;
}

export class InMemoryItemStore implements ItemStore, HouseholdSource {
  private readonly items = new Map<string, StoredItem[]>();
  private readonly allergies = new Map<string, Allergy[]>();

  async getAllergies(householdId: string): Promise<Allergy[]> {
    return [...(this.allergies.get(householdId) ?? [])];
  }

  async setAllergies(householdId: string, allergies: Allergy[]): Promise<void> {
    this.allergies.set(householdId, [...allergies]);
  }

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

  async updateItem(
    householdId: string,
    itemId: string,
    patch: ItemPatch,
  ): Promise<StoredItem | undefined> {
    const list = this.items.get(householdId) ?? [];
    const index = list.findIndex((i) => i.id === itemId);
    if (index === -1) return undefined;
    const updated: StoredItem = { ...list[index]!, ...definedFields(patch) };
    list[index] = updated;
    return updated;
  }

  async listAllHouseholds(): Promise<{ householdId: string; items: StoredItem[] }[]> {
    return [...this.items.entries()]
      .filter(([, items]) => items.length > 0)
      .map(([householdId, items]) => ({ householdId, items: [...items] }));
  }

  async removeItem(householdId: string, itemId: string): Promise<boolean> {
    const list = this.items.get(householdId) ?? [];
    const next = list.filter((i) => i.id !== itemId);
    this.items.set(householdId, next);
    return next.length < list.length;
  }
}
