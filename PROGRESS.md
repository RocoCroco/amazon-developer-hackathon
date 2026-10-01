# PROGRESS

_Last updated: 2026-10-01_

## Current task
T2.2 - openFDA adapter (food + drug enforcement reports) -> Recall schema; unit tests on fixtures (test/fixtures/openfda-food-enforcement.json, openfda-drug-enforcement.json).

## Done
- Phase 0; Phase 1 (thin slice, T1.7 only blocked for live Bedrock = B1); T2.1 (src/recalls/nhtsa.ts vehicle API + flat file parsing/grouping; vpic.ts VIN decode; text.ts extractDateRange). 81 tests green.
- NOTE for T3.1: matcher currently checks `recall.years` (union); switch to per-product `years` (RecalledProduct.years) so a campaign covering "2018-2020 Camry, 2017-2020 Tacoma" does not match a 2017 Camry.
- LESSON: never generate regex-bearing code via shell heredoc/node -e; use Write/Edit tools (FRICTION F7).

## Left
- openFDA adapter (category food/drug; fields: recall_number, product_description, recalling_firm, reason_for_recall, classification I/II/III, status, report_date YYYYMMDD, recall_initiation_date, distribution_pattern, code_info, product_quantity). Brands: recalling_firm (+ brand names found in product_description?). Hazard = reason_for_recall; remedy: standard "Do not eat/use; return or discard" text by classification. Fetch with search=report_date:[A+TO+B]&sort=report_date:desc&limit=100&skip (paging, limit 1000/request max).

## Next step
Create packages/mcp-server/src/recalls/openfda.ts with `fromOpenFda(raw, kind: 'food'|'drug')`, `fetchOpenFdaRecalls(kind, sinceYYYYMMDD, fetchFn)` with paging, and openfda.test.ts.
