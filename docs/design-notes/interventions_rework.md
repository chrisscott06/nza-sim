# NZA-Sim Interventions Module — Rework Design Note

*Markdown only. Internal. Audience: Chris, Will, Imi, Claude Chat, Claude Code.*

**Date:** June 2026
**Status:** Design locked. All open questions resolved. Briefs A, B, C now writable from this note.
**Lineage:** Supersedes the per-intervention "six-tab" structure (Waterfall, Isolated, Before, After, Heat Balance Calc, Trail Breakdown). Builds on the existing interventions architecture design note (Brief 41) — declarative-patches model stays as-is. This rework is a UX restructure + new cost/lifetime-carbon data models on top of an unchanged engine.

---

## Why we're reworking

The interventions module works engine-side. Brief 41's declarative-patches model is sound. Brief 71's marginal/cumulative attribution is sound. Brief 76's vent fix gives interventions an honest hourly physics base. The framework executes correctly.

What doesn't work is the **product layer on top of it**:

1. **Six tabs per intervention, several overlapping.** Waterfall, Isolated, Before, After, Heat Balance Calc, Trail Breakdown. Three of these (Before, After, Heat Balance) are showing too much detail at the per-intervention level — the user doesn't need to debug an intervention's physics, they need to know what the intervention saved. Waterfall is a stack-level question, not a per-intervention question.

2. **Authoring conflates with strategy.** Every authored intervention is automatically in the stack, ordered. Can't say "here are ten interventions I'm exploring" without committing them to a sequence. Order is forced at authoring time, which is wrong — order is a strategy concern.

3. **No cost layer.** The tool says what an intervention does to energy and carbon, but not what it costs or whether it's worth doing. £ per tonne CO₂ saved and simple payback are missing. Intervention ranking is one-dimensional.

4. **No lifetime carbon view.** Annual operational saving × intervention lifetime is interesting, but the right number for a net-zero strategy is **cumulative operational carbon saved by 2050 against the CRREM decarbonisation trajectory**. Same currency on every intervention; directly comparable on the dimension that matters for net-zero claims.

The rework addresses all four together because they share data and they want to be one design conversation. Implementation splits into three briefs (A: UX scaffolding; B: cost model; C: CRREM lifetime carbon) but the design is unified.

---

## What the reworked module looks like

### Two pages

**Page 1 — Interventions Library.** A catalogue of named interventions. Each one is fully specified: inputs (what changes), isolated impact (what it does alone). No order. No interaction between interventions. Multiple can exist that compete or duplicate. This is the *what's possible* page.

**Page 2 — Strategy.** One named, ordered selection from the Library. Order matters because interventions interact (fabric before heat pump means the pump runs in lower demand). Drag-and-drop reorder. Single strategy per project for v1. This is the *what we're proposing* page.

Engine work needed for this split: **near zero.** The interventions engine already produces both standalone (Isolated) and stacked (Cumulative) results. The split is a UX rearrangement plus a "strategy" data object that holds an ordered selection.

---

### Per-intervention view (lives on the Library page)

**Two sections, not six tabs.** Scrollable single page per intervention.

#### Section 1 — Isolated impact (default, leads the page)

The headline. What does this intervention do, alone, against the bare baseline?

**Four cards across the top:**

| Card | What it shows | Source |
|---|---|---|
| **Lifetime carbon saved** | Cumulative operational CO₂ saved 2025→2050 against the CRREM grid-decarbonisation trajectory, in tonnes CO₂e | Brief C |
| **£ per tonne CO₂ saved** | Total intervention cost ÷ lifetime carbon saved. The cost-effectiveness number. | Brief B + C |
| **kWh saved / EUI Δ** | Annual energy saved (MWh/yr); EUI delta (kWh/m²·yr) | Brief A (engine isolated output) |
| **Simple payback** | Total cost ÷ annual operational saving (£/yr). Years. | Brief B |

In Brief A the cost and CRREM cards are visible placeholders ("TBD — Brief B/C"). Brief B and Brief C populate them.

**Below the cards — demand-by-service deltas:**

- Heating demand Δ (MWh/yr, and % vs baseline)
- Cooling demand Δ
- DHW demand Δ
- Total annual energy Δ
- Fuel splits Δ (electricity vs gas)
- Annual operational carbon Δ (year-1 only here — full lifetime trajectory is the lifetime-saved card)

All from existing engine Isolated output. No new engine work in Brief A.

#### Section 2 — Calc Trail

The engine math, in human-readable form. **Uses the engine. Not a parallel hand-calc.**

Captures the engine's *actual computation path* for this intervention. Walks: which inputs the patch changed → which engine fields re-evaluated → resulting headline output. Same engine, same code path that drives Section 1 — narrated.

**Shows only fields that changed.** Default is focused, not comprehensive. If the user wants the full engine state, they can use the Building module's Heat Balance/Energy Flows views. The Calc Trail is for "why does this intervention save X?" not "what is the building doing in total?"

Implementation note (in the brief): if implementing this requires a real "trace mode" in the engine (~50+ lines of engine work), prefer a UI-side diff between pre- and post-intervention engine outputs, showing only fields with non-zero delta. UI-side diff avoids engine changes.

**That's it. Two sections per intervention.**

#### What's removed from per-intervention view

- **Heat Balance** — too much detail for per-intervention authoring. Moved to Strategy view (Chris explicit decision). The user can already see the building's heat balance in the Building module; an intervention-level heat balance was duplicating that without adding insight.
- **Before / After** — these were reference snapshots that the Heat Balance and Calc Trail views were supposed to *contain*, not separate tabs. Calc Trail covers the diff narratively.
- **Waterfall** — stack-level question, not per-intervention. Moved to Strategy view.
- **Trail Breakdown** — was duplicating Calc Trail. Consolidated.

---

### Strategy view (lives on the Strategy page)

A named container holding an ordered list of interventions selected from the Library. Single strategy per project for v1.

#### Stack composition

The ordered list, **drag-and-drop reorderable**. Each row shows:
- Intervention name + theme indicator (Brief 71)
- Marginal contribution within this strategy's order (different from Isolated impact — order matters)
- Toggle / disable
- Delete affordance
- Drag handle

Add interventions: button opens a picker showing the Library, grouped by theme. Selecting one adds it to the bottom of the strategy.

#### Visualisations on the Strategy page

Four views of the strategy's composed state:

**1. Waterfall** — cumulative attribution. Each intervention's marginal contribution stacked to show how the strategy gets from baseline to final state. This is what the old Waterfall tab did, but at the strategy level where it belongs.

**2. Final Energy Flows (Sankey)** — final delivered energy by service by fuel. The headline result chart. Reuses the existing Sankey component from the Building module, fed with the strategy's final-state engine output.

**3. Heat Balance — final state, with expand-to-compare option** —
   - Default view: single Heat Balance chart showing the strategy's final state.
   - **Compare button**: expands a side-by-side baseline-vs-final view. Same chart type, same scale. Lets the user see exactly where the strategy has shifted the energy balance.
   - This is the only Heat Balance in the interventions module. Per Chris: "we can always go back to the other tab to compare" if needed, but the side-by-side here covers most cases.

**4. CRREM trajectory chart** — strategy's actual operational carbon trajectory against the CRREM target curve, out to 2050. The Big Picture chart for the report. (Brief C populates; Brief A shows the placeholder frame.)

#### Strategy headline

Numbers shown prominently:
- Final EUI (kWh/m²·yr)
- Total annual energy saved
- Lifetime carbon saved by 2050 (tonnes CO₂e) — Brief C
- Total strategy capex (£) — Brief B
- £ per tonne CO₂ saved (strategy-level cost-effectiveness) — Brief B + C
- Simple payback at strategy level — Brief B
- Strategy headline year (when does this strategy hit CRREM target, if at all) — Brief C

---

## The CRREM lifetime carbon methodology

Locked here because it's load-bearing for Brief C and needs to be unambiguous.

### Principle

**Lifetime carbon saved = cumulative annual operational carbon savings across the analysis period, with each year's emissions computed against that year's fuel-specific carbon factor.**

The CRREM grid-decarbonisation pathway decarbonises electricity year-by-year from 2025 to 2050; gas stays roughly constant. An intervention that saves electricity is worth fewer tCO₂e in 2050 than in 2025 (cleaner grid by then); an intervention that saves gas is worth roughly the same in both years.

### The fuel-switching case (worked example)

This is the case Chris raised explicitly and the brief needs to be unambiguous on.

If an intervention shifts a building from gas to electricity (e.g. boiler → heat pump):

- **Baseline annual gas use** is replaced by **post-intervention annual electricity use** (with COP/efficiency baked in to the engine's output).
- The intervention's annual carbon impact in year *y* is:
  - `Δ_y = (baseline_gas_kWh × gas_factor_y) − (post_electricity_kWh × electricity_factor_y)`
- The lifetime carbon saved is:
  - `Σ Δ_y for y = 2025 to 2050` (or to the end of the intervention's lifetime, whichever is shorter)

In words: lifetime carbon saved is the lifetime emissions of the displaced gas use minus the lifetime emissions of the new electricity use, computed year-by-year because the electricity factor falls over the period.

If the electricity factor in 2025 is e.g. 0.20 kgCO₂/kWh and falls to 0.05 by 2050 (CRREM trajectory), and gas stays at e.g. 0.18 kgCO₂/kWh: a heat pump retrofit that switches 100 MWh/yr of gas to ~30 MWh/yr of electricity (COP ~3.3) saves:
- Year 2025: (100,000 × 0.18) − (30,000 × 0.20) = 18,000 − 6,000 = 12,000 kgCO₂e
- Year 2050: (100,000 × 0.18) − (30,000 × 0.05) = 18,000 − 1,500 = 16,500 kgCO₂e
- Cumulative 2025-2050: sum of all 26 years' deltas with electricity factor on a linear (or CRREM-specified) decarbonisation curve.

This is the methodology. Brief C implements it.

### The non-fuel-switching case

Simpler. An intervention that just reduces existing electricity use (LED retrofit, lighting controls, fan efficiency) saves:
- `Δ_y = baseline_electricity_saved_kWh × electricity_factor_y`
- Worth less each year as the grid decarbonises.

An intervention that reduces existing gas use (boiler upgrade, fabric insulation in a gas-heated building) saves:
- `Δ_y = baseline_gas_saved_kWh × gas_factor_y`
- Roughly constant each year.

A fabric insulation intervention on a gas-heated building saves a lot of lifetime carbon up-front but the saving doesn't grow over time. A heat pump retrofit's saving grows as the grid decarbonises. **Both are visible in the lifetime carbon card** — the rank order of interventions can change depending on what's being decarbonised.

### Per-intervention inputs

- **Intervention lifetime** (years, default = standard for that type — heat pump 15-20yr, fabric insulation 40-50yr, LED 10-15yr)
- **Optional**: replacement cycle if shorter than analysis horizon

### CRREM trajectory source

If Claude Code has the CRREM dataset for the relevant project typology and region (UK hotel, UK office, etc.), use it directly. If not, **use a flat-rate placeholder** (state the rate used in the audit doc) and Chris will share the proper CRREM data later. Brief C should be implementable either way — the data layer is swap-able. **This is per Chris's explicit instruction (June 2026).**

---

## The cost data model (Brief B — NRM2-aligned)

Based on the Applemore Feasibility Cost Plan structure (RICS NRM2). Standard UK QS practice. Output is in a format a professional QS recognises and can audit.

### Headline mode (six cost lines per intervention)

Mirrors the "Summary Interventions" sheet in the Applemore file:

1. Design and engineering costs (70% of consultant fee budget)
2. Main equipment costs (rate × quantity supply)
3. Installation and commissioning
4. Additional measures (distribution, emitters, BWIC, MEP prelims)
5. Project delivery (30% of consultant fee budget)
6. Contingency (risk + inflation)

→ **TOTAL**

User enters £ per line directly, or sets project-level defaults (design fees as % of works, contingency %, inflation %) and the system computes.

### Detailed mode (full NRM2 elemental)

For interventions that need proper costing. Mirrors the "ElementalCP" sheet pattern:

- **0 Facilitating works** (strip-out, decommissioning, hazardous materials)
- **1 Substructure**
- **2 Superstructure** (frame, upper floors, roof, stairs, external walls, windows/external doors, internal walls, internal doors)
- **3 Internal finishes** (wall, floor, ceiling)
- **4 Fittings and furnishings**
- **5 Services** (sanitary, services equipment, disposal, water, heat source, space heating/AC, ventilation, electrical, fuel, lift/conveyor, fire/lightning, comms/security/control, specialist, BWIC)
- **6 Prefabricated buildings and building units**
- **7 Works to existing buildings**
- **8 External works**

Each line: element name, quantity, unit, rate, sub-total. Sums to **Total Building Works**.

Then on-costs:
- **9** Main contractor's preliminaries
- **10** Main contractor's overheads and profit
- **11** Design fees (consultants)
- **12** Other development / project costs
- **13** Risks (design dev, construction, employer change, employer other)
- **14** Inflation (tender + construction)

= **Total Estimated Construction Cost**

User picks the depth per intervention — quick benchmark for fabric upgrades, full NRM2 for major systems retrofit.

### Default rate library

Seeded from the Applemore spreadsheet's actual rates. Expandable from BCIS or similar industry data later. User can override per-project.

---

## What stays as-is from the current module

- **The engine.** State 2/State 3 dispatch, hourly loop, per-system ventilation, Brief 76 fix, marginal/cumulative attribution — unchanged. The rework is the product layer on top.
- **Declarative patches as the interventions model** (Brief 41). Each intervention is a patch description applied to the building config. Library entries are patches with metadata (cost rows, lifetime, name, theme). Strategy holds an ordered list of intervention IDs.
- **Themes / categorisation** (Brief 71). Useful for both Library navigation and Strategy picker.
- **Engine performance**. No new engine modes. Cost and lifetime carbon are data layers consumed by the UI, not new engine passes.

---

## Implementation: three briefs

### Brief A — UX rework (this brief, drafted as `brief_A_interventions_ux_rework.md`)

The UX restructure. Library/Strategy split. Two-section per-intervention view. Drag-and-drop reorder. Heat Balance on Strategy view only with expand-to-compare. CRREM and cost cards as placeholders.

No engine changes. No new data model beyond the Strategy container.

### Brief B — Cost model (NRM2)

Adds the NRM2-aligned cost data structure to each Library entry. Both modes (headline 6-row and detailed elemental). Default rate library seeded from the Applemore spreadsheet. Populates the £ per tonne, capex, simple payback cards. Strategy-level total capex.

### Brief C — Lifetime carbon (CRREM)

Adds the CRREM trajectory model. Per-intervention lifetime carbon computed against decarbonisation curve using the methodology above (fuel-switching aware). Populates the Lifetime Carbon card on per-intervention Isolated view and the CRREM trajectory chart on Strategy view. Strategy-level lifetime carbon total.

### Recommended order: A → C → B

UX first because it shapes everything else. CRREM next because it's the more impactful net-zero metric and has a cleaner data model (one trajectory applied uniformly). Cost last because it's the most surface-area work (rate library, NRM2 build-up UI, two modes).

---

## Open questions — all resolved (June 2026)

1. **Heat Balance view style.** ~~Side-by-side Sankeys / stacked bars / delta bar chart?~~ **DECISION**: Heat Balance is removed from per-intervention view entirely. Lives on Strategy view only, showing the strategy's final state. Compare button expands to side-by-side baseline-vs-final.
2. **Calc Trail depth.** ~~Focused or comprehensive?~~ **DECISION**: Only fields that changed. Focused.
3. **Strategy ordering UX.** ~~Drag-and-drop or numbered slots?~~ **DECISION**: Drag-and-drop reorder.
4. **Multi-strategy comparison.** ~~v1 or future?~~ **DECISION**: Single strategy for v1. Multi-strategy is a future enhancement.
5. **CRREM data source.** ~~Official paid dataset or hand-curated?~~ **DECISION**: Claude Code likely has the CRREM dataset already. If not, use a flat-rate placeholder in Brief C and Chris will share the proper data later. Brief C is implementable either way.
6. **Default cost rate library.** ~~Applemore + BCIS?~~ **DECISION**: Seeded from the Applemore spreadsheet's actual rates initially. Expandable later.

---

## Decision log

**June 2026 (round 1):** Chris confirms two-page split (Library / Strategy). Confirms three-section per-intervention view (Isolated / Heat Balance / Calc Trail). Confirms NRM2 cost model based on Applemore. Confirms lifetime carbon via CRREM (not embodied carbon — defer EC). Confirms three briefs A/B/C.

**June 2026 (round 2):** Chris removes Heat Balance from per-intervention view. Heat Balance lives on Strategy view only with expand-to-compare. Confirms Calc Trail uses the engine and shows only changed fields. Confirms drag-and-drop on Strategy. Confirms single strategy for v1. CRREM data source: Code likely has it, otherwise flat rate placeholder + Chris shares later. Default rate library from Applemore confirmed. All six open questions locked. CRREM methodology made explicit (fuel-switching: lifetime gas emissions avoided minus lifetime electricity emissions added, computed year-by-year as grid decarbonises). Brief A now writable.

*Next step: Brief A goes to Claude Code on a new feature branch (`chris/interventions-rework-ux`). Brief C drafted after Brief A closes. Brief B drafted after Brief C closes.*
