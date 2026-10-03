import type { Item } from '../src/matcher/match.js';
import type { Recall } from '../src/recalls/types.js';

/**
 * A harder, hand-checked evaluation set (T9.13), written to find failures, not to confirm the matcher.
 *
 * Labels say what a careful person would want, decided by reading each recall BEFORE running the matcher,
 * and they are never edited to agree with it:
 *   truth       the recalls that really cover the owner's product (empty = not recalled)
 *   canConfirm  the description alone is enough to say "it is recalled" (brand, exact model, year...).
 *               When false, the right answer is a question (which model? which lot? did you mean ...?).
 *
 * How people really describe things: brands misheard by speech recognition, model codes with spaces or a
 * missing dash, a partial model, everyday words ("stove" for "range"), no brand at all ("my 2020 Camry"),
 * and hard negatives (same brand, other product; sibling model; brand that is also an RV name).
 */
export interface ChallengeItem {
  id: string;
  says: string;
  item: Item;
  truth: string[] | ((corpus: Recall[]) => string[]);
  canConfirm: boolean;
  kind:
    | 'speech-brand'
    | 'model-format'
    | 'partial-model'
    | 'vague'
    | 'everyday-words'
    | 'missing-brand'
    | 'food-drug'
    | 'hard-negative'
    | 'baseline';
}

/** Every vehicle recall in the corpus for this make, model and model year (structured NHTSA fields). */
const vehicle =
  (make: string, model: string, year: number) =>
  (corpus: Recall[]): string[] =>
    corpus
      .filter(
        (r) =>
          r.category === 'vehicle' &&
          r.brands.some((b) => b.toLowerCase() === make.toLowerCase()) &&
          r.products.some((p) => p.models.includes(model) && (p.years ?? r.years).includes(year)),
      )
      .map((r) => r.id);

export const CHALLENGE: ChallengeItem[] = [
  // ---- baselines (said clearly) --------------------------------------------------------------------
  {
    id: 'h01',
    kind: 'baseline',
    says: 'Govee space heater, model H7131',
    item: { name: 'space heater', brand: 'Govee', model: 'H7131' },
    truth: ['cpsc:10086'],
    canConfirm: true,
  },
  {
    id: 'h02',
    kind: 'baseline',
    says: 'our 2019 Honda Civic',
    item: { name: 'car', brand: 'Honda', model: 'Civic', year: 2019 },
    truth: vehicle('Honda', 'CIVIC', 2019),
    canConfirm: true,
  },

  // ---- brand heard wrong by speech recognition ------------------------------------------------------------
  {
    id: 'h03',
    kind: 'speech-brand',
    says: '"Frigidair" gas range FCFG3083AS',
    item: { name: 'gas range', brand: 'Frigidair', model: 'FCFG3083AS' },
    truth: ['cpsc:10666'],
    canConfirm: false, // the brand must be confirmed first
  },
  {
    id: 'h04',
    kind: 'speech-brand',
    says: '"Go Vee" heater H7131',
    item: { name: 'heater', brand: 'Go Vee', model: 'H7131' },
    truth: ['cpsc:10086'],
    canConfirm: true, // obviously Govee; asking first is also acceptable
  },
  {
    id: 'h05',
    kind: 'speech-brand',
    says: '"iTunes" 8-drawer dresser (Aitjunz)',
    item: { name: '8-drawer dresser', brand: 'iTunes' },
    truth: ['cpsc:10998'],
    canConfirm: false,
  },
  {
    id: 'h06',
    kind: 'speech-brand',
    says: '"8th June" dresser, model LDQMFJ8D-BK',
    item: { name: 'dresser', brand: '8th June', model: 'LDQMFJ8D-BK' },
    truth: ['cpsc:10998'],
    canConfirm: false,
  },
  {
    id: 'h07',
    kind: 'speech-brand',
    says: '"Lanchez" pressure washer KLC-BULL135C (written lower case)',
    item: { name: 'pressure washer', brand: 'lanchez', model: 'klc-bull135c' },
    truth: ['cpsc:10983'],
    canConfirm: true,
  },

  // ---- model codes written the way people say or type them -----------------------------------------------
  {
    id: 'h08',
    kind: 'model-format',
    says: 'Rowenta cordless vacuum rh99a2u1',
    item: { name: 'cordless vacuum', brand: 'Rowenta', model: 'rh99a2u1' },
    truth: ['cpsc:10845'],
    canConfirm: true,
  },
  {
    id: 'h09',
    kind: 'model-format',
    says: 'Rowenta vacuum "RH 99 A2U1"',
    item: { name: 'vacuum', brand: 'Rowenta', model: 'RH 99 A2U1' },
    truth: ['cpsc:10845'],
    canConfirm: true,
  },
  {
    id: 'h10',
    kind: 'model-format',
    says: 'Belkin power bank "BPB-002"',
    item: { name: 'power bank', brand: 'Belkin', model: 'BPB-002' },
    truth: ['cpsc:10484'],
    canConfirm: true,
  },
  {
    id: 'h11',
    kind: 'model-format',
    says: 'Vevor ice crusher "BY300"',
    item: { name: 'ice crusher', brand: 'Vevor', model: 'BY300' },
    truth: ['cpsc:10523'],
    canConfirm: true,
  },
  {
    id: 'h12',
    kind: 'model-format',
    says: 'Govee heater "H-7131"',
    item: { name: 'space heater', brand: 'Govee', model: 'H-7131' },
    truth: ['cpsc:10086'],
    canConfirm: true,
  },
  {
    id: 'h13',
    kind: 'model-format',
    says: 'Lanchez pressure washer "KLC BULL 135C"',
    item: { name: 'pressure washer', brand: 'Lanchez', model: 'KLC BULL 135C' },
    truth: ['cpsc:10983'],
    canConfirm: true,
  },

  // ---- partial model: must ask, never claim -------------------------------------------------------------
  {
    id: 'h14',
    kind: 'partial-model',
    says: 'Frigidaire gas range FCFG3083 (suffix missing)',
    item: { name: 'gas range', brand: 'Frigidaire', model: 'FCFG3083' },
    truth: ['cpsc:10666'],
    canConfirm: false,
  },
  {
    id: 'h15',
    kind: 'partial-model',
    says: 'Rowenta vacuum "RH99"',
    item: { name: 'vacuum', brand: 'Rowenta', model: 'RH99' },
    truth: ['cpsc:10845'],
    canConfirm: false,
  },

  // ---- vague: brand and product only -> ask for the model ---------------------------------------------------
  {
    id: 'h16',
    kind: 'vague',
    says: 'a Govee heater',
    item: { name: 'heater', brand: 'Govee' },
    truth: ['cpsc:10086'],
    canConfirm: false,
  },
  {
    id: 'h17',
    kind: 'vague',
    says: 'a Kobalt 24 volt string trimmer',
    item: { name: 'string trimmer', brand: 'Kobalt' },
    truth: ['cpsc:10859'],
    canConfirm: false,
  },
  {
    id: 'h18',
    kind: 'vague',
    says: 'Mom Genius baby gate',
    item: { name: 'baby gate', brand: 'Mom Genius' },
    truth: ['cpsc:10428'],
    canConfirm: false,
  },

  // ---- everyday words ------------------------------------------------------------------------------
  {
    id: 'h19',
    kind: 'everyday-words',
    says: 'Frigidaire stove FCRG3083AS (the recall says "gas range")',
    item: { name: 'stove', brand: 'Frigidaire', model: 'FCRG3083AS' },
    truth: ['cpsc:10666'],
    canConfirm: true,
  },
  {
    id: 'h20',
    kind: 'everyday-words',
    says: 'Brookstone fire pit BSFIREPIT01 (sold by Southern Telecom)',
    item: { name: 'fire pit', brand: 'Brookstone', model: 'BSFIREPIT01' },
    truth: ['cpsc:10915'],
    canConfirm: true,
  },

  // ---- no brand: people say "my 2020 Camry" ----------------------------------------------------------------
  {
    id: 'h21',
    kind: 'missing-brand',
    says: 'our 2020 Camry',
    item: { name: 'car', model: 'Camry', year: 2020 },
    truth: vehicle('Toyota', 'CAMRY', 2020),
    canConfirm: true,
  },
  {
    id: 'h22',
    kind: 'missing-brand',
    says: 'a 2018 F150 (no dash, no "Ford")',
    item: { name: 'truck', model: 'F150', year: 2018 },
    truth: vehicle('Ford', 'F-150', 2018),
    canConfirm: true,
  },
  {
    id: 'h23',
    kind: 'model-format',
    says: 'Ford F150 2018 (no dash)',
    item: { name: 'truck', brand: 'Ford', model: 'F150', year: 2018 },
    truth: vehicle('Ford', 'F-150', 2018),
    canConfirm: true,
  },

  // ---- food and drugs: confirmed only by the lot code ------------------------------------------------------
  {
    id: 'h24',
    kind: 'food-drug',
    says: 'Taylor Fresh Foods spicy pimento cheese dip',
    item: { name: 'spicy pimento cheese dip', brand: 'Taylor Fresh Foods' },
    truth: ['fda:H-1348-2026'],
    canConfirm: false,
  },
  {
    id: 'h25',
    kind: 'food-drug',
    says: 'Whole Foods pico de gallo guacamole dip (firm: WFM Purchasing)',
    item: { name: 'pico de gallo guacamole dip', brand: 'Whole Foods' },
    truth: ['fda:H-1249-2026'],
    canConfirm: false,
  },
  {
    id: 'h26',
    kind: 'food-drug',
    says: 'Taro lidocaine ointment 5%',
    item: { name: 'lidocaine ointment', brand: 'Taro' },
    truth: ['fda:D-0848-2026'],
    canConfirm: false,
  },

  // ---- hard negatives: nothing here is recalled ------------------------------------------------------------
  {
    id: 'h27',
    kind: 'hard-negative',
    says: 'Govee space heater H7136 (a sibling of the recalled H7130-H7135)',
    item: { name: 'space heater', brand: 'Govee', model: 'H7136' },
    truth: [],
    canConfirm: true,
  },
  {
    id: 'h28',
    kind: 'hard-negative',
    says: 'Govee desk lamp H6046',
    item: { name: 'desk lamp', brand: 'Govee', model: 'H6046' },
    truth: [],
    canConfirm: true,
  },
  {
    id: 'h29',
    kind: 'hard-negative',
    says: 'Frigidaire refrigerator FFTR1835VW (the recall is a minifridge EFMIS121)',
    item: { name: 'refrigerator', brand: 'Frigidaire', model: 'FFTR1835VW' },
    truth: [],
    canConfirm: true,
  },
  {
    id: 'h30',
    kind: 'hard-negative',
    says: 'Rowenta steam iron DW5280',
    item: { name: 'steam iron', brand: 'Rowenta', model: 'DW5280' },
    truth: [],
    canConfirm: true,
  },
  {
    id: 'h31',
    kind: 'hard-negative',
    says: 'Belkin USB-C cable CAB003',
    item: { name: 'usb-c cable', brand: 'Belkin', model: 'CAB003' },
    truth: [],
    canConfirm: true,
  },
  {
    id: 'h32',
    kind: 'hard-negative',
    says: 'Vevor ice maker (Vevor has five other recalls)',
    item: { name: 'ice maker', brand: 'Vevor' },
    truth: [],
    canConfirm: true,
  },
  {
    id: 'h33',
    kind: 'hard-negative',
    says: 'Samsung gas range NX58K3310SS',
    item: { name: 'gas range', brand: 'Samsung', model: 'NX58K3310SS' },
    truth: [],
    canConfirm: true,
  },
  {
    id: 'h34',
    kind: 'hard-negative',
    says: 'Brookstone massage chair (Brookstone is also a recalled Coachmen RV)',
    item: { name: 'massage chair', brand: 'Brookstone' },
    truth: [],
    canConfirm: true,
  },
  {
    id: 'h35',
    kind: 'hard-negative',
    says: 'Kirkland paper towels (Kirkland prosecco bottles are recalled)',
    item: { name: 'paper towels', brand: 'Kirkland' },
    truth: [],
    canConfirm: true,
  },
  {
    id: 'h36',
    kind: 'hard-negative',
    says: 'Toyota Camry 2012',
    item: { name: 'car', brand: 'Toyota', model: 'Camry', year: 2012 },
    truth: [],
    canConfirm: true,
  },
  {
    id: 'h37',
    kind: 'hard-negative',
    says: 'YOLAAH bed rail BR-02 (BR-01 is recalled)',
    item: { name: 'bed rail', brand: 'YOLAAH', model: 'BR-02' },
    truth: [],
    canConfirm: true,
  },
  {
    id: 'h38',
    kind: 'hard-negative',
    says: 'Mom Genius high chair (their gate is recalled)',
    item: { name: 'high chair', brand: 'Mom Genius' },
    truth: [],
    canConfirm: true,
  },
  {
    id: 'h39',
    kind: 'hard-negative',
    says: 'Taylor Farms salad kit (Taylor Fresh Foods dips are recalled)',
    item: { name: 'salad kit', brand: 'Taylor Farms' },
    truth: [],
    canConfirm: true,
  },
  {
    id: 'h40',
    kind: 'hard-negative',
    says: 'Coachmen Brookstone fifth wheel, 2023 (the recall is for 2025)',
    item: { name: 'fifth wheel trailer', brand: 'Coachmen', model: 'Brookstone', year: 2023 },
    truth: [],
    canConfirm: true,
  },
];
