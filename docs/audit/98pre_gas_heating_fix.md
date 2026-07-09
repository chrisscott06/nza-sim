# Brief 98-pre — Fix main-sim gas heating: audit

Unblock the main `/api/simulate` EnergyPlus baseline (Brief 98 P0 finding,
`docs/audit/98p0_nza_vs_mainsim.md`). EnergyPlus generator only — NZA-Sim's
`instantCalc.js` is not touched. `--fixture` anchors: report_baseline_v1 126.0 /
bridgewater_anchor_v2 132.6, byte-identical at start and close.

## P1 — Heating config investigation: gas vs VRF

**Finding: Bridgewater's space heating is VRF (electric, ambient-air heat pump), NOT
gas. The main sim's `systems_config.hvac_type = "gas_boiler_heating"` is a stale/wrong
default that contradicts both the NZA-Sim truth and the HIEX plant spec.**

Three cited sources agree the plant is VRF heating + gas DHW-only:

1. **HIEX plant spec** (`docs/report/HIEX_Intervention_Spec_and_Cost_Benchmarks.md`):
   "VRF ~320 kW cooling (10 condensers, SHRM 3-pipe heat recovery confirmed)"; "DHW gas
   134.8 MWh/yr … existing DHW ASHP 21.1 kW". Interventions 3.1 (VRF metering) and 3.2
   (VRF replacement, Toshiba 10HP condensers, R-410A→R-32) treat **heating as VRF**; gas
   appears only as **DHW** (Andrews-type calorifiers). No gas space heating anywhere.

2. **NZA-Sim rich config** — `report_baseline_v1.yaml` → `building_config.systems_config_v40.heating[0]`:
   `label: "Primary heating (vrf_heat_recovery_dual_function)"`, `source: ambient_air`,
   `efficiency_metric: 3` (SCOP ≈ 3), `share_pct: 95`. **This is what NZA-Sim runs** — VRF,
   matching HIEX. (NZA-Sim's 126.0 baseline is a VRF-heated building.)

3. **Main sim's simple `systems_config`** (project `12cf7cc4`, what `/api/simulate` reads):
   `hvac_type: "gas_boiler_heating"`, `space_heating.primary.system: "gas_boiler_heating"`.
   **Wrong** — disagrees with (1) and (2). This is the input that made `assemble_epjson`
   dispatch to `hvac_heating_boiler.py` and emit the invalid `ZoneHVAC:Baseboard:Convective:Gas`.

**Root cause of the two-layer failure:**
- **Config layer:** the simple `systems_config` (main-sim input) drifted out of sync with the
  `systems_config_v40` (NZA-Sim input). The v40 was set to VRF; the simple copy still said gas.
  A migration/sync gap — the two systems representations aren't kept consistent.
- **Generator layer:** even where gas heating is genuine, `hvac_heating_boiler.py` emits an EP
  object type that doesn't exist (`:Gas`), so it would fatal regardless.

**Decision (per brief Decision 2): fix both.**
- **Correct the config** so `report_baseline_v1`'s main-sim heating routes through **VRF**
  (matching the v40 truth + HIEX) — so the EP baseline is like-for-like with NZA-Sim's
  VRF-heated 126.0, not a fictional gas-heated building.
- **Fix the generator** so `ZoneHVAC:Baseboard:Convective:Water` + `Boiler:HotWater` (or a fuel
  heating coil) is emitted for buildings that genuinely use gas space heating.

Without the config fix, "unblocking" the sim would just produce a *gas-heated* EP baseline to
compare against a *VRF-heated* NZA-Sim — apples to oranges. Both fixes are required.

## P2 — The two fixes

### Fix 1 (generator, unconditional): valid EP gas-heating object

`nza_engine/generators/hvac_heating_boiler.py` rewritten. The invalid
`ZoneHVAC:Baseboard:Convective:Gas` is replaced by a per-zone **`ZoneHVAC:UnitHeater`**
driven by a **`Coil:Heating:Fuel`** (`fuel_type: NaturalGas`) + a `Fan:ConstantVolume`.
All three object types are present in `Energy+.schema.epJSON` 25.2.0 (verified). Gas
fuel accounting is exact (Σ zone fuel-coil input / burner efficiency); the only physics
delta vs the old *intent* is a small supply-fan electricity term (warm-air unit heater
vs a wet baseboard — the wet alternative needs a `Boiler:HotWater` plant loop nza_engine
has no scaffolding for). Also **clamps `burner_efficiency ≤ 1.0`** (defaults to 0.92 if a
COP/SCOP is mistakenly routed in — the exact gas/VRF mislabelling P1 found). The old name
`generate_gas_baseboard_system` is kept as an alias, so the assembler import is unchanged.

**Verified:** the invalid-object fatal is gone. Error progression on a forced gas config —
invalid object → (fixed) → efficiency > 1 → (fixed) → node topology (below) — proves the
object itself now validates and processes.

### Fix 2 (config): report_baseline heating → VRF

Per P1, Bridgewater's heating is VRF, not gas. The fixture `report_baseline_v1.yaml` now
carries a corrected simple `systems_config` (`space_heating`/`space_cooling` = `vrf_standard`,
SCOP 3 / EER 4.6 — matching `systems_config_v40` + HIEX; DHW/ventilation carried from source).
The main sim now dispatches to the (valid, already-working) VRF generator. This makes the EP
baseline like-for-like with NZA-Sim's VRF-heated 126.0 — not a fictional gas building.

### 🚩 Second issue surfaced (documented per brief escalation — needs its own fix)

Fixing the invalid object **unmasked a deeper, pre-existing problem** the earlier fatal hid:
for the **gas-heating + VRF-cooling combination** in one zone, the VRF terminal unit's air
inlet node (`{zone}_TU_Inlet`) is not reconciled with the zone-exhaust node the gas unit
heater claims (`{zone}_UH_Inlet`) → `ZoneHVAC:TerminalUnit:VariableRefrigerantFlow … air inlet
node name must be the same as a zone inlet or exhaust node name` (1 fatal / 7 severe). Two zone
air systems need a shared zone-exhaust *NodeList*, which `add_vrf_cooling_to_baseboard` doesn't
build. Compounded by cooling being read from a *third* config source (`systems_config_v25.cooling.enabled`),
independent of `space_cooling.primary.system`. **This does not affect report_baseline (VRF-heated)
or this brief's goal**, and it's a rarer case (genuinely gas-heated building *with* VRF cooling).
Flagged for a follow-up fix; not chased here (3-strikes discipline; the brief's "second fatal →
document, may need its own fix").

**Also flagged (deeper data-consistency bug, out of scope):** the simple `systems_config` drifts
from `systems_config_v40` — on Bridgewater it was stale on *both* heating (gas vs VRF) and cooling
(none vs VRF). The main `/api/simulate` reads the stale simple copy; NZA-Sim reads v40. Every
project whose v40 has been edited risks the same drift. The real fix is to derive/sync the simple
`systems_config` from v40 (or have the main sim read v40) — its own brief.

## P3 — Clean main-EP baseline on report_baseline_v1

`scripts/_brief98pre_mainsim.py`, EnergyPlus **25.2.0**, VRF heating/cooling: **0 fatal, 0 severe,
2.8 s.** ✅ The EP column Brief 98 P0 was blocked on now exists (`docs/audit/98pre_mainsim_baseline.json`):

| Metric | Main EP (VRF) |
|---|---|
| EUI (space-only, excl. DHW) | 60.5 kWh/m² |
| Annual heating | 229.6 MWh |
| Annual cooling | 11.8 MWh |
| Lighting | 15.7 MWh · Equipment | 39.6 MWh |
| Fuel split | elec 179.3 MWh (70.3 %) / gas 75.6 MWh (29.7 %) |
| Peaks | heating 33.4 W/m² · cooling 17.5 W/m² · unmet hours 0 |

**Not analysed here** (that's Brief 98 P0's resumed residual table): note EP heating 229.6 MWh vs
NZA-Sim 87.7 MWh is a large gap — the 0.5 ACH infiltration default (P0 flag) is a prime suspect,
plus constructions and thermal mass. P0 characterises it from first principles; this brief only
proves the run is clean.

**Brief 98 P0 can now resume** — the residual table has a running EP baseline to diff against.
EP version 25.2.0 confirmed. `--fixture` anchors byte-identical (132.6 / 126.0); NZA-Sim untouched.
