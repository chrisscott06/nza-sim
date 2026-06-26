# Brief B design note — NRM2 cost model (populates Brief A's £ placeholders)

*Markdown only. Internal. Audience: Chris, Will, Imi, Claude Chat, Claude Code.*

**Date:** June 2026
**Status:** Design locked. Brief B writable from this note.
**Lineage:** Final brief in the interventions module rework sequence (A → C → B). Brief A landed UX scaffolding with placeholder cards. Brief C populated Lifetime Carbon and the CRREM stranding diagram. Brief B populates the £ side: cost per intervention, simple payback, £ per tonne CO₂ saved, and strategy capex.

---

## What Brief B does

Three things:

1. **Per-intervention cost build-up** in NRM2-aligned structure (RICS New Rules of Measurement, 2nd edition — UK construction industry standard). Two authoring modes: **Headline** (6 lines, fast benchmark) and **Detailed** (full elemental build-up, proper costing).
2. **Populates Brief A's remaining placeholders**: £ per tonne CO₂ saved (combining Brief C's tCO₂e with Brief B's £), Simple payback (£ ÷ annual operational saving), Strategy capex (sum across enabled interventions).
3. **Default rate library** seeded from the Applemore Leisure Centre Feasibility Cost Plan spreadsheet. User can override per-project; library expandable from BCIS or similar industry data in future briefs.

Once Brief B closes, every intervention has both a defensible cost number and a defensible lifetime-carbon number, in formats a professional QS recognises. The strategy can be reported with full capex + carbon + payback at headline level. **This completes the metrics layer of the interventions module rework.**

## The NRM2 structure

Based directly on the Applemore Feasibility Cost Plan you've uploaded — that's the QS structure your team works with, so any cost output is in a format they already recognise and can audit.

### Headline mode (six cost lines)

Mirrors the "Summary Interventions" sheet in Applemore. Fast benchmark for interventions that don't need full elemental build-up:

| Line | What it captures | Typical default |
|---|---|---|
| 1 | Design and engineering costs | 70% of consultant fee budget |
| 2 | Main equipment costs | Direct supply cost (rate × quantity) |
| 3 | Installation and commissioning | Labour + commissioning |
| 4 | Additional measures (distribution, emitters, BWIC, MEP prelims) | Variable; sometimes nil |
| 5 | Project delivery | 30% of consultant fee budget |
| 6 | Contingency (risk + inflation) | Project default % applied to subtotal |

**→ TOTAL**

User enters £ values directly per line, OR sets project-level defaults (e.g. "design fees 12% of works, contingency 15%, inflation 5%") and the system computes Lines 1, 5, 6 from Lines 2-4.

### Detailed mode (full NRM2 elemental build-up)

For interventions that need proper costing — major systems retrofit, complex fabric work, anything the QS would normally cost line-by-line. Mirrors the "ElementalCP" sheet pattern in Applemore.

**Building Works (Σ 0-8):**
- **0** Facilitating works (strip-out, decommissioning, hazardous materials, temporary works)
- **1** Substructure
- **2** Superstructure (frame / upper floors / roof / stairs / external walls / windows + external doors / internal walls / internal doors)
- **3** Internal finishes (wall / floor / ceiling finishes)
- **4** Fittings, furnishings and equipment
- **5** Services (sanitary installations / services equipment / disposal / water / heat source / space heating + air conditioning / ventilation / electrical / fuel / lift + conveyor / fire + lightning protection / comms + security + control / specialist installations / BWIC)
- **6** Prefabricated buildings and building units
- **7** Works to existing buildings
- **8** External works

→ **Total Building Works**

**On-costs (added to Building Works):**
- **9** Main contractor's preliminaries
- **10** Main contractor's overheads and profit
- **11** Design fees (consultants)
- **12** Other development / project costs
- **13** Risks (design dev / construction / employer change / employer other)
- **14** Inflation (tender + construction)

→ **Total Estimated Construction Cost**

Each element line: name, quantity, unit, rate (£), subtotal. Element groups roll up to category subtotals; categories roll up to Total Building Works; on-costs apply on top.

**User picks the depth per intervention.** Quick benchmark for LED retrofits and small power changes. Full NRM2 for heat pump replacement, AHU swap, complex fabric retrofit.

## The rate library

### Seeded from Applemore

Code reads the Applemore spreadsheet's rates and structure to seed the default library:

- **Per intervention type** (heat pump, MVHR, LED, glazing upgrade, wall insulation, etc.): default headline rate + detailed elemental breakdown if available in Applemore.
- **Per element / per unit**: rates lifted from Applemore's elemental sheets (£/m² wall insulation, £/kW heat pump capacity, £/luminaire LED, etc.).
- **Project-level defaults**: design fees %, prelims %, OHP %, contingency %, inflation % — read from Applemore's on-costs section.

The user can override any rate per-project. The library is the starting point, not a constraint.

### Library extension (future)

For v1, library expansion is out of scope — Applemore-seeded rates are the v1 floor. Future briefs can:
- Add BCIS-sourced rates as an alternative library
- Add per-region adjustment factors
- Add temporal escalation (rates by year, indexed to construction inflation)
- Add user-contributed rate libraries shared across projects

For v1, the user's escape hatch is direct override on any line. Good enough.

## Connection to Brief A's placeholder cards

Brief A's per-intervention Isolated view has four headline cards across the top:

| Card | Source |
|---|---|
| Lifetime carbon saved | Brief C (populated) |
| £ per tonne CO₂ | **Brief B** (this brief) — `total_cost / lifetime_tCO2e` |
| kWh saved / EUI Δ | Brief A (engine isolated output, live) |
| Simple payback | **Brief B** — `total_cost / annual_operational_saving_£` |

Annual operational saving needs:
- Annual kWh saved per fuel (from engine isolated output)
- Energy prices per fuel (project-level default, e.g. UK 2026: electricity £0.30/kWh, gas £0.08/kWh — user-overridable)

These are simple multiplications once the cost layer lands. The Simple payback card is meaningful in years; clamped to 999 years for "never pays back" cases (e.g. fabric retrofit on a low-energy-use building) with a "no payback within lifetime" qualifier.

## Strategy capex

Strategy view's headline numbers expand with Brief B's data:

- **Total strategy capex** (sum across all enabled interventions)
- **Strategy-level £ per tonne CO₂** (`total_capex / total_lifetime_carbon_saved`)
- **Strategy simple payback** (`total_capex / total_annual_operational_saving_£`)
- **Capex profile** (future — by year if interventions phased; v1 sums to year-1 total)

The CRREM stranding diagram (Brief C) shows the carbon story. The strategy capex shows the cost story. Together they let a client say "this strategy gets us to CRREM target by 2032, costs £X, pays back in Y years, saves Z tonnes lifetime carbon."

## What stays as-is

- **The engine.** No changes to `instantCalc.js`, `interventionsEngine.js`, `systemsEngine.js`.
- **Brief A's UX scaffolding.** Library/Strategy split, two-section per-intervention view, drag-and-drop, Heat Balance compare — all untouched.
- **Brief C's CRREM stranding diagram and lifetime carbon math.** Brief B reads Brief C's outputs (lifetime tCO₂e) but doesn't change them.
- **Bible Rule 11.** Canonical reads extend to rate library, energy prices, and cost totals: one canonical helper per quantity, all consumers go through the helper.

## What's deliberately out of scope

- **Multi-region pricing** (BCIS regional factors). v1 UK national average rates only.
- **Temporal escalation** (annual price indexation). v1 static rates.
- **Capex profiling across years.** v1 assumes year-1 deployment.
- **NPV / discounted cashflow analysis.** Simple payback only for v1. Discount-rate-aware metrics are a future enhancement.
- **Lifecycle cost analysis** (operational cost over lifetime). v1 surfaces annual operational saving; lifetime operational saving is straightforward extension if needed but not in v1.
- **User-contributed rate libraries** (sharing rates across projects). v1 per-project only.
- **Detailed mode for every intervention type.** v1 seeds detailed templates for the major intervention types (heat pump, MVHR, fabric insulation, glazing); other types use headline mode only until a future brief adds elemental templates.
- **Cost confidence indicators** (high / medium / low). v1 single-number costs; confidence framing is a future enhancement.

## Decision log

**26 June 2026:** Chris confirms Brief B scope. NRM2 alignment is non-negotiable — output must read like a QS-authored estimate to a real QS. Applemore-seeded rate library, two authoring modes (headline 6-row + detailed elemental), £ per tonne CO₂ combines Brief B's £ with Brief C's tCO₂e, Simple payback uses energy prices stored at project level with user override. Strategy capex is sum across enabled interventions. Multi-region, temporal escalation, capex profiling, NPV, lifecycle cost all explicitly deferred.

*Brief B is the last in the interventions rework sequence. After it closes, the metrics layer is complete: every intervention carries energy, carbon, cost, payback. The strategy carries the full picture for a client deliverable. Subsequent work moves to engine improvements (DHW-occupancy audit, full Bridgewater EnergyPlus integration) and product expansion (complex geometry, multi-zone) per the NZA-Sim roadmap.*
