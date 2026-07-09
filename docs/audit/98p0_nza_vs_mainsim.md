# Brief 98 P0 — NZA-Sim vs Main-Sim EnergyPlus: baseline characterisation

**Deliverable of Brief 98 P0.** Read-only characterisation; zero engine code changed.
Design notes (canonical): *"NZA-Sim vs EnergyPlus — whole-building comparison on the
Results page"* + *"Reference: methodological differences & manual overrides"* (Notion,
NZA-Sim product page). Bible rule: specifics with citation and magnitude, or silence.

## 🚩 Headline finding (P0 escalation)

**The main `/api/simulate` EnergyPlus cannot produce a baseline result for this building.
It fatals at input processing, before the simulation runs.** The residual table this brief
set out to build **cannot be produced** — you cannot diff NZA-Sim against an EnergyPlus run
that never completes. **The Results-page NZA-vs-EnergyPlus comparison (the full Brief 98) is
blocked on a prerequisite fix.**

Cause, fully evidenced:

- `nza_engine/generators/hvac_heating_boiler.py` (lines 5, 81, 116) emits the object type
  **`ZoneHVAC:Baseboard:Convective:Gas`** for a `gas_boiler_heating` system.
- **That object does not exist in the EnergyPlus 25.2.0 schema.** Verified against
  `/Applications/EnergyPlus-25-2-0/Energy+.schema.epJSON`: the valid siblings are
  `ZoneHVAC:Baseboard:Convective:Water` and `ZoneHVAC:Baseboard:Convective:Electric` —
  there is **no `:Gas` convective baseboard** in EnergyPlus (gas baseboards aren't an EP object).
- EnergyPlus rejects it: `<root>[ZoneHVAC:EquipmentList][Floor_1_EquipList][equipment][0]
  [zone_equipment_object_type] - "ZoneHVAC:Baseboard:Convective:Gas" - Failed to match against
  any enum values.` → **1 Fatal, 1 Severe, program terminated in 0.02 s before simulation.**
- The building is configured `systems_config.hvac_type = "gas_boiler_heating"`,
  `space_heating.primary.system = "gas_boiler_heating"` — so every gas-heated project hits this.
- **Not a fluke of my harness:** the project's own simulation history carries the identical
  `1 fatal, 1 severe` errors (runs of 2026-04-03). The last *complete* run (2026-06-25, 13.2 s)
  predates the current gas-heating config / was a different heating system.

This is out of scope to fix here (P0 measures; MUST NOT change either engine). The fix — emit a
valid EP heating object for gas (e.g. `ZoneHVAC:Baseboard:Convective:Water` on a hot-water loop
fed by a `Boiler:HotWater`, or `Coil:Heating:Fuel` on an air loop) — is a deliberate change that
should be its **own brief, before** the Results comparison.

## Method & provenance

| | NZA-Sim (Static / instant) | Main EnergyPlus (`/api/simulate`, `nza_engine`) |
|---|---|---|
| Engine call | `calculateInstant` via `scripts/_brief93_anchor.mjs --fixture=report_baseline_v1.yaml` | `assemble_epjson` → `run_simulation` → `sql_parser`, engine-direct on the fixture (`scripts/_brief98_mainsim.py`) |
| Building | `validation/fixtures/report_baseline_v1.yaml` (clean baseline, aux + interventions removed) | same fixture |
| EP version | n/a | **EnergyPlus 25.2.0** (`/Applications/EnergyPlus-25-2-0`, confirmed `--version` 25.2.0-cf7368216c) |
| Result | ✅ ran | ❌ **FATAL** (see above) |

**Config bridges attempted (documented, not faked):**
- **systems_config:** the fixture carries `building_config.systems_config_v40` (rich, NZA-Sim) but
  not the simple `systems_config` the main sim reads. Bridged verbatim from the live source
  project `12cf7cc4` (report_baseline_v1 derives from it; the aux/intervention removals don't touch
  systems). *This bridge worked* — the failure is downstream, in the heating generator.
- **constructions:** `construction_choices` reference project-library names (`bridgwater_*`). These
  were **not** the failure point — EnergyPlus got past construction processing and died on the
  ZoneHVAC equipment list. (Whether `bridgwater_*` resolve to the intended U-values vs an
  `nza_engine` fallback is a *separate* question, un-testable until the sim runs — flagged for the
  fix brief.)

## NZA-Sim baseline breakdown (the one side we could produce)

`report_baseline_v1`, GIA 4216 m², comfort band 21/24 °C:

| Metric | NZA-Sim |
|---|---|
| EUI | **126.0** kWh/m²·yr |
| Electricity | 373.8 MWh |
| Gas | 157.4 MWh |
| Heating demand | 87.7 MWh |
| Cooling demand | 101.1 MWh |
| DHW demand | 257.3 MWh |

Per-element envelope losses (kWh/yr): external wall 23,654 · roof 12,563 · ground floor 10,850 ·
glazing 88,931 · **thermal bridging 24,006** · fabric leakage (infiltration) 30,623 ·
**permanent vents 18,912** · mech-ventilation 277,214. (These match the reference note's documented
NZA-Sim figures exactly — thermal bridging 24.0, permanent vents 18.9, infiltration 30.6,
mech-vent 277.2 MWh — so the NZA-Sim side is sound.)

## The residual table — BLOCKED

**Not produced.** There is no main-EP baseline to diff against (fatal). Producing a table with an
empty or fabricated EP column would violate the brief's "no agreement claim without a magnitude"
rule. The table is deferred until the main sim runs.

## The 0.5 ACH infiltration gap — partially quantified

Still worth stating from the config, even without the EP run: NZA-Sim books **30.6 MWh** of
infiltration loss from the q50-rated envelope (effective, wind-driven). The main sim's
`epjson_assembler.py:74` default is a **flat 0.5 ACH** and it does **not read q50** — so its
infiltration is a fixed rate independent of the project's airtightness. Direction and MWh magnitude
of that gap can only be closed once the sim runs (needs the EP infiltration figure). Flagged, not
faked.

## What this means for the Results page

- **Everything is blocked** until the main sim can produce a baseline for a gas-heated building.
  No tab (Overview / Energy & Carbon / Sankey / Fabric / Heat Balance) can show "engines agree"
  because there is no EnergyPlus result to compare.
- The good news uncovered en route: the main sim's `sql_parser` **already extracts** annual +
  monthly end-use, envelope heat flow, and fuel split — so once it runs, the Sankey / fabric /
  energy-carbon comparisons are largely an *overlay*, not a rebuild (a useful correction to the
  design note).

## Recommendation (Chris decides)

The main-EP gas-heating generator bug is a **hard prerequisite**. Recommend a small dedicated brief
to fix `hvac_heating_boiler.py` to emit a valid EP heating object (hot-water baseboard + boiler, or
fuel heating coil), verified by a clean baseline run on report_baseline_v1, **before** Brief 98's
Results UI or even its residual table. Attempting the comparison first would mean building a
credibility feature on an engine that doesn't run — the exact dishonesty P0 was written to prevent.

## Sources

- `.err`: `data/simulations/brief98_mainsim_report_baseline/*.err` (fatal object rejection).
- `/Applications/EnergyPlus-25-2-0/Energy+.schema.epJSON` — no `ZoneHVAC:Baseboard:Convective:Gas`.
- `nza_engine/generators/hvac_heating_boiler.py:5,81,116` — emits the invalid object.
- `scripts/_brief98_mainsim.py` (run harness) · `scripts/_brief93_anchor.mjs` (NZA-Sim side).
- Project `12cf7cc4` simulation history — 2026-04-03 `1 fatal, 1 severe` runs (same signature).
