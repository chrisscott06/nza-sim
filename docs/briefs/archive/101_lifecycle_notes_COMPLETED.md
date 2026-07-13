# Brief 101 — Lifecycle £/tonne + assumption notes (report audit trail)

Small brief, two parts, one branch off main, **engine untouched** (`instantCalc.js` / assembler
not modified — this is cost-model + data + export only). Re-export the live Bridgewater XLSX at
the end. **Module scope:** Interventions module — cost/metric derivation + the intervention data
model's optional notes + the Library XLSX export. No envelope/systems/engine physics touched;
`capex_gbp`/patches unchanged. Within scope per CLAUDE.md Interventions scope (costs are the
Roadmap-facing layer; interventions carry optional cost/notes fields).

## Part 1 — lifecycle £/tonne (supersedes the earlier life-cap instruction)

Lifetime **carbon** stays integrated to 2050 with year-by-year grid factors (verified correct —
DHW ASHP horizon 2025–2049, 680 tCO₂e). **Fix £/tonne to use LIFECYCLE capex:**

- lifecycle capex = initial capex + replacements, where a replacement is charged each time the
  **measure life** (controls/settings 10y · plant 15y · PV 25y · fabric 30y) expires before 2050.
- replacements = `floor((2050 − 2025) / measure_life)` = `floor(25 / life)` → life 10→2, 15→1,
  25→1, ≥26→0 (matches "life ≥26y unchanged").
- replacement cost = flat **70% of initial capex**. **Stated basis:** replacement excludes the
  one-off elements (strip-outs, supply upgrades, builder's work, design) which the cost plans
  show are ~30% of a typical build-up.
- `lifecycle_capex = initial × (1 + 0.70 × replacements)`. **Only £/tonne uses it** — the Capex
  column and payback keep initial capex.

Measure life per intervention seeded from the design-note categories (source
`scripts/report/interventions.py` `life`). **Verify:** DHW ASHP (1.4, plant 15) £/t rises
~£155 → ~£264 (1 replacement, ×1.70) — toward the £280–300 target; fabric measures (life ≥26,
e.g. 3.4/3.5 glazing/shading at 30y) unchanged.

## Part 2 — assumption notes (the audit trail)

Add a per-intervention **`assumption_notes`** field, two labelled sections **ENERGY BASIS** and
**COST BASIS**, auto-drafted for all 22 from sources already in the repo
(`scripts/report/interventions.py` `assumption` / `basis` / `cost.tier` / `on_cost_pct` /
`confidence`):

- ENERGY BASIS: the design-note method (e.g. WWHR = shower 65% × HX 45% × config 0.6 → DHW −18%).
- COST BASIS: HIEX benchmark tier — all-in rate (tier a/b, no separate on-costs) vs NRM build-up
  (tier c, ~40% on-costs = prelims + OH&P + design + contingency); measure-life category; the
  repex rule where it applies.
- Rules: no invented sources — where a basis is an assumption say "assumption:" explicitly. The
  **four L-flag** measures (1.2 WWHR, 1.3 exhaust-air-over-ASHP, 1.5 VRF→DHW interlink, 2.1 MVHR)
  must say **allowance-only, pending survey**. **PV (7.1)** must state the CRREM gross-demand rule
  (carbon saving, EUI unchanged). One–two sentences per section, every number traceable.

Then: `assumption_notes` editable in the intervention editor (plain textarea), included in the XLSX
export as a dedicated **Assumptions** sheet (ENERGY / COST columns per measure). Re-export
`Bridgewater_Hotel_interventions.xlsx` and hand back the file. **Verify** three notes against their
sources: WWHR (1.2), DHW ASHP (1.4), interlink (1.5).

## Deliverables
- P1: cost model lifecycle-capex £/tonne + measure_life seed (commit).
- P2: assumption_notes seed + editor textarea + Assumptions XLSX sheet (commit).
- Close: re-exported xlsx handed back, STATUS, PR open — NOT merged.
