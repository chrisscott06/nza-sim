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
