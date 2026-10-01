import type { Item } from '../src/matcher/match.js';

/**
 * Hand-labeled items checked against the real-recall corpus (test/corpus.ts).
 *  strong:   recall ids that MUST come back as a confident match ("your X is recalled")
 *  possible: recall ids that may come back as an open match (we must ask a question first)
 * Every other recall in the corpus must NOT match. Labels were adjudicated against the recall text
 * (see docs/matcher-results.md for the corrections that came out of that review).
 */
export interface LabeledItem {
  id: string;
  /** How a person might say it (documentation only). */
  says: string;
  item: Item;
  strong?: string[];
  possible?: string[];
  /** When false, `possible` ids are merely tolerated (not required to be found). Default true. */
  requireOpen?: boolean;
  /** Why this item is in the set. */
  kind: 'positive' | 'open' | 'hard-negative';
}

export const ITEMS: LabeledItem[] = [
  // ---- consumer products: model listed -> strong ------------------------------------------------
  {
    id: 'c01',
    kind: 'positive',
    says: 'My Inmo Air 3 smart glasses',
    item: { name: 'smart glasses', brand: 'Inmo', model: 'Air 3' },
    strong: ['cpsc:10995'],
  },
  {
    id: 'c02',
    kind: 'positive',
    says: 'Love To Dream portable sleep machine LTD-SM23',
    item: { name: 'portable sleep machine', brand: 'Love To Dream', model: 'LTD-SM23' },
    strong: ['cpsc:11001'],
  },
  {
    id: 'c03',
    kind: 'positive',
    says: 'NEWDERY power bank ZHX-PB22',
    item: { name: 'power bank', brand: 'NEWDERY', model: 'ZHX-PB22' },
    strong: ['cpsc:11000'],
  },
  {
    id: 'c04',
    kind: 'positive',
    says: 'Blue Cactus recliner battery pack RWX-RBP02',
    item: { name: 'reclining chair battery pack', brand: 'Blue Cactus', model: 'RWX-RBP02' },
    strong: ['cpsc:10997'],
  },
  {
    id: 'c05',
    kind: 'positive',
    says: 'Friedrich window air conditioner KCVQ08B10A',
    item: { name: 'window air conditioner', brand: 'Friedrich', model: 'KCVQ08B10A' },
    strong: ['cpsc:10985'],
  },
  {
    id: 'c06',
    kind: 'positive',
    says: 'Hayward pool heater HDFS400',
    item: { name: 'pool heater', brand: 'Hayward', model: 'HDFS400' },
    strong: ['cpsc:10987'],
  },
  {
    id: 'c07',
    kind: 'positive',
    says: 'JKMAX heating pad JKMAX-6284B',
    item: { name: 'heating pad', brand: 'JKMAX', model: 'JKMAX-6284B' },
    strong: ['cpsc:10975'],
  },
  {
    id: 'c08',
    kind: 'positive',
    says: 'Lanchez pressure washer KLC-BULL135C',
    item: { name: 'pressure washer', brand: 'Lanchez', model: 'KLC-BULL135C' },
    strong: ['cpsc:10983'],
  },
  {
    id: 'c09',
    kind: 'positive',
    says: 'Triumph TF450-X kids motorcycle',
    item: { name: 'motorcycle', brand: 'Triumph', model: 'TF450-X' },
    strong: ['cpsc:10966'],
  },
  // CCB-4125 is listed in the original recall AND in its later expansion: both are correct.
  {
    id: 'c10',
    kind: 'positive',
    says: 'Cuisinart grill brush CCB-4125',
    item: { name: 'grill brush', brand: 'Cuisinart', model: 'CCB-4125' },
    strong: ['cpsc:10953', 'cpsc:10850'],
  },
  {
    id: 'c11',
    kind: 'positive',
    says: 'Skip Hop Elmo teether 9R263210',
    item: { name: 'teether', brand: 'Skip Hop', model: '9R263210' },
    strong: ['cpsc:10943'],
  },
  {
    id: 'c12',
    kind: 'positive',
    says: 'Husqvarna off-road motorcycle 450F',
    item: { name: 'off-road motorcycle', brand: 'Husqvarna', model: '450F' },
    strong: ['cpsc:10931'],
  },
  {
    id: 'c13',
    kind: 'positive',
    says: 'Govee space heater H7131',
    item: { name: 'space heater', brand: 'Govee', model: 'H7131' },
    strong: ['cpsc:10086'],
  },
  {
    id: 'c14',
    kind: 'positive',
    says: 'GoveeLife heater, model h-7130',
    item: { name: 'heater', brand: 'GoveeLife', model: 'h-7130' },
    strong: ['cpsc:10086'],
  },

  // ---- consumer products: detail missing -> open (a question, never a claim) ---------------------
  {
    id: 'o01',
    kind: 'open',
    says: 'A Friedrich window air conditioner',
    item: { name: 'window air conditioner', brand: 'Friedrich' },
    possible: ['cpsc:10985'],
  },
  {
    id: 'o02',
    kind: 'open',
    says: 'A Govee space heater',
    item: { name: 'space heater', brand: 'Govee' },
    possible: ['cpsc:10086'],
  },
  {
    id: 'o03',
    kind: 'open',
    says: 'A Hayward pool heater',
    item: { name: 'pool heater', brand: 'Hayward' },
    possible: ['cpsc:10987'],
  },
  {
    id: 'o04',
    kind: 'open',
    says: 'A Shop LC space heater',
    item: { name: 'space heater', brand: 'Shop LC' },
    possible: ['cpsc:9234'],
  },

  // ---- consumer products: hard negatives ---------------------------------------------------------
  {
    id: 'n01',
    kind: 'hard-negative',
    says: 'Friedrich AC, other model',
    item: { name: 'window air conditioner', brand: 'Friedrich', model: 'KCVQ99Z99' },
  },
  {
    id: 'n02',
    kind: 'hard-negative',
    says: 'Friedrich dehumidifier (other product)',
    item: { name: 'dehumidifier', brand: 'Friedrich' },
  },
  {
    id: 'n03',
    kind: 'hard-negative',
    says: 'Cuisinart toaster (other product)',
    item: { name: 'toaster', brand: 'Cuisinart' },
  },
  {
    id: 'n04',
    kind: 'hard-negative',
    says: 'Cuisinart grill brush, other model',
    item: { name: 'grill brush', brand: 'Cuisinart', model: 'CCB-9999' },
  },
  {
    id: 'n05',
    kind: 'hard-negative',
    says: 'Dyson space heater (other brand)',
    item: { name: 'space heater', brand: 'Dyson' },
  },
  {
    id: 'n06',
    kind: 'hard-negative',
    says: 'Brand that is only a prefix of another',
    item: { name: 'space heater', brand: 'Gove' },
  },
  {
    id: 'n07',
    kind: 'hard-negative',
    says: 'Skip Hop stroller (other product)',
    item: { name: 'stroller', brand: 'Skip Hop' },
  },
  {
    id: 'n08',
    kind: 'hard-negative',
    says: 'Lanchez pressure washer, other model',
    item: { name: 'pressure washer', brand: 'Lanchez', model: 'XYZ-123' },
  },
  {
    id: 'n09',
    kind: 'hard-negative',
    says: 'Triumph road bike, model not in recall',
    item: { name: 'motorcycle', brand: 'Triumph', model: 'Speed Twin 900' },
  },
  {
    id: 'n10',
    kind: 'hard-negative',
    says: 'Govee desk lamp (other product)',
    item: { name: 'desk lamp', brand: 'Govee' },
  },
  {
    id: 'n11',
    kind: 'hard-negative',
    says: 'Govee heater, model not in recall',
    item: { name: 'space heater', brand: 'Govee', model: 'H9999' },
  },
  {
    id: 'n12',
    kind: 'hard-negative',
    says: 'Blue Cactus battery pack, other model',
    item: { name: 'reclining chair battery pack', brand: 'Blue Cactus', model: 'RWX-RBP99' },
  },
  { id: 'n13', kind: 'hard-negative', says: 'No brand given', item: { name: 'space heater' } },

  // ---- child car seats (NHTSA) ---------------------------------------------------------------
  {
    id: 's01',
    kind: 'positive',
    says: 'Graco SnugRide, bought 2012',
    item: { name: 'car seat', brand: 'Graco', model: 'SnugRide', year: 2012 },
    strong: ['nhtsa:14C004000'],
  },
  {
    id: 's02',
    kind: 'positive',
    says: 'Graco Snug Ride 35, 2011 (listed only in the prose)',
    item: { name: 'infant car seat', brand: 'Graco', model: 'Snug Ride 35', year: 2011 },
    strong: ['nhtsa:14C004000'],
  },
  // The 2026 SnugRide Turn & Slide recall can also apply when the year is unknown.
  {
    id: 's03',
    kind: 'open',
    says: 'Graco SnugRide, year unknown',
    item: { name: 'car seat', brand: 'Graco', model: 'SnugRide' },
    possible: ['nhtsa:14C004000', 'nhtsa:26C003000'],
  },
  {
    id: 's04',
    kind: 'hard-negative',
    says: 'Graco SnugRide made in 2016 (after the window)',
    item: { name: 'car seat', brand: 'Graco', model: 'SnugRide', year: 2016 },
  },
  {
    id: 's05',
    kind: 'hard-negative',
    says: 'Graco Extend2Fit (not recalled)',
    item: { name: 'car seat', brand: 'Graco', model: 'Extend2Fit', year: 2012 },
  },
  {
    id: 's06',
    kind: 'positive',
    says: 'Britax Advocate 70 G3, 2012',
    item: { name: 'car seat', brand: 'Britax', model: 'Advocate 70 G3', year: 2012 },
    strong: ['nhtsa:12C004000'],
  },
  {
    id: 's07',
    kind: 'positive',
    says: 'Britax Boulevard 70 G3, 2012',
    item: { name: 'car seat', brand: 'Britax', model: 'Boulevard 70 G3', year: 2012 },
    strong: ['nhtsa:12C004000'],
  },
  {
    id: 's08',
    kind: 'positive',
    says: 'Britax Chaperone E9L692L, 2011 (sticker code)',
    item: { name: 'infant car seat', brand: 'Britax', model: 'E9L692L', year: 2011 },
    strong: ['nhtsa:12C001000'],
  },
  {
    id: 's09',
    kind: 'open',
    says: 'Britax Chaperone, no sticker code, 2010',
    item: { name: 'infant car seat', brand: 'Britax', model: 'Chaperone', year: 2010 },
    possible: ['nhtsa:10C006000', 'nhtsa:12C001000'],
  },
  {
    id: 's10',
    kind: 'positive',
    says: 'Maxi-Cosi 22-371, 2008',
    item: { name: 'car seat', brand: 'Maxi-Cosi', model: '22-371', year: 2008 },
    strong: ['nhtsa:10C001000'],
  },
  {
    id: 's11',
    kind: 'positive',
    says: 'Safety 1st Alpha Omega Elite, 2010',
    item: { name: 'car seat', brand: 'Safety 1st', model: 'Alpha Omega Elite', year: 2010 },
    strong: ['nhtsa:11C002000'],
  },
  {
    id: 's12',
    kind: 'positive',
    says: 'Cybex Solution X-Fix, 2010',
    item: { name: 'booster seat', brand: 'Cybex', model: 'Solution X-Fix', year: 2010 },
    strong: ['nhtsa:10C003000'],
  },
  {
    id: 's13',
    kind: 'hard-negative',
    says: 'Cybex Solution X-Fix made 2012',
    item: { name: 'booster seat', brand: 'Cybex', model: 'Solution X-Fix', year: 2012 },
  },
  {
    id: 's14',
    kind: 'positive',
    says: 'Recaro ProSport, 2011',
    item: { name: 'car seat', brand: 'Recaro', model: 'ProSport', year: 2011 },
    strong: ['nhtsa:13C001000'],
  },
  {
    id: 's15',
    kind: 'positive',
    says: 'Recaro ProRide, 2012',
    item: { name: 'car seat', brand: 'Recaro', model: 'ProRide', year: 2012 },
    strong: ['nhtsa:14C005000'],
  },
  {
    id: 's16',
    kind: 'positive',
    says: 'Combi Zeus 360, 2011',
    item: { name: 'car seat', brand: 'Combi', model: 'Zeus 360', year: 2011 },
    strong: ['nhtsa:13C002000'],
  },
  // Name-level match: the 2012 window confirms 12C003000; the 2025 "certain seats" recall has no window.
  {
    id: 's17',
    kind: 'positive',
    says: 'Evenflo Big Kid booster, 2012',
    item: { name: 'booster seat', brand: 'Evenflo', model: 'Big Kid', year: 2012 },
    strong: ['nhtsa:12C003000'],
    possible: ['nhtsa:25C003000'],
  },
  {
    id: 's18',
    kind: 'open',
    says: 'Evenflo Big Kid made 2015 (only the 2025 "certain seats" recall can apply)',
    item: { name: 'booster seat', brand: 'Evenflo', model: 'Big Kid', year: 2015 },
    possible: ['nhtsa:25C003000'],
  },
  {
    id: 's19',
    kind: 'positive',
    says: 'Evenflo Maestro with model number 31012345, 2010 (prefix rule)',
    item: { name: 'car seat', brand: 'Evenflo', model: '31012345', year: 2010 },
    strong: ['nhtsa:10C005000'],
  },
  {
    id: 's20',
    kind: 'positive',
    says: 'Orbit G2 base ORB822000, 2013',
    item: { name: 'car seat base', brand: 'Orbit', model: 'ORB822000', year: 2013 },
    strong: ['nhtsa:13C003000'],
  },
  {
    id: 's21',
    kind: 'hard-negative',
    says: 'Graco stroller (other product)',
    item: { name: 'stroller', brand: 'Graco', year: 2012 },
  },
  {
    id: 's22',
    kind: 'hard-negative',
    says: 'Britax Boulevard 70 G3 made 2018',
    item: { name: 'car seat', brand: 'Britax', model: 'Boulevard 70 G3', year: 2018 },
  },

  // ---- tires and equipment (NHTSA): recalls cover production windows / sizes ----------------------
  {
    id: 't01',
    kind: 'open',
    says: 'Bridgestone Blizzak 6 (the recall is for one tire size: ask)',
    item: { name: 'tire', brand: 'Bridgestone', model: 'Blizzak 6' },
    possible: ['nhtsa:25T003000'],
  },
  {
    id: 't02',
    kind: 'hard-negative',
    says: 'Bridgestone Blizzak 7 (other model)',
    item: { name: 'tire', brand: 'Bridgestone', model: 'Blizzak 7' },
  },
  {
    id: 't03',
    kind: 'positive',
    says: 'Goodyear Metro Miler G652, made 2024',
    item: { name: 'tire', brand: 'Goodyear', model: 'Metro Miler G652', year: 2024 },
    strong: ['nhtsa:25T016000'],
  },
  {
    id: 't04',
    kind: 'hard-negative',
    says: 'Goodyear Assurance (other model)',
    item: { name: 'tire', brand: 'Goodyear', model: 'Assurance' },
  },
  {
    id: 't05',
    kind: 'positive',
    says: 'Firestone Destination LE3, made 2025',
    item: { name: 'tire', brand: 'Firestone', model: 'Destination LE3', year: 2025 },
    strong: ['nhtsa:25T021000'],
  },
  {
    id: 't06',
    kind: 'positive',
    says: 'Cooper Discoverer Stronghold AT, made 2025',
    item: { name: 'tire', brand: 'Cooper', model: 'Discoverer Stronghold AT', year: 2025 },
    strong: ['nhtsa:25T006000'],
  },
  {
    id: 't07',
    kind: 'hard-negative',
    says: 'Continental ExtremeContact (other model)',
    item: { name: 'tire', brand: 'Continental', model: 'ExtremeContact' },
  },
  {
    id: 't08',
    kind: 'hard-negative',
    says: 'Bridgestone car seat (other product)',
    item: { name: 'car seat', brand: 'Bridgestone' },
  },
  {
    id: 't09',
    kind: 'hard-negative',
    says: 'Goodyear Metro Miler G652 made 2019 (before the recalled window)',
    item: { name: 'tire', brand: 'Goodyear', model: 'Metro Miler G652', year: 2019 },
  },
  {
    id: 't10',
    kind: 'open',
    says: 'Goodyear Metro Miler G652, year unknown',
    item: { name: 'tire', brand: 'Goodyear', model: 'Metro Miler G652' },
    possible: ['nhtsa:25T016000'],
  },

  // ---- food and drugs (openFDA): never strong, always ask for the lot code ----------------------
  {
    id: 'f01',
    kind: 'open',
    says: 'Everything Sprouts crunchy protein sprout mix',
    item: { name: 'crunchy protein sprout mix', brand: 'Everything Sprouts' },
    possible: ['fda:H-1339-2026'],
  },
  {
    id: 'f02',
    kind: 'hard-negative',
    says: 'Everything Sprouts ketchup (other product)',
    item: { name: 'ketchup', brand: 'Everything Sprouts' },
  },
  {
    id: 'f03',
    kind: 'hard-negative',
    says: 'Taylor Fresh Foods granola (other product)',
    item: { name: 'granola', brand: 'Taylor Fresh Foods' },
  },
  {
    id: 'f04',
    kind: 'hard-negative',
    says: 'A food brand that is not in the corpus',
    item: { name: 'salsa', brand: 'Zorblax Foods' },
  },
  {
    id: 'f05',
    kind: 'hard-negative',
    says: 'Safecor Health fluphenazine tablets (the recalls are for an elixir)',
    item: { name: 'fluphenazine tablets', brand: 'Safecor Health' },
  },
  {
    id: 'f06',
    kind: 'open',
    says: 'Safecor Health fluphenazine elixir',
    item: { name: 'fluphenazine elixir', brand: 'Safecor Health' },
    possible: [
      'fda:D-0841-2026',
      'fda:D-0842-2026',
      'fda:D-0843-2026',
      'fda:D-0844-2026',
      'fda:D-0845-2026',
      'fda:D-0846-2026',
    ],
  },
];
