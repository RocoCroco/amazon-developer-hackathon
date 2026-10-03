/**
 * Food allergens: what a recall says is undeclared, and what a family is allergic to, in one vocabulary.
 * FDA food recalls for an undeclared allergen are among the most common ("Undeclared peanuts",
 * "Undeclared milk and pecans"); for most families they are harmless, for an allergic child they are not.
 */

/** Canonical allergen -> words that name it (singular, lower case). The major US allergens plus two common ones. */
const ALLERGENS: Record<string, string[]> = {
  peanut: ['peanut', 'groundnut'],
  'tree nut': [
    'tree nut',
    'almond',
    'cashew',
    'pecan',
    'walnut',
    'hazelnut',
    'pistachio',
    'macadamia',
    'brazil nut',
    'pine nut',
  ],
  milk: ['milk', 'dairy', 'lactose', 'whey', 'casein'],
  egg: ['egg'],
  wheat: ['wheat', 'gluten'],
  soy: ['soy', 'soybean', 'soya'],
  fish: ['fish', 'anchovy', 'anchovies', 'cod', 'salmon', 'tuna', 'pollock'],
  shellfish: ['shellfish', 'shrimp', 'crab', 'lobster', 'crustacean', 'prawn'],
  sesame: ['sesame'],
  mustard: ['mustard'],
  sulfite: ['sulfite', 'sulphite'],
};

/** "Peanuts", "nuts", "dairy", "gluten", "eggs" -> the canonical allergen; unknown words pass through. */
export function canonicalAllergen(spoken: string): string {
  const word = spoken
    .toLowerCase()
    .trim()
    .replace(/[^a-z ]/g, '')
    .replace(/\s+/g, ' ');
  if (word === 'nut' || word === 'nuts' || word === 'tree nuts') return 'tree nut';
  // "peanuts" -> peanut, "anchovies" -> anchovy, "sulfites" -> sulfite
  const forms = [word, word.replace(/s$/, ''), word.replace(/es$/, ''), word.replace(/ies$/, 'y')];
  for (const [allergen, words] of Object.entries(ALLERGENS)) {
    if (words.some((w) => forms.includes(w))) return allergen;
  }
  return forms[1] || word;
}

/** "tree nut" -> "tree nuts", "milk" -> "milk": for speaking. */
export function spokenAllergen(allergen: string): string {
  return ['peanut', 'tree nut', 'egg', 'sulfite'].includes(allergen) ? `${allergen}s` : allergen;
}

// A recall is about an allergen only when it says so; "milk chocolate" alone is not an allergy recall.
const ALLERGY_CUE =
  /\b(undeclared|allergen|allergens|allergic|not declared|unlabeled|unlabelled|may contain)\b/i;

/**
 * The allergens a recall warns about, e.g. "Undeclared milk and pecans" -> ['tree nut', 'milk'].
 * Empty when the recall is not about an undeclared allergen.
 */
export function allergensInRecall(text: string): string[] {
  if (!ALLERGY_CUE.test(text)) return [];
  const lower = ` ${text.toLowerCase().replace(/[^a-z ]/g, ' ')} `;
  return Object.entries(ALLERGENS)
    .filter(([, words]) => words.some((w) => new RegExp(`\\b${w}(e?s)?\\b`).test(lower)))
    .map(([allergen]) => allergen);
}

/** Someone in the household who must avoid an allergen ("Leo", allergic to "peanut"). */
export interface Allergy {
  allergen: string;
  /** Who is allergic, when the family said ("Leo"); otherwise "someone in the family". */
  person?: string;
}

/** The family's allergies that a recall's undeclared allergens hit. */
export function allergiesHit(recallText: string, allergies: Allergy[]): Allergy[] {
  const found = new Set(allergensInRecall(recallText));
  return allergies.filter((a) => found.has(a.allergen));
}

/**
 * One sentence for the owner: "It has undeclared peanuts, and Leo is allergic to peanuts." for an allergy that
 * matters, or reassurance when the undeclared allergen is not one the family has.
 */
export function allergyNote(recallText: string, allergies: Allergy[]): string | undefined {
  const found = allergensInRecall(recallText);
  if (found.length === 0) return undefined;
  const hits = allergiesHit(recallText, allergies);
  if (hits.length > 0) {
    const hit = hits[0]!;
    const who = hit.person ? `${hit.person} is` : 'someone in your family is';
    return `It has undeclared ${spokenAllergen(hit.allergen)}, and ${who} allergic to ${spokenAllergen(hit.allergen)}.`;
  }
  if (allergies.length === 0) return undefined;
  const list = found.map(spokenAllergen);
  const named = list.length === 1 ? list[0] : `${list.slice(0, -1).join(', ')} or ${list.at(-1)}`;
  return `The problem is undeclared ${named}, which is only a risk for people allergic to it.`;
}
