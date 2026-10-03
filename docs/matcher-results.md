# Matcher quality (T3.1)

How good is the deterministic matcher (`packages/mcp-server/src/matcher/`) at deciding whether an item a
household owns is covered by a real recall? Everything below is measured by `npm test` (see
`src/matcher/eval.test.ts`); run `npx vitest run eval` to print the numbers and every disagreement.

## What "strong" and "possible" mean

The matcher never answers just yes/no. It returns one of:

- **strong** - "your item is recalled". Allowed only when the evidence really identifies the unit:

  | Source | Strong requires |
  |---|---|
  | consumer product (CPSC) | brand + a model code the recall lists (or its prose names) |
  | vehicle (NHTSA) | brand + an **exactly equal** model name + the **model year** of that product line |
  | child seat, tire, equipment (NHTSA) | brand + model, and the item's period inside the recall's **production window**: the **whole year** must be inside it, or the owner gives the **month**; or a code printed on the product (part of a longer model, or a listed prefix such as "model numbers beginning with 310") |
  | food, drug (openFDA) | never: lots are only on the label, so we ask for the lot code |

- **possible** - fits so far, a detail is open. Comes with `missing` = `model`, `year`, `month` or `lot`, which becomes
  the clarifying question. The assistant must not claim a recall for a "possible" match.
- **no match** - brand not named, a different product, a different model, a year outside the recalled years or
  window, or a different dosage form ("tablets" vs "elixir").

## Test data (all real)

Corpus: **1,313 real recalls**, fetched by `scripts/fetch-matcher-corpus.mjs` from the official APIs:
585 consumer recalls (583 CPSC recalls from Oct 2025 onwards, plus the older Govee and Shop LC heater recalls),
419 vehicle recalls (NHTSA API results for Camry 2020, Civic 2019, F-150 2018 and Model 3 2020, plus sampled
2025+ vehicle campaigns from the NHTSA flat file), 71 child-seat recalls (every child-seat row of the file),
31 equipment and 7 tire recalls (2025+), and the latest 100 openFDA food and 100 drug records.

Two evaluation sets, each item compared against every recall in the corpus:

1. **Hand-labeled: 77 items** (33 positives, 14 "open" questions, 30 hard negatives; see
   `test/matcher-items.ts`). The hard negatives are: same brand but another model, same model but another brand, other product from the same
   brand, brand that is only a prefix of another word, year outside the recalled window, wrong dosage form,
   no brand at all.
2. **Generated: 478 items** from the corpus itself (`test/generated-items.ts`): each real vehicle, consumer
   and car-seat recall yields a positive plus perturbed negatives (a year far outside the recall, a model that
   does not exist). Expectations come from an explicit coverage policy over the structured fields and prose,
   written independently of the matcher.

## Results

| Set | Items | Item x recall pairs | Strong TP | Strong FP | Strong FN | Strong precision | Strong recall |
|---|---|---|---|---|---|---|---|
| Hand-labeled | 77 | 101,101 | 34 | 0 | 0 | **100%** | **100%** |
| Generated | 478 | 627,614 | 267 | 0 | 0 | **100%** | **100%** |

- Hand-labeled: all 22 expected open matches were found; 0 false alarms.
- Generated: 15 "false alarms", all of the form "possible" (never strong): e.g. item "Evenflo Titan" vs a
  recall of "Evenflo Titan 65", or "Evenflo Litemax" vs "Revolve 180 Litemax Nxt". The model is only part of a
  longer listed name, so the matcher asks for the full model number instead of guessing. These are acceptable.
- The CI gate is `precision >= 95%` (and `recall >= 90%` on the generated set).

## Challenge set: messy descriptions, labels never fitted to the matcher (T9.13)

The two sets above score 100%, and a judge should not take that at face value: the hand-labeled labels
were reconciled with the matcher (see "How we got here"), and the generated items are built from the same
structured fields the matcher reads. So a third set was written to **find failures**:
`test/challenge-items.ts`, run by `src/matcher/challenge.test.ts`.

- **40 items, labeled before running the matcher and never edited to agree with it.** For each item the label
  says which recalls really cover it and whether the description is enough to say "recalled" or whether the
  right answer is a question.
- They are written the way people talk: brands misheard by speech recognition ("Frigidair", "Go Vee",
  "iTunes" and "8th June" for Aitjunz), model codes with spaces, a missing dash or lower case, **partial**
  model codes, brand + product only, everyday words ("stove" for a recalled "gas range"), **no brand** ("our 2020
  Camry"), food and drugs (only a lot code can confirm), and **14 hard negatives**: a sibling model of a recalled
  series (Govee H7136), another product of a recalled brand (Belkin cable, Rowenta iron, Kirkland paper towels),
  a brand that is also a recalled RV name (Brookstone), a recalled model's year outside the recall.
- It scores the whole answer a family would hear, as `check_item` builds it: "recalled", a question (which
  model or lot, "who makes it?", "do you mean ...?"), or nothing.

| Run | Recalled items handled safely (confirmed or right question) | Missed | Exactly the ideal answer | False "recalled" claims | Needless questions |
|---|---|---|---|---|---|
| Blind first run | 21 / 26 (80.8%) | 5 | 34 / 40 | **0** | 1 |
| Evaluator corrected (no matcher change) | 23 / 26 (88.5%) | 3 | 34 / 40 | **0** | 1 |
| After two matcher fixes | 26 / 26 | 0 | 36 / 40 | **0** | 1 |

The first run missed: a brand split in two by speech recognition ("Go Vee" heater H7131), two partial model codes
("FCFG3083" for a recalled FCFG3083AS range, "RH99" for Rowenta RH99A2U1), and two vehicles said without a make.
The vehicles were an evaluator error, not a matcher one: `check_item` never guesses a missing brand, it asks
"Who makes it?", so they are "asked" (second row).
Two general fixes followed: a model code that is the start of a listed model is now an open match ("what is the
full model number?"), and a brand that differs from a recalled brand only by spacing gets a "do you mean"
question. **These fixes were made after seeing the set, so the second row is optimistic**; the first row is the
honest blind number.

What is still not ideal (and stays in the report on purpose):

- "Go Vee" and the two vehicles without a make get a question where a person would just say "recalled": one
  extra turn, never a wrong answer.
- "Vevor ice maker" gets a needless question, because a Vevor *ice crusher* is recalled and the product words
  overlap ("ice"). The question is cheap; claiming it would be wrong.
- Strong-answer precision stays 100% on this set and false alarms stay 0 (that is the CI gate). With 40 items
  this is evidence, not proof.

## How we got here (what the evaluation found)

Honest history, because the first numbers were not good and some labels were wrong too.

1. **First run of the improved matcher on the hand-labeled set: precision 90.6%, recall 90.6%** (3 false
   strong matches, 3 missed). Reviewing each disagreement against the recall text:
   - *Label mistakes (the matcher was right):* the Cuisinart grill brush model CCB-4125 is in both the original
     recall and its later expansion; Graco SnugRide is also covered by a 2026 "SnugRide Turn & Slide" recall; the
     tire recalls only cover production windows (so a confident answer needs a year). These labels were fixed
     **after** seeing the matcher output. They were checked against the recall text, and the changes are marked
     in `test/matcher-items.ts`; still, treat the hand-labeled 100% as optimistic and read the generated set as
     the independent number.
   - *Matcher over-claims (labels were right):* an Evenflo "Big Kid" booster matched a 2025 "certain seats"
     recall that has no window, and "fluphenazine tablets" matched an elixir recall. Fixes: a name-only model
     match is only confident when the year is verified against a window; dosage-form conflict rule.
2. **First run on the generated set** found four real bugs that the hand-labeled set missed:
   - the manufacturing window was applied to vehicles, but a vehicle's year is its *model year* while the window
     holds *production* dates (a 2024 Peterbilt built in 2025 was rejected);
   - "Ford F-150" matched an "F-150 Lightning" recall as strong (a partial model name); vehicles now need an
     exact model name;
   - brand names with filler words ("Fun and Function") could never match themselves;
   - the model-year column of the NHTSA seat rows conflicts with the item's "made/bought" year, so for seats and
     tires only the production window is used.
3. **Month granularity (added while writing the clarification flows).** One real recall, Graco Extend2Fit, covers
   seats made November 2015 to January 2016. An owner saying "made in 2016" may or may not be inside it, so a
   year-only check over-claimed. Now an item's year counts as verified only when the whole year lies inside the
   window; otherwise the matcher stays "possible" and asks which month (`missing: month`). That turned 12 hand-
   labeled "strong" expectations into open ones until the label got a month (recall dropped to 62.5% at that moment,
   precision stayed 100%); I added 8 items for these short-window cases and a "year only" variant to the generator.
4. Final numbers are in the table above.

## Limits (be skeptical)

- The corpus is real but small compared with all recalls ever issued; precision over a bigger corpus may be lower.
- Items here are clean structured input. The hard part in production - getting the *brand and model out of
  a spoken sentence* - is done by the language model and is not measured by this set.
- Brand matching is lenient on purpose (a brand named anywhere in the recall title or product names); the model
  and product-type checks carry the precision. A brand that is also a common word is the most likely source of
  false "possible" matches.
- The LLM confirmation step (T3.2) adds a second opinion on "possible" matches; it is not part of these numbers.
