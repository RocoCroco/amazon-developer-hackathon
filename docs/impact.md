# Impact: the numbers behind Recall Guardian

For the pitch, the video and the Devpost page. Every figure is either **sourced** (primary source linked, read on
the date shown) or **computed** by us from official data (method given), or clearly marked as an **assumption**.
Safe phrasings are at the end, with the claims we must not make.

## 1. The problem in numbers

| Fact | Number | Source |
|---|---|---|
| Consumers who act on a recall announced by press release | **about 6%** | CPSC staff, Recall Effectiveness Workshop, 2017 (docs/sources.md §1) |
| ...when owners are told directly ("recall alerts") | **about 50%** | same |
| CPSC's own report lists, as a way to raise that | **"home voice assistants"** | CPSC Recall Effectiveness Workshop Report, Feb 2018 (docs/sources.md §1) |
| Parents who return the car seat registration card (the only way a maker can warn them) | **42%** | Safe Kids Worldwide, "Car Seat Recalls: What Every Parent Needs to Know", Sept 2015, Harris Poll of 562 parents ([PDF](https://www.safekids.org/sites/default/files/cps_study-2015_v8-for_web.pdf)) |
| Car seats recalled in 2014, and how many were fixed | **6 million+, fewer than half** | same report |
| Recalled motor vehicles repaired, for comparison (owners are known through registration) | **75%** | NHTSA figure quoted in the same Safe Kids report |
| Parents of young children who have used pre-owned children's equipment | **53%** (cribs 28%, high chairs 24%, strollers 17%) | C.S. Mott Children's Hospital National Poll on Children's Health, Vol. 43 Issue 3, May 2023, 932 parents of children 0-7 ([PDF](https://www.newswise.com/pdf_docs/168364108247411_NPCH_vol43_issue3_PreOwnedChildEquip_FINAL.pdf)) |
| ...who find it hard to tell if pre-owned equipment is safe | **63%** | same |
| ...who are very likely to look up recalls on it | **49%** | same |
| Deaths from furniture, TV and appliance tip-overs, 2000-2021 | **592**; 81% children, and 88% of those children under 5 | CPSC 2022 Tip-Over Report, released Feb 9 2023 ([news release](https://www.cpsc.gov/Newsroom/News-Releases/2023/Plans-to-Watch-the-Big-Game-on-the-Big-Screen-CPSC-Reminds-Families-to-Protect-Children-from-the-Deadly-Hazard-of-Toppling-TVs-and-Furniture)) |
| Emergency-room-treated tip-over injuries per year (2019-2021 average) | **19,400** | same |
| Vehicles on US roads with an unfixed recall | **1 in 5** | CARFAX, National Vehicle Safety Recalls Week 2026, as reported by [Digital Dealer](https://digitaldealer.com/news/carfax-free-recall-search-service-tops-10-billion-checks-nationwide/169561/) (primary release not reachable from our tools; re-check before publishing) |
| Adults and children with a food allergy | **about 6%** (children 5.8%, adults 6.2%, 2021) | CDC NCHS, National Health Interview Survey 2021 ([CDC](https://www.cdc.gov/nchs/pressroom/releases/20230126.html)) |

## 2. How many recalls there are (computed by us from the official data)

| Source | Recalls | How we counted |
|---|---|---|
| CPSC consumer products | 2022: **292**, 2023: **324**, 2024: **305**, 2025: **420** | our copy of the CPSC Recalls API (4,760 recalls), by publish year, 2026-10-03 |
| NHTSA vehicles | 2024: **950** campaigns, 2025: **891** | NHTSA bulk recall file (FLAT_RCL), type V, by report date |
| NHTSA equipment, tires, child seats | 2024: 109 equipment, 12 tire, 2 child-seat campaigns | same file, types E, T, C |
| FDA food | 2025: **575** recall events, of which **193 (34%)** for undeclared ingredients (mostly allergens) | openFDA food enforcement API, distinct `event_id`, `reason_for_recall:undeclared`, report date in 2025 |
| FDA drugs | 2025: 765 product records | openFDA drug enforcement API |

**About 2,500 recalls a year** across these four sources. Nobody can watch that by hand; a household needs its
own list matched automatically.

Two facts from our CPSC copy that shaped the product:
- **Only 32%** of CPSC recalls (1,545 of 4,760) list model numbers in a structured field, so for two in three the
  model has to be found in the text, or asked for. That is why Recall Guardian asks the owner one short question
  instead of guessing, and only when a recall for that brand and product exists.
- **Almost every CPSC recall has a product photo** (4,756 of 4,760), which the household panel shows next to the
  hazard.

## 3. The reach

| Fact | Number | Source |
|---|---|---|
| Alexa devices shipped | **600 million+** | Daniel Rausch, Amazon VP Alexa and Echo, CES, Jan 12 2026 ([TechCrunch](https://techcrunch.com/2026/01/12/amazon-says-97-of-its-devices-can-support-alexa)) |
| Share that can run Alexa+ | **97%** | same |
| Customers who could opt in to Alexa+ at that point | **"tens of millions"** | same |
| What Amazon already covers | recalls of items **bought on Amazon** (email + banner) | Amazon, "Your Recalls and Product Safety Alerts" (docs/sources.md §2) |

The gap Recall Guardian fills: gifts, hand-me-downs, second-hand and in-store purchases, cars, food and medicine,
which no retailer can see.

## 4. What direct notice could change (illustration, not a forecast)

The only measured lever is the one above: **about 6%** of consumers act on a press-release recall, **about
50%** with direct notice, roughly **8 times more**. Applying those two CPSC rates to recalled items that sit in
homes, with Recall Guardian as the direct notice:

| Recalled items in users' homes (assumption) | Acted on with press releases only (6%) | With a direct, spoken alert (50%) | Additional items fixed, returned or out of use |
|---|---|---|---|
| 10,000 | 600 | 5,000 | **+4,400** |
| 100,000 | 6,000 | 50,000 | **+44,000** |
| 1,000,000 | 60,000 | 500,000 | **+440,000** |

Read it as "for every 1,000 recalled products a family owns, about 440 more get fixed or put away", under the
assumption that a spoken alert at home works at least as well as the email and letter alerts CPSC measured.
We have not measured it ourselves: that is the pilot to run.

Car seats, specifically: makers can only warn the **42%** of parents who registered. Saying "we got a hand-me-down
Chicco car seat" to Alexa is a registration with no card, no model sticker hunt up front, and it also covers the
second-hand seats that no registration card ever reaches.

## 5. What the product itself delivers (measured)

| Claim | Number | Where |
|---|---|---|
| Recalls it can check | CPSC since mid-2011 (copy of 4,760, refreshed daily), NHTSA vehicles live, child seats/tires/equipment from the NHTSA file, FDA food and drug reports (5 years live) | docs/data-sources.md |
| False "your X is recalled" on the evaluation sets | **0**, including a blind challenge set of 40 messy, misheard descriptions | docs/matcher-results.md |
| Recalled items handled safely in the blind set | **21 of 26** in the honest first run, 26 of 26 after two general fixes | docs/matcher-results.md |
| A brand heard wrong ("8 June", "iTunes") | recovered by sound and a spelled question, in the server | docs/architecture.md §3 |
| Cost of the whole demo stack | **about $12 a month** | docs/costs.md |

**Cost per household at scale (estimate):** the daily matching is a few DynamoDB reads per new recall; the main
per-household cost is Claude's second opinion on matches, about 1,000 input and 100 output tokens per check with
Claude Haiku 4.5 ($1 / $5 per million tokens): about **$0.0015 per check**. Even at 10 checks a month that is about
**1.5 cents per household per month**, before caching (assumption: 10 checks a month; the assistant's own
conversation cost is the assistant's, not ours).

## 6. Lines for the video and the Devpost page

Safe to say:
- "When a product is recalled, CPSC data shows only about 6% of consumers act on the press release. When owners
  are told directly, it's about 50%."
- "The CPSC itself named home voice assistants as a way to reach owners."
- "More than half of parents of young children use pre-owned equipment, and two in three say it's hard to tell
  if it's safe."
- "Only 42% of parents return the car seat registration card, the only way the maker can warn them."
- "There are about 2,500 recalls a year across CPSC, NHTSA and FDA. Nobody can follow that by hand."
- "A third of FDA food recalls in 2025 were for undeclared ingredients, mostly allergens; about 6% of Americans
  have a food allergy."
- "Amazon protects what you buy on Amazon. Recall Guardian protects everything else in your home."
- "If a spoken alert works like the direct notices CPSC measured, that's about 440 more recalled products fixed or
  put away for every 1,000 in our users' homes."

Do not say:
- "6% of recalls are fixed" (it is consumers, at the consumer level, 2015-2016 data; overall correction incl.
  retailers was 65%).
- "Recall Guardian will save X lives" or any fixed number of injuries prevented: we have no measurement.
- "100% accurate". Say "zero false alarms on our evaluation sets", and mention the blind test.
- That Alexa+ ships this today: it is an MCP server that works with an Alexa+ style assistant; the assistant in
  the demo is a simulation.
