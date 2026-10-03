# Recall data sources (T1.1)

All endpoints below were called successfully on 2026-10-01 from `scripts/fetch-fixtures.mjs` (trimmed
responses are in `packages/mcp-server/test/fixtures/`). None needs an API key.

## 1. CPSC (consumer products) — SaferProducts.gov Recalls REST API
- Base: `https://www.saferproducts.gov/RestWebServices/Recall`
- `format=json` (XML is default). No key. No documented rate limit: cache, and fetch incrementally.
- Filters used: `RecallDateStart=YYYY-MM-DD`, `LastPublishDateStart=YYYY-MM-DD` (both work, although the
  docs page only lists Title, RecallDescription, ProductName; the Programmer's Guide PDF lists the rest),
  `ProductName=...`. Returns a bare JSON array.
- Fields: RecallID, RecallNumber, RecallDate, LastPublishDate, Title, Description, URL, ConsumerContact,
  Products[{Name, Description, Model, Type, CategoryID, NumberOfUnits}], Hazards[{Name}],
  Remedies[{Name}], RemedyOptions[{Option}] (Refund/Repair/Replace), Injuries, Manufacturers, Retailers,
  Importers, Distributors, SoldAtLabel, ProductUPCs, Images.
- **Gotcha:** `Products[].Model` is usually empty. Model numbers/brand sit in free text (`Title`,
  `Description`, "model number is located on ..."). The matcher must extract them from text.
- **Incremental fetch:** supported (`LastPublishDateStart`) — use it for the watcher, with some overlap and
  dedupe by `RecallID`.

## 2. NHTSA — vehicles
- `GET https://api.nhtsa.gov/recalls/recallsByVehicle?make=toyota&model=camry&modelYear=2020` → `{Count, results[]}`;
  fields: NHTSACampaignNumber, Manufacturer, ReportReceivedDate (MM/DD/YYYY), Component, Summary,
  Consequence, Remedy, Notes, parkIt, parkOutSide, overTheAirUpdate, Make, Model, ModelYear.
- `GET https://api.nhtsa.gov/recalls/campaignNumber?campaignNumber=20V682000` → all vehicles of a campaign.
- `GET https://api.nhtsa.gov/products/vehicle/modelYears?issueType=r` and `/products/vehicle/makes?modelYear=2020&issueType=r` → valid values.
- **No "since date" query.** Lookups are by make/model/year or campaign number. No key; no documented limit.
- Endpoints I guessed for equipment (`/recalls/recallsByEquipment`, `/products/equipment/*`) return
  403 "Missing Authentication Token" = they do not exist (see FRICTION_LOG F2).

## 3. NHTSA — car seats, tires, equipment: bulk flat file
- The JSON API above covers vehicles only (as far as I could find). Child restraints (`C`), equipment (`E`) and tires (`T`)
  are in the daily bulk file:
  `https://static.nhtsa.gov/odi/ffdd/rcl/FLAT_RCL_POST_2010.zip` (~15 MB zip, ~311 MB text, updated daily;
  max RCDATE seen 2026-09-29). Format spec: `https://static.nhtsa.gov/odi/ffdd/rcl/RCL.txt`.
- Tab-delimited, Latin-1, dates `YYYYMMDD`. 245,627 rows: V 218,890; T 20,282; E 5,993; **C 462** (child seats).
- Key columns (1-based): 2 CAMPNO, 3 MAKETXT, 4 MODELTXT, 5 YEARTXT (9999 = unknown), 9 BGMAN / 10 ENDMAN
  (manufacturing dates, often empty), 11 RCLTYPECD (V/E/C/T), 12 POTAFF, 16 RCDATE (report received),
  20 DESC_DEFECT, 21 CONEQUENCE_DEFECT, 22 CORRECTIVE_ACTION.
- Car seats are findable by brand+model, e.g. `GRACO` / `SNUGRIDE` (14C004000). Manufacturing date ranges are
  usually only in the description text ("manufactured between July 2010 and May 2013").
- **Incremental fetch:** supported via RCDATE >= last run, but needs download + streaming unzip + filter.
  Design: watcher Lambda streams the zip (pure-JS unzip), keeps only rows with RCDATE >= since (and type
  C/E/T, plus V), never loads the whole 311 MB. Lambda needs ephemeral storage or pure streaming.
- Sample: `test/fixtures/nhtsa-flat-sample.txt` (made by `scripts/extract-nhtsa-flat-sample.mjs`).

## 4. NHTSA vPIC — VIN decode
- `GET https://vpic.nhtsa.dot.gov/api/vehicles/DecodeVinValues/{VIN}?format=json[&modelyear=YYYY]`
  → `Results[0]` with Make, Model, ModelYear, ErrorCode, ErrorText, ... Works without a key. A wildcard/partial VIN
  returns data with ErrorCode 6 ("Incomplete VIN").

## 5. openFDA — food and drug enforcement reports
- `GET https://api.fda.gov/food/enforcement.json` and `/drug/enforcement.json`
- Query: `search=report_date:[20260901+TO+20261001]&sort=report_date:desc&limit=N` (works; `skip` for paging).
- Fields: recall_number, product_description, recalling_firm, reason_for_recall, classification (I/II/III),
  status, report_date, recall_initiation_date, distribution_pattern, code_info, product_quantity, state...
- **Limits:** key not required. Without a key 240 req/min and 1,000 req/day per IP; with a free key 120,000/day
  (source: https://open.fda.gov/apis/authentication/). Data updated weekly (food: 2004-present).
  Incremental fetch: supported (`report_date`).

## Design consequences
| Source | Since-date query | Watcher strategy |
|---|---|---|
| CPSC | yes (`RecallDateStart/End`; `LastPublishDate*` answers HTTP 503 since 2026-10-03, F18) | fetch since last run |
| openFDA | yes (`report_date`) | fetch since last run |
| NHTSA vehicles (API) | no | re-query per registered vehicle (make/model/year), cache by campaign number |
| NHTSA car seats/equipment/tires | via flat file RCDATE | stream daily flat file, filter by RCDATE |

## Implementation notes (T2.1-T2.3)
- **openFDA ids:** `recall_number` can be `"N/A"` (food and drug). We key recalls by recall number, else `event_id`, else a content hash (`recallKey` in `openfda.ts`).
- **NHTSA flat file:** streamed with `node:zlib` only (`flatfile.ts`): the zip's first entry is inflated on the fly, so the 311 MB file is never held in memory. A real run over the last 30 days takes ~3.6 s and yields ~63 campaigns. Rows of one campaign are grouped into one recall.
- **Incremental sync:** `syncFeed` pulls from (cursor - 3 days) to today, upserts by id, then advances the cursor. Re-fetched overlap counts as `unchanged`; only never-seen ids are `added` (the watcher alerts on those); a failed fetch keeps the cursor.

## What check_item can see in production (as of T9)
- **Consumer products (CPSC):** live `ProductName` lookup by brand and by item name, cached 6 h in the Lambda, **plus a full copy in the recall cache** (watcher event `{"backfill":"cpsc","since":"2008-01-01"}`: one quarter per request, failing windows split down to single days). The CPSC API flaps (HTTP 503 for hours on 2026-10-03), so the cache answers when it is down (`StoreRecallProvider` "covers" CPSC). If no source can answer, the tools say "I couldn't reach the recall database" and never "no recalls" (`source_unavailable`).
- **Vehicles (NHTSA API):** live lookup by make + model + model year, only when all three are known.
- **Child seats (NHTSA flat file):** every campaign in the POST-2010 file, loaded once with the watcher's `{"backfill":"child-seats"}` event (71 recalls) and kept current by the daily sync.
- **Food and drugs (openFDA):** live lookup by brand of the last 5 years of enforcement reports (food and drug), matched against `product_description` and `recalling_firm` with `search=(product_description:"<brand>"+recalling_firm:"<brand>")+AND+report_date:[...]`; the brand on the label is often not the recalling firm ("Mercer's brand ice cream sandwiches" from Quality Dairy Farms), so brands are also read from the description. Confirmed only with the lot code.
- **Allergies:** `update_allergies` stores the family's food allergies; a food recall for an undeclared allergen says whether it matters ("It has undeclared peanuts, and Leo is allergic to peanuts") and jumps to the top of the alerts. `recent_allergen_recalls` answers "any recent peanut recalls?" from openFDA (`reason_for_recall:undeclared`, last N days). Without an API key openFDA allows 1,000 requests a day per IP; answers are cached 6 h.
- **Equipment, tires:** only what the daily watcher has synced since it started.
- **Cache index:** every cached recall is indexed by brand words and by product words (`PRODUCT#dresser`), so a misheard brand can still be compared by sound with the brands of the same kind of product.
