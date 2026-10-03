# Open Recall Format: research and proposed design

Our candidate for the **Open Source mini challenge** (docs/challenges.md): a separate, reusable open project, not
this repo. This page is the research it rests on (read 2026-10-03) and the design we propose. Nothing is public
yet: creating the public repository is the human's call (BLOCKERS.md B4).

## 1. The problem a standard would solve

Every recall authority publishes in its own shape. To answer the one question a family has, **"is something I own
recalled, and what do I do?"**, a developer today has to learn each agency's API, its quirks and its vocabulary,
and then still has to turn prose ("models 22-371 to 22-379 made between July 2010 and May 2013") into something a
program can check. We did exactly that for CPSC, NHTSA and openFDA in Recall Guardian; FRICTION_LOG.md shows what
it cost. Every assistant, retailer app, second-hand marketplace and consumer group that wants to warn owners pays
the same cost again.

## 2. What exists today (and why it does not cover this)

| Existing work | What it is | Why it is not the answer for owners |
|---|---|---|
| **GS1 Product Recall** (XML 3.x; GS1 Germany publishes the 3.6 element guide) | B2B messages between suppliers, retailers and regulators: Notification, Removal Confirmation, Closeout. Elements include `gtin`, `brandName`, `tradeItemName`, `gpcCategoryCode`, `productRecallReasonCode`, `incidentRiskLevelCode`, `consumerInstructions` | Built to pull stock off shelves by GTIN and batch; exchanged privately between trading partners (services like GS1 US Rapid Recall Exchange are paid); no public feed of recalls; most things in a home have no GTIN on them any more |
| **OECD GlobalRecalls portal** (2012; 47 countries, 27,000+ notices) | Governments upload recall notices as zipped XML through an API with keys; GS1 GPC categories and GTINs for cross-country search ([OECD 2020 report](https://www.oecd.org/content/dam/oecd/en/publications/reports/2020/05/oecd-globalrecalls-portal_a4bf1196/d8b0d605-en.pdf)) | Non-food only; upload interface for governments, no documented public read API; the report itself describes data that "could not be loaded due to non-compliant data" |
| **EU Safety Gate** (formerly RAPEX) | Rich records behind the public site's JSON API: `product.brands[]`, `product.modelTypes[]`, `product.barcodes[]`, `product.batchNumbers[]`, `risk.riskType[]` (e.g. `riskType.chemical`), `measureTaken.measures[]` with category (e.g. withdrawal from market), voluntary/compulsory, `traceability.countryOrigin`, photos | Non-food; the API is the website's own and undocumented; EU-only vocabulary |
| **EU GPSR recall notice** (Regulation 2023/988 Art. 36; template in Implementing Regulation (EU) 2024/1435, applies from Dec 13 2024) | What a consumer recall notice must say: heading "Product Safety Recall"; product description with images, name, brand, identification numbers, place and time of sale; the risk, without words that play it down ("voluntary", "in rare situations"); the procedure, starting with an invitation to stop using the product; the remedies (repair, replacement or refund, Art. 37) | A document layout for people, not a data format |
| **RappelConso** (France, DGCCRF; open data, 18,519 records) | Best owner-side data we found: per product `gtin` + lot + best-before date in `identification_produits`; `conduites_a_tenir_par_le_consommateur` as a list ("ne plus consommer", "rapporter le produit au point de vente"...); `modalites_de_compensation` (e.g. "remboursement"); sale dates and area | French-only vocabulary; identifiers packed into a delimited string |
| **Health Canada Recalls and Safety Alerts** (open data, Open Government Licence - Canada, daily) | One feed for Health Canada, Transport Canada and CFIA: 34,168 records with `Title`, `Product`, `Issue`, `Category`, `Recall class`, `URL` | No brand, model, identifier or remedy fields in the open file; they are only on each web page |
| **UK OPSS Product Safety Alerts, Reports and Recalls** | GOV.UK search API with `product_alert_type`, `product_risk_level`, `product_category`, `product_measure_type` (3,746 records) | Non-food, metadata only; no identifiers |
| **US CPSC Recalls API** | `Products[]` (Name, Model, Type, NumberOfUnits), `ProductUPCs[]`, `Hazards[]`, `Remedies[]`, `RemedyOptions[]`, `Manufacturers[]`, `Retailers[]`, `Images[]`, `Injuries[]` | Models are in the `Model` field for only **32%** of recalls (1,545 of 4,760 in our copy); the rest are in prose |
| **US NHTSA** (API + bulk file) | Make, model, model year, component, campaign number, child seats and tires in the bulk file | Vehicle-shaped only |
| **US openFDA enforcement** | `product_description`, `code_info` (lots, dates, UPCs in free text), `classification` (Class I/II/III), `reason_for_recall` | Identifiers in free text |
| **schema.org** | No recall type. [Issue #3229](https://github.com/schemaorg/schemaorg/issues/3229) "Add an object to represent product recalls" has been open since Dec 2022; a commenter asks for alignment with GS1 | The gap is acknowledged and unfilled |
| **Open-source code** | Single-agency clients (CPSC clients, a few CPSC and Safety Gate MCP servers) and paid scrapers on Apify that each invent a private "unified schema" | No shared, documented, versioned format; no way to say which units are affected in a checkable way |

**The gap:** nobody publishes recalls in a shared, open, machine-checkable form aimed at the **owner side**: which
exact units are affected, how an owner finds the identifier on the product, what to do first, and what the remedy
is. GS1 covers the supply chain, GPSR covers the human notice, OECD covers government-to-government exchange.

## 3. What we propose: Open Recall Format (ORF)

A small, versioned JSON format (JSON Schema 2020-12, with a JSON-LD context that maps onto schema.org and GS1
terms), plus open-source normalizers that turn today's official feeds into it. Specification under CC BY 4.0,
code under Apache-2.0.

### Design principles (from building Recall Guardian)

1. **Affected units are data, not prose.** A recall says which units are affected through a list of
   *identification rules*: model codes (exact, or a range like 22-371..22-379), GTIN/UPC, lot or batch codes,
   serial ranges, best-before or use-by dates, production date windows (month precision), vehicle make + model +
   model years. Each rule says whether it is *complete* ("only these models") or *partial* ("including"), because
   "all models" and "we listed some" lead to opposite answers.
2. **Never turn "unknown" into "not recalled".** Fields can say `unknown` explicitly; a checker answers
   `affected`, `possibly_affected` (with the one detail that would settle it) or `not_affected`, never a silent no.
3. **Tell the owner where to look.** `identification_hint`: "The model number is on a sticker under the seat."
   Recall Guardian's most useful question is this one; agencies often write it, buried in prose.
4. **First action first.** An ordered list of actions from a closed vocabulary, aligned with GPSR Art. 36 and
   RappelConso: `stop_using`, `do_not_eat`, `do_not_give_to_children`, `keep_away_from_children`, `contact_firm`,
   `return_to_store`, `dispose`, `get_repair`, `check_with_doctor`. Remedies from GPSR Art. 37 plus US practice:
   `refund`, `replacement`, `repair`, `repair_kit`, `new_instructions_or_label`, `none`.
5. **Hazards and severity from a shared vocabulary.** Hazard types reuse the EU Safety Gate list (injuries, fire,
   burns, electric shock, choking, suffocation, strangulation, drowning, chemical, microbiological, ...) plus an
   allergen code list (the US major food allergens and the EU's 14); severity maps FDA Class I/II/III, Health
   Canada Type I/II/III, Safety Gate risk level and NHTSA safety recalls onto `serious` / `moderate` / `low` /
   `unknown`, keeping the source value.
6. **Plain language for every channel.** A required one-sentence `summary` an assistant can read aloud (no URLs,
   no markup), plus the authority's own text.
7. **Provenance and revisions.** Source agency, source id, URL, licence, first published, last updated, a content
   hash, and links to the records it supersedes, so a consumer can tell a revision from a re-fetch (a real problem
   we solved with hashes in the watcher).
8. **Map, don't invent.** Product category: optional GS1 GPC brick plus a coarse top-level enum (`food`, `drug`,
   `medical_device`, `cosmetic`, `vehicle`, `vehicle_equipment`, `child_restraint`, `tire`, `consumer_product`).
   Countries ISO 3166-1, languages BCP 47, dates ISO 8601, identifiers as GS1 defines them.

### A record, as it would look (real CPSC recall 25-036, Govee heaters)

In CPSC's own record the `Model` field is empty; the six model numbers, the variation and where to find the
model number are only in the description prose. The normalizer pulls them out; the owner-facing app no longer has to.

```json
{
  "orf_version": "0.1",
  "id": "us-cpsc:25036",
  "source": {
    "authority": "US-CPSC",
    "id": "25036",
    "url": "https://www.cpsc.gov/Recalls/2025/GoveeLife-and-Govee-Smart-Electric-Space-Heaters-Recalled-Due-to-Fire-and-Burn-Hazards-Imported-by-Govee",
    "licence": "public-domain-us-gov"
  },
  "jurisdictions": ["US"],
  "published": "2024-11-07",
  "updated": "2024-11-07",
  "category": "consumer_product",
  "summary": "GoveeLife and Govee smart space heaters can overheat and catch fire. Stop using them and contact Govee for a refund.",
  "products": [
    {
      "name": "GoveeLife and Govee Smart Electric Space Heaters",
      "brands": ["GoveeLife", "Govee"],
      "units": [
        { "count": 512500, "approximate": true, "country": "US" },
        { "count": 48600, "approximate": true, "country": "CA" }
      ],
      "identification": [
        { "type": "model", "values": ["H7130", "H7130101", "H7131", "H7132", "H7133", "H7134", "H7135"], "complete": true }
      ],
      "identification_hint": "The model number is on the manufacturer's label on the underside of the unit.",
      "sold": { "where": "Amazon.com, us.govee.com, the Govee Home App and TikTok Shop", "from": "2021-09", "to": "2024-09" },
      "images": [{ "url": "https://www.cpsc.gov/s3fs-public/space-1.png", "caption": "Recalled Model H7130" }]
    }
  ],
  "hazards": [{ "type": "fire" }, { "type": "burns" }],
  "severity": { "level": "unknown" },
  "actions": ["stop_using", "contact_firm"],
  "remedies": ["refund"],
  "contact": { "firm": "GoveeLife or Govee", "phone": "+1-833-772-5360", "url": "https://recall.goveelife.com/heater-recall" },
  "incidents": { "text": "113 reports of overheating, including seven reports of fires and one report of a minor burn injury." }
}
```

### What the project ships

| Part | Contents |
|---|---|
| `spec/` | The format in prose, the vocabularies, the mapping to GS1 Product Recall, GPSR Art. 36 and schema.org; versioning rules |
| `schema/` | JSON Schema 2020-12 and a JSON-LD context |
| `normalizers/` | TypeScript (npm) converters, each with recorded real fixtures and tests: US CPSC, NHTSA (API + bulk file), openFDA (food, drug, device); Health Canada; EU Safety Gate; France RappelConso; UK OPSS. Model-code and lot extraction from prose (what we built for Recall Guardian, generalised) |
| `checker/` | A reference function `check(record, item) -> affected / possibly_affected (+ what to ask) / not_affected`, the core of Recall Guardian's matcher, so every consumer answers the same way |
| `cli/` | `orf fetch cpsc --since 2026-09-01 > recalls.ndjson`: one command to get any feed in the format |
| Conformance | Fixtures that every implementation must classify the same way, including the hard cases from our blind challenge set |

Recall Guardian becomes its first user (our adapters are replaced by the package), which shows real reuse.

### Who could reuse it

- Assistants and apps that warn owners (any MCP server, home-inventory apps, baby-registry and second-hand
  marketplaces checking listings).
- Consumer groups and researchers comparing recalls across countries (today: hand-made spreadsheets).
- Agencies themselves: a published, free target format would make the OECD portal's "non-compliant data"
  problem smaller, and gives schema.org issue #3229 a concrete proposal to discuss.

## 4. Scope for the hackathon window (until Oct 23)

1. v0.1 spec + JSON Schema + vocabularies (the parts above).
2. Normalizers for the three US sources we already know deeply, then Health Canada, EU Safety Gate and
   RappelConso (their records are richer than the US ones on identifiers).
3. Reference checker + conformance fixtures.
4. CLI.
5. A comment on schema.org issue #3229 with the proposal (a contribution to an existing public repository, which
   the challenge also accepts).
6. Recall Guardian switched to the package.

## 5. Risks and honest limits

- A format is only a standard when others adopt it. v0.1 is a proposal with working converters, not an
  endorsed standard; we say so in the README.
- EU Safety Gate's JSON API is undocumented: the normalizer must be defensive and cite the public site.
- Licences differ per source (US federal works are public domain; Health Canada: Open Government Licence -
  Canada; EU and France: to be confirmed per dataset before we ship their fixtures). Fixtures will carry their
  licence and attribution.
- Prose extraction is never perfect: the format lets a converter say `complete: false` or `unknown` rather than
  guess.

## Sources

- GS1 Product Recall standard (XML 3.4.1 page): https://www.gs1.org/standards/edi-xml-recall/xml-product-recall/3-4-1;
  element guide (3.6, GS1 Germany): https://www.publikationen.gs1-germany.de/Complete/gs1_xml_3.6/profiles_go/productrecallnotification/en/30index.htm
- OECD, "OECD GlobalRecalls portal: 2015-2019 enhancements", Digital Economy Papers, May 2020 (PDF above)
- GS1, "OECD uses GPC for their GlobalRecalls portal": https://www.gs1.org/resources/articles/organisation-economic-co-operation-and-development-oecd-uses-gpc-their-globalrecals-portal
- EU Safety Gate public site: https://ec.europa.eu/safety-gate-alerts/ (records read through the site's JSON API, 2026-10-03)
- Implementing Regulation (EU) 2024/1435 (recall notice template): https://eur-lex.europa.eu/eli/reg_impl/2024/1435/oj;
  summary of the mandatory elements: https://www.ibf-solutions.com/en/seminars-and-news/news/standardised-template-for-a-recall-notice
- RappelConso v2 open data: https://data.economie.gouv.fr/explore/dataset/rappelconso-v2-gtin-trie/
- Health Canada Recalls and Safety Alerts open data: https://open.canada.ca/data/en/dataset/d38de914-c94c-429b-8ab1-8776c31643e3
- UK OPSS: https://www.gov.uk/product-safety-alerts-reports-recalls (GOV.UK search API)
- schema.org issue #3229: https://github.com/schemaorg/schemaorg/issues/3229
- Our own figures: docs/impact.md section 2
