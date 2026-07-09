# Brief 99: Seed the 22 HIEX Interventions into Live Bridgewater — The Report Closer

**Grounding:** Code's read-only structure investigation (this session) — the `INTERVENTIONS` report data, the persisted intervention/cost-plan shapes, and the shape-adapter mapping below. Canonical cost/metric method: "Design note: HIEX intervention modelling methods + report metrics" (NZA-Sim product page).
**Purpose:** get all 22 interventions — costed, classified, comparable — into the LIVE Bridgewater project's Library so the report can be written from the tool, not just the export.

## BEFORE DOING ANYTHING
1. Confirm receipt: quote the Goal + the five pinned decisions.
2. Branch `chris/seed-hiex-interventions` off main (PRs #10 merged — confirm; if not, STOP).
3. Land this brief at `docs/briefs/active/99_seed_hiex_interventions.md` as Part 1's first commit.
4. Read CLAUDE.md, STATUS.md, the design note, and the `INTERVENTIONS` report source.
5. **Engine untouched.** No `instantCalc.js`, no assembler, no `derive_systems_for_sim` changes. `--fixture` anchors 132.6 / 126.0 byte-identical at start and close. This brief only writes Library data to one live project.

## Goal
All 22 HIEX interventions exist as Library items on the LIVE Bridgewater project, each with: its patches (real physics for Class A/B), its cost plan in the new groups shape (reconciled to the report central total), a class/flag (simulated / derived / off-model / enabling), and enough metadata that the isolated + strategy views compute the four report metrics. Chris can open any intervention, see its cost build-up in the pop-out, and watch the strategy respond.

## The five pinned decisions (do not deviate)
1. **schema_version:** read one EXISTING live Bridgewater intervention, stamp the seeded 22 with the SAME version. Do not invent or assume — match what's live.
2. **The report's single ~40% on_cost → the 5 on_costs fields:** put the whole blended figure in ONE bucket (contingency_pct, or the nearest single field), leave the other four null. Do NOT split one blended number into five fabricated percentages — the report already computed on-costs into its totals; this is a summary figure, not five real NRM2 rates. The seeded plan's computed total must still reconcile to the report central ±1%.
3. **Cost shape:** write the NEW groups shape (groups → lines → on_costs), NOT the headline shape. Skips migration; lands in the Brief 97 pop-out editor.
4. **Replace, not append:** the 8 existing live interventions are a hand-built test set; the 22 are the real report set. FIRST export/snapshot the existing 8 to `docs/report/pre_seed_bridgewater_library_backup.json` (so nothing is lost, reversible), THEN replace the Library with the 22.
5. **Write path:** use the API PUT/write endpoint (validation, hashing, side-effects apply). Direct-sqlite ONLY as a documented fallback if no write endpoint exists.

## The shape adapter (report-shape → persisted-shape)
Apply per intervention:
- `name` → `label`
- `ref` → `notes` (and/or a theme tag); persisted has no `ref` field — preserve it in notes so the report cross-references.
- add `id: 'int_<uuid>'`, `enabled: true`, `capex_gbp` (from cost central), `schema_version` (per decision 1)
- `patches:[{op,path,value}]` → `patches:[{id:'patch_<uuid>', source:'inline', op, path, value}]` — **paths reuse as-is** (they already match the v40 selector format)
- `cost.lines:[{desc,qty,unit,rate}]` → `cost.groups:[{id, name, nrm2_category, collapsed:false, lines:[{id, name:desc, quantity:qty, unit, rate, notes}]}]`
- `cost.on_cost_pct` → `on_costs` per decision 2

## Class handling (all 22 seeded, honestly flagged)
- **Class A (10) — real patches:** 1.1, 1.4, 2.1, 2.2, 2.3, 3.3, 3.4, 3.5, 4.2, 5.2. Patches applied; engine simulates; flag `simulated`.
- **Class B (4) — derived scalar patches:** 1.2 WWHR (DHW demand ×0.82), 1.3 (+0.4 COP preheat), 3.1 (commissioning central), 3.2 (VRF −20%). Patch present; flag `derived`; the assumption basis string (from the design note) goes in `notes`.
- **Class C (3) — off-model:** 1.5 interlink, 3.2 refrigerant, 7.1 PV. **Capex present; NO engine patch that fakes a simulated saving.** Flag `off_model`; notes = "energy/carbon effect calculated off-model — see report, [basis]". PV explicitly: EUI unchanged (CRREM gross-demand rule).
- **Class D (5) — enabling:** 4.1, 4.3, 5.1, 5.3, 6.1. Capex only; no energy claim; flag `enabling`.

## Parts

### P1 — Land brief + snapshot the existing Library
1. Land brief. Read one live intervention → capture the schema_version and confirm the persisted shape matches Code's investigation.
2. Export the 8 existing Bridgewater interventions to `docs/report/pre_seed_bridgewater_library_backup.json`.
3. Commit: `Brief 99 P1: brief landed + live Library snapshot backed up`.
**Falsifiable:** backup file exists with the 8 interventions; schema_version captured and quoted.

### P2 — The adapter + a single reference intervention
1. Write the report→persisted adapter (a script/function) implementing the mapping above.
2. Seed ONE intervention end-to-end as the reference: **1.4 DHW ASHP** (Class A, has a real NRM cost plan ~£105k). Write via the API path. Verify it round-trips: opens in the Library, cost pop-out shows the groups/lines, total reconciles to the report central ±1%, patches present.
3. Commit: `Brief 99 P2: adapter + 1.4 DHW ASHP reference intervention seeded + verified`.
**Falsifiable (ZZ TEST or live, read-back):** 1.4 exists, cost total matches report ±1%, patches applied, schema_version correct.

### P3 — Seed all 22
1. Run the adapter over all 22, replacing the Library (the 8 are backed up). Apply class handling: A/B patches present, C off-model (capex only, no faked patch), D enabling.
2. Reconciliation pass: each of the 22's persisted cost total vs the report central, ±1%. Any miss → STOP-and-write for that item, continue others.
3. Commit: `Brief 99 P3: all 22 HIEX interventions seeded (totals reconciled)`.
**Falsifiable:** `docs/report/99_seed_reconciliation.md` — 22 rows, report central vs persisted total vs Δ, all ≤1% (or STOP-noted); class flags correct per the table above.

### P4 — Verify the views compute + close
1. Load live Bridgewater: Library isolated view renders all 22 with metrics; build the phasing-spine strategy; confirm the four metrics (EUI Δ, lifetime tCO₂e, £/tCO₂e, payback) compute and the cumulative spine lands near the report's EUI 74.8 (Class C/D handled correctly — off-model don't move EUI, enabling carry cost only).
2. Confirm the EP validate panel still functions (Class A mappable items runnable).
3. `--fixture` anchors byte-identical. STATUS, archive brief, current.md, push, PR open — NOT merged.
4. Commit: `Brief 99 P4: views verified, spine reconciles, closed`.
**Falsifiable:** screenshot/read-back of the 22 in the Library with metrics; cumulative spine EUI within a stated tolerance of the report's 74.8; anchors intact.

## MUST NOT
Engine/assembler/derive changes · fake a simulated saving for Class C off-model items · split the blended on-cost into 5 fabricated rates · append onto the existing 8 without backing them up first · invent a schema_version · seed with unreconciled cost totals · merge unattended.

## Escalate (stop-and-write)
No API write endpoint exists (document, use sqlite fallback with a flag) · a cost total won't reconcile ±1% (name the item) · the persisted shape differs from Code's investigation (re-map, don't force) · schema_version ambiguous (which version do the live 8 carry?) · seeding a Class C off-model item would require a patch that fakes a saving.

## Independent review (mandatory — live-data write + cost correctness)
Claude Chat reads on GitHub: the adapter mapping, the reconciliation table (22 ≤1%), the class-flag correctness (esp. Class C carry no faked patch), the backup existence, and anchor invariance. Builder doesn't grade itself.

## Close
Archive · STATUS · current.md · PR open · Chris walkthrough on LIVE Bridgewater: the 22 in the Library, open 1.4's cost pop-out, build the spine strategy, confirm the four metrics + cumulative EUI. Then the report is written from the tool + the export.
