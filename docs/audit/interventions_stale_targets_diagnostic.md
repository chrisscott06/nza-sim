# Audit — Interventions calc-trail: stale absolute targets vs the Model-1 baseline

**Type:** read-only diagnostic. No code or data changed. **Date:** 2026-07-14
**Project:** Bridgewater Hotel (`12cf7cc4-9bdc-41bc-ab4e-24e044fbad9d`), live Model-1 pinned baseline.
**Purpose:** feed the future fix brief (relative-delta measures + re-reference to Model-2). This note is the complete re-author list.

---

## Summary

The interventions calc-trail composes **correctly** against a **correct** live baseline (isolated baseline reproduces EUI **119.2 / 502.558 MWh** — the pinned Model-1 scenario). The defect is entirely in the **measure targets**: every patch in the stack is an absolute `op:"set"` frozen at a value authored against the **pre-D1** config. D1 then moved the live baseline *past* several of those targets, so measures that were improvements now compute as penalties.

**Inventory headline:** all **25 patches across all 13 populated measures are `op:"set"` (absolute). There is not a single relative/derived/scale patch in the entire stack.** The patch engine (`interventionsEngine.applyPatch`) has no relative op — `set` writes the literal value at the path, so a frozen target cannot track a shifting baseline.

Reproduction: each measure's isolated delta (measure alone vs untouched baseline, the calc-trail "Impact" path via `useIsolatedResults` → `runInterventionStack` singleton) was reproduced with `calculateInstant` full-mode + the real `applyIntervention`, all within ±0.03 MWh of the UI figures.

---

## Complete absolute-`set` inventory (the re-author list)

`W/(L·s⁻¹)` = SFP units. Live values are the pinned Model-1 baseline. "Class D" = drift-prone (references a physical baseline D1 changed, or Model-2 will change); "Class S" = structural/other absolute (still frozen, re-reference when relevant).

| idx | id | Measure | Patch path → value (absolute) | Live Model-1 | Direction now | Class |
|---|---|---|---|---|---|---|
| 0 | 1_1 | Reduce DHW demand (low-flow) | `dhw_demand_litres_per_person_per_day = 44.3` | **48.2** | reduction (−3.9) but fights the gas-anchor | **D** |
| 1 | 1_2 | Waste-water heat recovery | `dhw_demand_litres_per_person_per_day = 45.1` | **48.2** | reduction (−3.1); WWHR modelled as a demand cut proxy | **D** |
| 2 | 1_3 | Exhaust-air ASHP (COP uplift) | `dhw[1].efficiency_metric = 3.4` | **3.4** | **no-op** (already 3.4) | **D** |
| 2 | 1_3 | " | `heating[id=…VRF].efficiency_metric = 3.0` | **5.0** | **VRF SCOP 5.0→3.0** — mis-targeted onto space heating | **D + mis-authored** |
| 3 | 1_4 | Larger ASHP → full DHW off gas | `dhw[0].share_pct = 0`, `dhw[1].share_pct = 100` | 75 / 25 | structural fuel switch | S |
| 3 | 1_4 | " | `dhw[1].efficiency_metric = 2.9` | **3.4** | ASHP COP **3.4→2.9** (drags COP down) | **D** |
| 5 | 2_1 | MVHR on bedroom extract | `ventilation[1].efficiency_metric = {sfp 1.8, rec 80%}` | sfp **0.4**, rec **0** | fan power ↑, recovery added (no bypass) | **D + no-bypass** |
| 5 | 2_1 | " | `heating[1].share_pct = 0`, `heating[0].share_pct = 100` | 4 / 96 | structural (drop panel heater) | S |
| 6 | 2_2 | Reduce fan duty | `ventilation[1].flow_rate = 1590` | **2208** | flow cut (−28%) | **D** |
| 6 | 2_2 | " | `ventilation[1].efficiency_metric.sfp_w_per_lps = 0.47` | **0.40** | SFP **worse** (0.40→0.47) | **D** |
| 8 | 3_1 | VRF commissioning | `heating[0].efficiency_metric = 3.4` · `cooling[0] = 3.4` | **5.0 / 3.5** | both **below live** → penalty | **D** |
| 9 | 3_2 | VRF replacement (R-32) | `heating[0].efficiency_metric = 3.75` · `cooling[0] = 3.75` | **5.0 / 3.5** | heat below (penalty), cool above (gain) | **D** |
| 10 | 3_3 | Setpoint optimisation | `heating_setpoint_mode=custom, _c = 20` · `cooling_setpoint_mode=custom, _c = 25` | follow-comfort **21 / 24** | genuine relaxation vs 21/24; drifts if the band is re-referenced | **D (setpoint)** |
| 11 | 3_4 | Glazing g-value (solar film) | `constructions.glazing = "double_low_e"` | `bridgwater_glazing` | construction swap to a generic library glazing — may not represent solar film's g-only change | S |
| 12 | 3_5 | Brise soleil | `shading_overhang.south = {depth 0.5}` · `.west = {depth 0.5}` | 0 / 0 | genuine physical addition | S |
| 14 | 4_2 | Keycard/occupancy shut-off | `gains.equipment.profiles[0].baseload.value = 3.78` | **2.0** | **+89% INCREASE** (was −25% vs pre-D1 5.04) | **D (worst)** |
| 17 | 5_2 | Communal lighting + controls | `gains.lighting.profiles[0].magnitude.value = 1.7` | **2.5** | reduction (−0.8); direction still correct (D1 left lighting at 2.5) | **D (latent)** |

**Class D (must re-author / re-reference — 10 measures):** 1_1, 1_2, 1_3, 1_4, 2_1, 2_2, 3_1, 3_2, 3_3, 4_2, 5_2.
**Class S (structural absolutes — review on re-reference — 4 patch groups):** 1_4 & 2_1 share reallocations, 3_4 glazing swap, 3_5 shading.

### Empty measures (0 patches — a separate problem)

Nine measures carry **no patches** — they contribute nothing to the trail. Most are intentional off-model / enabling stubs, but two matter for the diagnosis:

- **`int_hiex_2_3` "Heat-recovery bypass setpoint" (idx 7) — empty.** This is exactly the summer bypass that would claw back MVHR's +33 MWh cooling penalty (see below). Its absence is why the no-bypass penalty is unmitigated.
- **`int_hiex_1_5` "Interlinked heat recovery VRF→DHW" (idx 4) — empty.**
- Others (expected stubs): 4_1 room monitoring, 4_3 equipment-at-replacement, 5_1 kitchen review, 5_3 sub-metering, 5_4 communal vent run-hours, 6_1 BMS realignment, 7_1 Solar PV (off-model).

---

## Diagnosed six (verified decompositions)

Baseline: EUI 119.2, elec 294.959, gas 207.599; heating_elec 14.454 (dem 62.3, SCOP_eff 4.31), cooling_elec 32.086 (dem 112.3), dhw_elec 19.165, dhw_gas 207.599, fans 25.949, lighting 55.578, small_power 147.727.

| Measure | Isolated Δ (repro) | Decomposition |
|---|---:|---|
| Exhaust-air ASHP (1_3) | **+7.97** | heating +7.97 only (VRF SCOP 5.0→3.0, SCOP_eff 4.31→2.78). dhw patch is a no-op. |
| VRF commissioning (3_1) | **+6.57** | heating +5.63 (5.0→3.4) + cooling +0.94 (3.5→3.4) |
| VRF replacement (3_2) | **+1.85** | heating +3.99 (5.0→3.75 penalty) − cooling 2.14 (3.5→3.75 gain) |
| Fan duty (2_2) | **+0.27** | fans −1.19; cutting bedroom-extract flow: heating −7.56 / cooling +9.03 (lost free-cooling) → net +0.27 |
| MVHR (2_1) | **+46.05** | fans +27.08 (SFP) + no-bypass recovery +18.98 (heat −14.36 / cool +33.34) |
| Keycard (4_2) | **+70.26** | small_power +65.74 + cooling +9.88 − heating 5.36 |

### Keycard — exact composition path (−25% plug load → +70.3 MWh)

Single patch `op:"set"  gains.equipment.profiles[0].baseload.value = 3.78`.
1. `applyPatch` writes 3.78 **absolutely**. The "−25%" is computed nowhere — it only ever existed relative to the old 5.04 W/m² baseload.
2. Live `profiles[0]` ("Small Power") = **2.0 W/m²**; `profiles[1]` ("BOH & Kitchen") = 2.0 W/m², **untouched**.
3. small power 2.0 → 3.78 = +1.78 W/m² × 4,215 m² × 8,760 h = **+65.74 MWh**.
4. Extra internal gain shifts demand: cooling dem +34.6 → **+9.88** MWh; heating dem −23.1 → **−5.36** MWh.
5. Net **+70.26**. **Not a sign/composition bug** — the composition faithfully applies a stale absolute (3.78) that sits above the current baseline (2.0), so a "shut-off" measure raises load 89%.

### MVHR — genuine no-bypass result, not an artefact

Controlled decomposition (components isolated; they sum exactly, A = B + C):

| Component | Δ total MWh | Detail |
|---|---:|---|
| B: SFP 0.4→1.8 only (recovery off) | **+27.08** | pure fan power on the 2,208 L/s bedroom flow (SFP 1.8 is a stale, high absolute) |
| C: recovery 80% only (SFP unchanged) | **+18.98** | heating −14.36 (dem −61.9, capped by ~62 MWh total heating) / cooling **+33.34** (dem **+116.7**) |
| A: full patch | **+46.06** | = B + C |

The +33 MWh cooling is the **no-bypass** signature: 80% sensible recovery runs year-round, adding heat to the supply air through the cooling season on a hotel that is mostly rejecting internal-gain heat at a 24 °C setpoint. Cooling penalty > winter heating benefit, so recovery alone is net +19. Genuine engine physics, unmitigated because the companion bypass measure (`int_hiex_2_3`) is empty.

---

## Root cause (one sentence)

Measures declare **absolute** targets referenced to the pre-D1 config; D1 raised the baseline's efficiencies (VRF SCOP 2.8→5.0, SEER →3.5, SFP 0.9→0.4) and changed DHW demand (38→48.2) and equipment (5.04→2.0) above/below those frozen targets, so the frozen absolutes now read as penalties — plus two mis-authored patches (1_3 editing the space-heating VRF; the empty 2_3 bypass stub).

## For the fix brief (not done here)

The fix is a separate brief: convert Class-D measures to **relative deltas** (e.g. "improve SCOP by ×1.1" / "reduce plug density by 25%") or re-reference targets to the **Model-2** baseline, populate the empty companion measures (esp. 2_3 bypass), and correct the 1_3 mis-target. This note is the complete inventory to work from.
