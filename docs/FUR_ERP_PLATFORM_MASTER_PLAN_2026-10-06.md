# FUR ERP Platform Master Plan — 2026-10-06

Status: strategic implementation plan. This document does not claim that future capabilities are already live.

## 1. Product boundary

`fur-erp` is an independent multi-tenant operating system for fur/raw-material procurement, lot inventory, production, costing, documents, reconciliation and finished-goods movement.

It must not be merged conceptually with:

- YNN — management diagnostic / transformation workspace;
- yanina-management — single-company couture production OS;
- synth-v2 — fashion PLM / commerce OS.

Integration may be added later through explicit APIs and evidence contracts, but business truth remains local to each authoritative product.

## 2. Existing factual foundation

The current model already contains the core graph required for a defensible vertical platform:

`Organization -> Supplier -> Purchase -> PurchaseItem -> RawMaterialLot -> StockMovement -> ProductionOrder -> ProductionMaterialUsage -> ProductionExpense -> FinishedGoodsStock -> Shipment`

Supporting authority includes:

- clients;
- warehouses;
- fur/color reference dictionaries;
- production plans and calendar;
- payments;
- purchase documents;
- fittings/photos;
- production batches;
- document records (attached files);
- audit log;
- multi-tenant organization scope.

This foundation should be extended rather than replaced.

## 3. North star

Evolve FUR ERP from a vertical accounting/production application into a **Traceable Fur Material & Production Network OS**:

`auction/source -> lot identity -> purchase economics -> chain of custody -> dressing/processing -> production consumption -> finished item -> shipment -> evidence passport -> verified supplier/provider history`

The moat is not a generic ERP feature set. It is accumulated, reconstructable evidence about material identity, movement, cost, yield, quality and execution history.

---

# Wave A — Lot Genealogy and Material Passport

## Fur Lot Passport — ADOPT

Every canonical lot should be projectable into a versioned passport containing, where available:

- organization-local lot ID;
- source purchase and supplier;
- auction/session;
- invoice / transfer-document references;
- fur/material type;
- grade/sort;
- color;
- quantity received;
- unit;
- landed-cost snapshot;
- warehouse;
- receipt date;
- related source documents;
- processing/dressing history;
- production consumption;
- remaining quantity;
- correction/reconciliation history;
- passport version/hash.

The passport is a projection over authoritative ERP facts. It must not become a second editable source of truth.

## Lot genealogy — ADOPT

Support parent/child lineage for operations such as:

- split;
- merge;
- regrading;
- dressing/processing;
- return;
- transfer;
- reservation;
- production issue;
- recovery/return from production.

A user must be able to answer:

> where did this material come from, what happened to it, what did it cost, where was it consumed, and which finished items depend on it?

## Immutable economics boundary — REQUIRED

Historical landed-cost / production-cost truth must remain versioned and explainable.

No future marketplace, supplier profile or AI feature may silently rewrite cost snapshots that have already participated in production/accounting history.

---

# Wave B — Yield, Waste and Material Intelligence

## Yield Ledger — ADOPT

Derive for each sufficiently evidenced production case:

- quantity issued;
- quantity returned;
- quantity consumed;
- recoverable remainder;
- waste/loss;
- finished quantity;
- yield ratio;
- cost per finished unit;
- variance to model/plan.

## Explainable benchmark dimensions — ADOPT

Where sample size and privacy permit, compare:

- fur/material type;
- grade/sort;
- color;
- supplier/source;
- processing route;
- product model/category;
- workshop/provider;
- season.

Never collapse this into one opaque supplier score.

## Waste / anomaly detection — ADAPT

Flag explainable conditions such as:

- consumption materially above comparable history;
- lot balance mismatch;
- unusual write-off;
- cost jump;
- repeated correction pattern;
- document/economic mismatch.

A flag is a review queue item, not an accusation of fraud or poor workmanship.

## Material planning model — CONDITIONAL

Once historical evidence is sufficient:

`model + size + material type + process -> expected requirement range`

Use ranges/confidence and source sample counts. Preserve manual technologist authority.

---

# Wave C — Supplier, Auction, Agent and Processor Network

## Supplier / Provider Passport — ADOPT

Create scoped profiles for:

- supplier;
- auction/source;
- agent/intermediary;
- dressing/processing provider;
- logistics provider;
- external workshop where applicable.

Factual dimensions may include:

- identity/document completeness;
- categories supplied;
- lots received;
- delivery history;
- reconciliation quality;
- document completeness;
- correction frequency;
- observed quality/grade disputes;
- processing turnaround;
- evidence freshness.

## No universal reputation score — REQUIRED

Do not reduce providers to one unexplained number.

New providers receive a neutral `no-history` state, not a low score.

## Provider capability credential — ADOPT

Possible scoped attestations:

- Lot Data Integration Verified;
- Document Reconciliation Verified;
- Processing Traceability Verified;
- API/EDI Integration Verified;
- Chain-of-Custody Evidence Ready.

These are process/platform credentials only. They do not certify legal compliance, sanctions compliance, ethical sourcing or material quality unless those claims are backed by an authorised external source and explicit evidence.

---

# Wave D — Chain-of-Custody Evidence Standard

## FUR ERP Traceability Standard — ADOPT

Define a versioned machine-testable standard describing the minimum evidence required for a traceable lot.

Profiles may include:

- Core Lot Identity;
- Purchase & Cost Evidence;
- Processing Chain;
- Production Consumption;
- Finished-Goods Linkage;
- Export/Partner Handoff.

Each profile declares:

- required fields;
- source class;
- validation rules;
- freshness/review rules;
- missing/conflicted states;
- export schema.

## Traceability Manifest — ADOPT

Generate for an exact lot/version:

- standard/profile version;
- subject lot;
- source purchase;
- document references/checksums where available;
- genealogy links;
- current balance;
- production links;
- validation result;
- unresolved conflicts;
- generated_at;
- manifest hash.

## Evidence classes — REQUIRED

Distinguish:

- user-entered;
- imported;
- ERP-observed;
- external document;
- partner-confirmed;
- third-party verified.

Never upgrade a self-declared fact into a verified claim automatically.

---

# Wave E — Partner APIs and Embedded Distribution

## Versioned Partner API — ADOPT

Potential interfaces:

- lot/passport read;
- purchase/import;
- stock/reservation;
- production issue/return;
- document status;
- shipment;
- traceability manifest verification;
- supplier/provider profile.

All endpoints remain organization-scoped.

## Integration targets — ADAPT

Priority connectors may include:

- 1C/accounting export-import;
- auction/supplier files;
- logistics documents;
- document storage;
- fashion PLM/production systems;
- client procurement portals.

Integration must use explicit idempotency, source identity and reconciliation.

## Embedded / OEM mode — CONDITIONAL

Offer FUR ERP capabilities as an embedded vertical module to ateliers, fur manufacturers or procurement companies while preserving:

- tenant isolation;
- canonical IDs;
- audit/evidence history;
- versioned contracts.

---

# Wave F — Verified Procurement Network and Marketplace

## Structured RFQ / availability exchange — ADOPT LATER

Once supplier identity and lot standards are stable:

`buyer requirement -> eligible suppliers -> structured offer -> evidence -> reservation -> purchase -> receipt -> actual outcome`

Offer fields can include:

- material;
- grade;
- color;
- quantity;
- location;
- price/currency;
- availability window;
- document set;
- lot/passport evidence.

## Marketplace economics — CONDITIONAL

Potential revenue:

- organization subscription;
- enterprise plan;
- supplier/provider subscription;
- verification/onboarding fee;
- transaction/service fee;
- API usage;
- document/evidence storage;
- benchmarking module.

Commercial incentives must never alter inventory, cost, reconciliation or evidence truth.

---

# Wave G — Data Network Effects

## Privacy-safe material benchmark network — CONDITIONAL

With explicit tenant policy and minimum cohorts, derive aggregated benchmarks such as:

- landed-cost bands;
- delivery lead-time bands;
- yield ranges;
- processing turnaround;
- document completeness rates;
- variance ranges.

No tenant's negotiated price, supplier relationship, client identity or product design may be exposed to another tenant.

## Contribution incentives — CONDITIONAL

Organizations that contribute eligible anonymised evidence may receive:

- better benchmark coverage;
- industry percentile ranges;
- earlier anomaly detection;
- supplier/process comparison bands.

Participation must be opt-in and contractually governed.

## Longitudinal network moat — ADOPT

The defensible graph becomes:

`source/provider -> lot -> documents -> processing -> production use -> finished item -> shipment -> reconciliation/outcome`

Each real transaction makes future planning, traceability and provider selection more useful.

---

# Wave H — Institutional Adoption and Ecosystem Lock-in

## Reference implementation — ADOPT

Publish a bounded reference implementation / sample dataset for the Traceability Standard that demonstrates:

- lot creation;
- split/merge genealogy;
- document linkage;
- processing step;
- production issue;
- finished-goods linkage;
- manifest generation.

The reference implementation must contain synthetic data only.

## Open specification boundary — ADOPT

Open enough of the data/manifest specification to allow external systems to interoperate.

Keep the following as value-added network services:

- hosted authority;
- verification registry;
- provider history;
- benchmark network;
- tenant workflows;
- marketplace;
- commercial connectors.

## Approved Provider Network — ADOPT

Create explicit qualification paths for:

- suppliers;
- processors/dressers;
- logistics partners;
- integrators;
- implementation partners.

Every status maps to machine-checkable requirements and review dates.

## Industry / consortium participation — CONDITIONAL

Where commercially useful, participate in working groups around:

- product/material traceability;
- digital product passports;
- structured trade documents;
- supply-chain data exchange.

Do not claim external standard status until formally obtained.

## Enterprise bundles — ADOPT

Potential bundles:

- Procurement + Lot Traceability;
- Production + Yield Control;
- Supplier Network + Verification;
- Enterprise API + Data Warehouse;
- Multi-company Group Control.

## Institutional publishing — CONDITIONAL

Allow approved external parties to publish scoped records into the ecosystem:

- provider identity;
- lot/source documentation;
- processing completion;
- logistics milestone;
- external certificate reference.

External publishing never bypasses source classification or tenant admission.

## Switching-cost mechanics — ADOPT

The durable switching cost should come from legitimate accumulated value:

- lot genealogy;
- cost/economic history;
- document reconciliation;
- production-yield history;
- supplier/provider evidence;
- manifests;
- integrations;
- audit trail.

Avoid artificial lock-in through proprietary file hostage or non-exportability.

---

# Wave I — Decision Intelligence

## Procurement decision cockpit — ADOPT

For a planned need show:

- required quantity;
- on-hand eligible lots;
- reserved/committed quantity;
- inbound;
- expected shortage;
- cost range;
- supplier options;
- lead time;
- evidence quality;
- unresolved conflicts.

## Scenario comparison — ADOPT

Examples:

- supplier A vs B;
- auction vs direct purchase;
- buy now vs use existing stock;
- one large lot vs several smaller lots;
- processing route A vs B.

Every result must expose formulas and assumptions.

## AI usage — ADAPT

AI may help with:

- document extraction;
- entity matching;
- anomaly explanation;
- semantic search;
- narrative summaries.

AI must not be the authority for stock, payments, cost, traceability status or compliance claims.

---

# 4. Acceptance principles

1. Tenant isolation is non-negotiable.
2. Every network/trust dimension resolves to canonical facts and a period.
3. Cost snapshots used by closed/consumed history are never silently rewritten.
4. Traceability claims identify source class and unresolved gaps.
5. External certificates remain source-attributed and expiry-aware.
6. New suppliers/providers are not penalised solely for lack of history.
7. Marketplace economics cannot mutate operational truth.
8. Cross-tenant analytics require explicit governance and privacy thresholds.
9. Every exported manifest binds to an exact version/hash.
10. AI suggestions remain separate from authoritative business facts.

# 5. Recommended implementation order

`authority hardening -> lot genealogy -> traceability passport -> yield ledger -> provider passports -> manifest/verification -> APIs -> benchmark network -> RFQ/marketplace -> institutional adoption`

The first commercially meaningful moat is **Lot Passport + genealogy + yield evidence**. Build that before a broad marketplace.


# Wave J — Productization and Production-grade Execution

The next development phase should convert the strategic network plan into a product that can be demonstrated, piloted and sold.

## J1. Canonical Lot Genealogy Data Model — P0

Introduce explicit entities/relations for:

- lot parent/child lineage;
- transformation type;
- quantity before/after;
- source document/evidence;
- actor;
- timestamp;
- reason;
- immutable lineage event.

Acceptance:

- split/merge can be reconstructed;
- no negative quantity;
- genealogy never crosses tenant boundary;
- historical lineage remains readable after corrections.

## J2. Traceability Passport Read Model — P0

Build a deterministic passport projection from current purchase/lot/movement/production data plus genealogy.

Required views:

- lot identity;
- source;
- current balance;
- movement timeline;
- processing;
- production consumption;
- linked finished goods;
- documents;
- conflicts/gaps.

## J3. Yield Ledger — P0

For completed production, calculate and store/reproduce:

`issued - returned = consumed`

and derive:

`yield = finished quantity / consumed quantity`

Only when units/measurement are compatible.

Show:

- numerator;
- denominator;
- formula;
- source rows;
- confidence/eligibility.

## J4. Provider Passport v1 — P1

Start with factual history from existing suppliers and later processors/logistics.

Do not launch public ranking.

## J5. Traceability Manifest v1 — P1

Generate signed/hashable JSON for an exact passport version.

## J6. Executive / Investor Route — P1

Create a 7–10 minute route:

`purchase -> lot -> genealogy -> production use -> yield -> finished item -> provider history -> traceability manifest -> network opportunity`

The route must visibly distinguish live product capability from roadmap concepts.

## J7. Pilot Economics — P1

For a real pilot define:

- onboarding effort;
- lots digitized;
- document completeness;
- reconciliation issues found;
- time saved;
- yield/waste visibility gained;
- stock accuracy;
- provider comparison coverage.

No ROI claim without measured baseline.

**Immediate sequencing:** J1 -> J2 -> J3 -> J5 -> J6, then provider/network features.
