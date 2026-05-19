# Audit 39 — Calculation Flow Map

**Author:** Claude Code (executor)
**Status:** Read-only audit. Drives the scope of Brief 39.
**Date:** 2026-05-19
**Companion doc:** [`docs/audit/39_state2_permanent_vent_diagnosis.md`](39_state2_permanent_vent_diagnosis.md) — the perm-vent trigger case that motivated this broader audit. This document extends that single-term diagnosis to a full map of how envelope physics, internal gains, and systems calculations flow through the engine.

---

## Executive summary

The Static engine has **five** top-level calculator paths in `frontend/src/utils/instantCalc.js`. Four are named functions; one is anonymous code inside the `calculateInstant` dispatcher (the legacy 'full' fallback). All five are reachable in production:

| # | Path | File:line | Reached by |
| --- | --- | --- | --- |
| 1 | `_calculateEnvelopeOnly` (State 1) | 716 | `mode === 'envelope-only'` |
| 2 | `_calculateState2` (State 2) | 2173 | `mode === 'envelope-gains'` |
| 3 | `_calculateState3` (State 3 v2.5) | 3812 | `mode === 'full'` AND (engine='v2.5' OR v25 config+library present) |
| 4 | **Inline legacy 'full'** | dispatcher 5087+ | `mode === 'full'` (default) without v2.5 config/library; ALSO `mode === 'envelope-gains-operation'` falls through |
| 5 | `calculateInstantDegreeDay` | 4387 | No `weatherData` or `hourlySolar` available |

**This exceeds the audit brief's 4-calculator escalation threshold** (§"When to escalate"). The audit completed because the read-only inspection was already safe and the findings are useful regardless, but the inline-legacy path's archival status is a prerequisite decision for Brief 39 — see Section 5.

The architectural pattern is **C (hybrid)**:
- States 1 and 2 are **intentional parallel reimplementations** of envelope physics. Brief 28c (2026-05-14) deliberately gave State 2 its own loss accumulators against the gains-warmed `T_op` trace, rather than inheriting from State 1.
- State 3 is **pure cascade** on State 2. It calls `_calculateState2` and consumes its demand outputs; no envelope reimpl.
- Inline legacy 'full' is an **independent third envelope path**, predating Brief 28f Part 5.6/5.7's v2.5 split. Same physical model as Brief 27-era State 2 but never received Brief 28c, 33, 34, or other downstream sweeps.
- Degree-day is a **completely separate simplified model** (HDD-based, no hour loop, hardcoded `vent_ach = 0.5`).

**The perm-vent bug is one symptom of a broader pattern**: State 1 has the two-branch `flow_mode` dispatch (Brief 33/34), but State 2 and inline-legacy both carry deferred follow-up comments and never received the sweep. Other envelope terms appear unaffected because they use shared helpers (`computeThermalBridges`, `deriveOperationalACH`) — the bug class only catches the inline-coded ones.

---

## Section 1 — Call graph

### State 1 — `_calculateEnvelopeOnly(building, constructions, libraryData, weatherData, hourlySolar, comfortBand, tuning)`

Lines 716–1832. Inline envelope physics; no calls to other state calculators.

```
_calculateEnvelopeOnly
├── withMode(building, 'envelope-only')          [applied by dispatcher at 5036]
├── computeGeometry(building)                    line 248
├── synthesiseOperableOpeningsFromLegacy(...)    line 581
├── computeShadingFactors(building)              line 212
├── getUValue / getGValue / getConstructionItem  lines 490, 4329, 351
├── pickWholeWallU(item, model)                  line 708
├── buildWallModel / extractLayers (thermalMass.js, imported)
├── deriveOperationalACH(building, geo)          line 297   ★ shared with State 2
├── resolveFlowMode(openings)                    line 145
├── computeThermalBridges(building, geo, ...)    thermalBridges.js  ★ shared with State 2
├── HOUR LOOP 8760×:
│   ├── computeHourlyGains(...)                  line 2013  [State 2 only — see below]
│   ├── solAirT(...)                             thermalMass.js
│   ├── stepWallLinearized / combineLinearizedStep    thermalMass.js
│   ├── INLINE: permanent-vent flow              line 1075–1080  ★ TWO-BRANCH
│   │     if (flow_mode === 'single_sided') …
│   │     else { /* cross */ }
│   ├── INLINE: glazing inside-absorption gain   line 1107–1113
│   └── INLINE: zone-air implicit-Euler balance  line 1135–1160
├── INLINE: loss accumulators (free-running)     line 1206–1219
├── INLINE: loss accumulators (setpoint-conv.)   line 1222–1300 [Brief 28k Gate 1]
└── _buildHeatBalance({...})                     line 4920
```

### State 2 — `_calculateState2(building, constructions, libraryData, weatherData, hourlySolar, comfortBand)`

Lines 2173–3311. Calls State 1 for bailout detection (line 2175), **then independently re-runs the envelope hour loop** with internal gains added.

```
_calculateState2
├── _calculateEnvelopeOnly(...)                  line 2175  [bailout / structure only — see §3]
├── computeGeometry(building)                    [re-call]
├── synthesiseOperableOpeningsFromLegacy(...)    [re-call]
├── computeShadingFactors(building)              [re-call]
├── getUValue / getGValue / getConstructionItem  [re-call]
├── pickWholeWallU(...)                          [re-call]
├── deriveOperationalACH(building, geo)          line 2239  ★ shared helper (identical inputs as State 1)
├── INLINE: permanent-vent setup                 line 2242–2247  ✗ NO flow_mode dispatch
│     const cd_s2 = openings.cd ?? 0.25
│     const sqrtCw = Math.sqrt(Cw)
│     // (no resolveFlowMode call)
├── computeThermalBridges(...)                   ★ shared helper
├── HOUR LOOP 8760× (Brief 28c — gains-warmed T_op):
│   ├── computeHourlyGains(building, h, ...)     line 2013
│   ├── solAirT(...)                             [same]
│   ├── stepWallLinearized / combine             [same]
│   ├── INLINE: permanent-vent flow              line 2483  ✗ CROSS-FLOW ONLY
│   │     const Q_louvre = cd_s2 × A × √C_w × v_wind
│   ├── INLINE: glazing inside-absorption        [same shape as State 1]
│   └── INLINE: zone-air implicit-Euler balance  [same shape as State 1]
├── INLINE: loss accumulators (free-running, own T_air trace)   line 2553–2565
├── INLINE: loss accumulators (setpoint-conv., Gate 3)          line 2567+
└── INLINE: result assembly                       line 2910+
        gains:   spread state1Result.gains + State 2 people/lighting/equipment
        losses:  ENTIRELY NEW (Brief 28c — own T_op trace), shape mirrors State 1
        state1_delta: derived from state1Result.demand vs State 2's accumulators
```

### State 3 — `_calculateState3(building, constructions, libraryData, weatherData, hourlySolar, comfortBand)`

Lines 3812–4317. **Pure cascade on State 2.**

```
_calculateState3
├── _calculateState2(...)                                    line 3813  ★ CASCADE
│   └── if (state2Result.state !== 2) return state2Result    bailout
├── resolveAndValidateSystems(sys, libraryData)              line 3384
├── dhwKwhPerPersonHour(...)                                 line 3578
├── computeVentilationEnergy(ventSystems, ...)               line 3669
├── computeServiceEnergy(sys.heating, ...)                   line 3439  ★ shared
├── computeServiceEnergy(sys.cooling, ...)                   line 3439  ★ shared
├── computeDhwFuelMix(sys.dhw, ...)                          line 3491
│     └── fallback: computeServiceEnergy(sys.dhw, ...)
├── INLINE: per-fuel split aggregation                       line 3880–3900
├── INLINE: top-level fuel sums + carbon                     line 3909–3922
└── INLINE: result assembly (energy_use, system_performance, etc.)

NOTE: No envelope physics here. Whatever heating_demand_mwh /
      cooling_demand_mwh State 2 emitted is consumed verbatim.
```

### Inline legacy 'full' — anonymous code inside `calculateInstant`

Lines 5087–4882 (the dispatcher continues past the State 3 guard at 5079 if the v2.5 condition fails).

```
calculateInstant (after v2.5 guard fails):
├── computeGeometry(building)                    line 5087
├── getUValue × 4 + getGValue + computeShadingFactors  [same shared helpers]
├── (no deriveOperationalACH call — uses raw building.infiltration_ach ?? 0.5)
├── INLINE: permanent-vent setup                 line 5155–5164  ✗ NO flow_mode dispatch
│     // Brief 34: single building-wide C_d (cd_dd).
│     // (single_sided dispatch follow-up tracked with State 2).
├── (no computeThermalBridges call — TB absent in this path)
├── HOUR LOOP 8760×:
│   ├── (no gains computation via computeHourlyGains — uses hotelOccupancyFraction etc.)
│   ├── (no sol-air, no mass dynamics — UA × ΔT only)
│   ├── INLINE: permanent-vent flow              line 5213  ✗ CROSS-FLOW ONLY
│   │     const Q_louvre = cd_dd × A × √C_w × v_wind
│   └── INLINE: heating + cooling demand integration
├── INLINE: utilisation factor + heating/cooling totals
└── INLINE: systems-side fuel split (sysDefaults-based, NOT v2.5 templates)

NOTE: This path uses sysDefaults (line 67) for system efficiency, not the
      library-template path resolveSystemTemplate/templateEfficiency that
      State 3 uses. So the legacy 'full' is also a parallel SYSTEMS
      implementation, not just envelope.
```

### Degree-day — `calculateInstantDegreeDay(building, constructions, systems, libraryData)`

Lines 4387–4882. **Entirely separate simplified model.**

```
calculateInstantDegreeDay
├── computeGeometry(building)
├── getUValue × 4 + getGValue
├── INLINE: HDD-based fabric loss             Q = U × A × HDD × 24 / 1000
├── INLINE: infiltration (constant ACH = 0.5)  no q50, no deriveOperationalACH
├── INLINE: ventilation                       constant vent_ach = 0.5
├── INLINE: solar gains via orientation × g × shading factors (annual)
├── INLINE: occupancy via num_bedrooms × occupancy_rate × people_per_room
├── INLINE: internal gains via lpd × gia × HOTEL_OPERATING_HOURS etc.
├── INLINE: utilisation factor + heating demand
└── INLINE: systems-side (sysDefaults-based)

NOTE: No `openings.cd`, no `flow_mode`, no per-hour iteration. This is a
      different model entirely, used as a fallback when weather files
      aren't loaded.
```

### Dispatcher — `calculateInstant`

Line 5017. Selects between the five paths based on `options.mode`, `options.engine`, and the presence of `weatherData` / `hourlySolar` / `libraryData.system_templates`.

```
calculateInstant
├── if (!weatherData || !hourlySolar) → calculateInstantDegreeDay  (path 5)
├── if (mode === 'envelope-only')     → _calculateEnvelopeOnly     (path 1)
├── if (mode === 'envelope-gains')    → _calculateState2           (path 2)
├── if (mode === 'full' && v2.5 conditions) → _calculateState3     (path 3)
└── otherwise (incl. mode==='envelope-gains-operation', fall-through inline legacy)  (path 4)
```

---

## Section 2 — Term × calculator matrix

✓ = computed via the named shared helper (consistent across paths)
**inline-shared** = inline code following the same physics as another path
**inline-divergent** = inline code that differs from at least one other path
— = not computed by this path

| Term | State 1 | State 2 | State 3 | Inline legacy | Degree-day | Shared helper |
| --- | --- | --- | --- | --- | --- | --- |
| Geometry | ✓ | ✓ | (via S2) | ✓ | ✓ | `computeGeometry` (248) |
| U-values | ✓ | ✓ | (via S2) | ✓ | ✓ | `getUValue` (4329), `pickWholeWallU` (708) |
| g-value | ✓ | ✓ | (via S2) | ✓ | ✓ | `getGValue` (351) |
| Shading factors | ✓ | ✓ | (via S2) | ✓ | ✓ | `computeShadingFactors` (212) |
| Wall / roof / floor U×A conduction | inline-shared (1131–1133) | inline-shared (2507–2509) | (via S2) | inline-divergent (5202–5204; no mass, no sol-air) | inline-divergent (HDD-based) | NONE — formula consistent S1/S2 but reimplemented per state |
| Wall mass dynamics (multi-node) | inline (1124) | inline (2504) | (via S2) | — (no mass) | — (no hour loop) | `stepWallLinearized`, `combineLinearizedStep` (thermalMass.js) |
| Glazing U×A conduction | inline-shared (1150 / 2517) | inline-shared (2517) | (via S2) | inline-divergent (UA × dT only) | inline-divergent | — |
| Glazing solar transmission | inline (1107–1113) | inline (2487–2493) | (via S2) | inline-divergent | inline-divergent | — |
| Glazing inside-absorption | inline-shared (TUNE_GLAZ_INSIDE_ABS = 0.07) | inline-shared (same constant 0.07) | (via S2) | — | — | — |
| Sol-air boundary T | inline-shared (1052–1062) | inline-shared (2472–2480) | (via S2) | — | — | `solAirT` (thermalMass.js) |
| Solar/internal radiative ÷ convective split | inline-shared (TUNE_SOLAR_RAD_FRAC = 0.30) | inline-shared (same) | (via S2) | — | — | — |
| Internal-mass thermal capacitance | inline-shared (TUNE_INTERNAL_MASS_J_M2 = 250 000) | inline-shared (same constant) | (via S2) | — | — | — |
| Thermal bridging (H_TB) | ✓ (998) | ✓ (somewhere in 2200s) | (via S2) | **NOT COMPUTED** | **NOT COMPUTED** | `computeThermalBridges` (thermalBridges.js) |
| Infiltration (q50-derived ACH) | ✓ (844) | ✓ (2239) | (via S2) | **NOT COMPUTED** — uses `building.infiltration_ach ?? 0.5` directly | **NOT COMPUTED** — uses raw ACH 0.5 | `deriveOperationalACH` (297) |
| Permanent vents — formula | **inline-divergent — TWO-BRANCH** (1075–1080) | **inline-divergent — CROSS-FLOW ONLY** (2483) ✗ BUG | (via S2) — inherits S2's bug | **inline-divergent — CROSS-FLOW ONLY** (5213) ✗ BUG | (uses constant vent_ach instead) | NONE — and that's the root of the bug |
| Permanent vents — `openings.cd` honoured | ✓ (Brief 34) | ✓ (Brief 34) | (via S2) | ✓ (Brief 34) | — | — |
| Permanent vents — `flow_mode` honoured | ✓ | ✗ DEFERRED | (via S2) ✗ | ✗ DEFERRED | — | — |
| Operable openings | inline (Brief 28e) | inline (mirror of S1) | (via S2) | inline simplified | — | — |
| Internal gains (people, lighting, equipment) | — | ✓ (hour loop) | (via S2) | inline simplified (`hotel*Fraction` constants) | inline simplified | `computeHourlyGains` (2013) — State 2 only |
| Heating demand integration | inline | inline | (via S2) | inline | inline (HDD-based + utilisation factor) | — |
| Cooling demand integration | inline | inline | (via S2) | inline | inline (HDD-based) | — |
| Service energy (heating, cooling, DHW) | — | — | ✓ | inline-divergent (sysDefaults) | inline-divergent (sysDefaults) | `computeServiceEnergy` (3439), `computeDhwFuelMix` (3491) — State 3 only |
| Per-system primary/secondary perf | — | — | ✓ (Brief 38) | — | — | exposed on consumption.{service}.{primary,secondary} |
| Mech vent energy (fans + HRE) | — | — | ✓ | inline-divergent | inline-divergent | `computeVentilationEnergy` (3669) — State 3 only |
| Carbon factors | — | — | ✓ (BEIS) | inline (GRID_INTENSITY_2026) | inline (GRID_INTENSITY_2026) | — |
| Heat-balance assembly | ✓ (`_buildHeatBalance`) | inline (own assembly) | (via S2) | inline | inline | `_buildHeatBalance` (4920) — State 1 only |

### Reimplementation hotspots

Rows in the matrix where any path reimplements vs reuses a shared helper, with file:line targets:

| Term | Hotspot locations | Brief-39 candidate |
| --- | --- | --- |
| **Permanent vents** | S2 line 2247 + 2483; Inline legacy line 5161 + 5213 | **Yes — the Audit-39-trigger bug.** Port S1's two-branch dispatch into S2; decide whether to keep inline-legacy or archive it. |
| Wall conduction loss accumulation | S1 1209, S2 2554, Inline 5202, DDay (HDD) | No bug observed; per-state intentional (S2 owns its trace per Brief 28c). Worth confirming no formula drift. |
| Glazing solar transmission | S1 1107–1113, S2 2487–2493 | No bug observed — same `Q_glaz_incident_post_shading × TUNE_GLAZ_INSIDE_ABS`. Spot-checked identical. |
| Operable openings | S1 (Brief 28e Gate E2 logic), S2 (mirror) | Comment at line 2238 says "mirror of State 1". Verify the mirror is complete and current — could harbour a similar Brief 33/34-style miss. |
| Internal gains (hourly) | S2 calls `computeHourlyGains`; Inline + DDay use `hotel*Fraction` constants | Two different gain models. Already a known divergence — the inline/DDay paths are stale-stub. Brief 39 archival decision determines whether to delete or update. |
| Service energy (HVAC, DHW) | S3 uses templates; Inline + DDay use `sysDefaults` | Two completely different system-energy models. Stale-stub same class as the gain divergence above. |

---

## Section 3 — Cascade vs parallel pattern

| Calculator | Pattern | Evidence |
| --- | --- | --- |
| State 1 | Standalone | No calls to other state calculators. |
| **State 2** | **Hybrid: bailout-only cascade + full parallel reimpl** | Calls `_calculateEnvelopeOnly` at line 2175 only to detect bailout (line 2179) and to inherit the `gains` and `inputs_used` structure for output assembly (lines 2914, 2934). Then runs its own 8760-hour loop with own accumulators. Comment at line 2960: *"Brief 28c (2026-05-14): State 2 now computes its OWN losses against the State 2 T_op trace, instead of inheriting state1Result.losses."* — intentional design. |
| State 3 | Pure cascade on State 2 | Calls `_calculateState2` at line 3813. Reads `state2Result.demand`, `state2Result.occupancy_summary`, `state2Result.daily_profiles` directly. No envelope physics reimplementation. Adds only the systems layer (HVAC delivered, fuel splits, ventilation electrical, DHW, carbon). |
| Inline legacy 'full' | Standalone | Inside `calculateInstant` dispatcher. Does its own geometry, U-values, hour loop, gains, systems. Does NOT call State 2 or State 3 — it's a parallel third envelope path. |
| Degree-day | Standalone | No hour loop; HDD-based simplified model. Reads no other calculator's output. |

### The key architectural finding

**Architecturally, the cascade-vs-parallel choice was made deliberately and the choice differs by purpose:**

- **State 1 → State 2:** parallel by design (Brief 28c). The reason: State 2's `T_op` is gains-warmed, so envelope losses *integrated against the State 2 trace* are physically different from those integrated against the State 1 trace. Inheriting State 1's losses would have produced a wrong reconciliation (Brief 29 Issue #6's class).

- **State 2 → State 3:** cascade by design (Brief 28f Part 5). State 3 doesn't touch envelope; it consumes State 2's demand and adds the systems layer. The right pattern — heating demand × COP = electricity delivered is the same calculation regardless of how demand was computed.

- **Inline legacy + Degree-day:** both pre-date the State 1/2/3 split. They never received Brief 28c, 28-IM, 28k, 33, 34, 28f, or any sweep that targeted the named-state calculators. They are **fossil paths**: kept reachable because some callers don't pass v2.5 libraryData or weather data, but architecturally orphaned.

The parallel reimplementation of envelope physics between State 1 and State 2 is therefore **not the problem**. The problem is that when a single envelope term gets updated (Brief 33/34 added the `flow_mode` dispatch to State 1), the change has to be applied separately in every parallel implementation — and Brief 34's author explicitly deferred two of them with an inline comment that never got actioned.

---

## Section 4 — Display view → calculator output map

| View | Module | Mode passed | Calculator path | Field path read | Notes |
| --- | --- | --- | --- | --- | --- |
| Heat Balance Sankey | Building (`BuildingDefinition.jsx:1486`) | `'envelope-only'` | State 1 | `result.losses.*` | Perm-vent = State 1's `acc_vent_permanent` (single_sided dispatch correct) → **7.7 MWh** on Bridgewater. |
| Heat Balance Stacked / Rows / Sankey | Internal Gains (`useStateComparison.js:72,77`) | `'envelope-only'` + `'envelope-gains'` | State 1 + State 2 | Both | Building card reads State 1; Internal Gains card reads State 2. Perm-vent in Internal Gains = State 2's `acc_vent_permanent` (cross-flow only) → **41.3 MWh**. |
| Heat Balance Sankey | Operation (`OperationModule.jsx:264`) | `'envelope-gains'` | State 2 | `result.losses.permanent_vents` | Same State 2 number → **41.3 MWh**. Same bug as IG. |
| Systems Sankey (tapered ribbons) | Systems (`SystemsModule.jsx:123`) | `'full'` + `engine='v2.5'` | State 3 | `result.consumption.{space_heating,space_cooling,dhw,…}` | Cascades on State 2 demand. Perm-vent visible through `state2Result.losses` → also 41.3 MWh if surfaced, but Systems Sankey doesn't currently surface perm-vent magnitude. |
| Rejection tab | Systems (`SystemsModule.jsx:123`) | `'full'` + `engine='v2.5'` | State 3 | `result.consumption.ventilation[*].exhaust_loss_mwh` etc. | Distinct from permanent-vent loss; reads mech-vent post-HRE exhaust. Unaffected by the perm-vent bug. |
| KPI strip (EUI + carbon) | All modules — IM Results | `'full'` + `engine='v2.5'` | State 3 | `result.eui_kwh_per_m2`, `result.carbon_kg_co2_per_m2` | Inherits State 2 demand → inherits the perm-vent bug indirectly. Magnitude on EUI: heating demand inflated by State 2's larger vent loss → larger heating demand → larger fuel → larger EUI. (Quantified below in §5.) |
| EnergyCarbon Tab | Results (`EnergyCarbonTab.jsx:192`) | (mode default 'full', no engine) | State 3 if libraryData has system_templates, else inline legacy | `result.energy_use`, `result.system_performance` | Path depends on libraryData. Currently inferred to hit State 3 in production but could fall through to inline legacy if v2.5 library not yet loaded — race condition concern. |
| Heat Balance Tab | Results (`HeatBalanceTab.jsx:33`) | none, libraryData = `{}` | **Inline legacy 'full'** | reads result fields | Always hits inline legacy because libraryData is empty `{}`. Currently shows a physics path that hasn't received Brief 28c, 28k, 33, 34. |
| Live Results Panel | Building (`LiveResultsPanel.jsx:258`) | no options | Inline legacy or State 3 (depends on whether libraryData has system_templates) | varies | Same indeterminacy as EnergyCarbon. |
| Systems Live Results | Systems (`SystemsLiveResults.jsx:292`) | no options | Inline legacy or State 3 (libraryData-dependent) | varies | Same. |
| `SystemSankey.jsx` (the orphan) | (unused on `/systems`; only `SystemsZones.jsx`) | no options | Inline legacy or State 3 | — | Component imported only by `SystemsZones.jsx`. See [Brief 38 close STATUS entry](../../STATUS.md) — this is the file the misdirected earlier Brief-38 commits touched. |
| Project Dashboard | (`ProjectDashboard.jsx:212`) | no options, libraryData = `{}` | **Inline legacy 'full'** | summary fields | Always hits inline legacy. |
| Roadmap | `roadmapEngine.js:213` | `'full'` + `engine='v2.5'` | State 3 | per-state evaluations | Clean v2.5 path. |
| Pop-Out Results | `PopOutResults.jsx:544` | no options, libraryData = `state.libraryData ?? {}` | Indeterminate (depends on snapshot contents) | varies | Same indeterminacy as the no-options callers above. |

### What this map proves

**The 7.7 vs 41.3 perm-vent discrepancy IS a genuine calculator-output difference, not a display drift.** Each module's Sankey reads the engine field exposed by the calculator path it requested. The numbers diverge because State 1's perm-vent formula differs from State 2's.

**Several views are also exposed to the inline-legacy path** without the user knowing. `HeatBalanceTab.jsx`, `ProjectDashboard.jsx`, and `LiveResultsPanel.jsx` pass empty libraryData, falling through to the inline legacy. Anything they show — fabric losses, infiltration, perm-vents, gains, systems, EUI, carbon — comes from a simplified non-state-1/2/3 model. Whether these views are reachable in current Bridgewater workflow needs a UI inspection, but the code path is live.

---

## Section 5 — Findings, severity, recommendations

### Per-term findings

| Term | Reimpl pattern | Intentional? | Bridgewater impact | Severity | Suggested fix shape |
| --- | --- | --- | --- | --- | --- |
| **Permanent vents** | S1 has two-branch dispatch; S2 + inline-legacy cross-flow only | **Accidental** — explicit deferred follow-up in S2 comment (line 2236–2238) and inline-legacy comment (line 5155); follow-up never landed | S2: 41.3 MWh vs S1: 7.7 MWh (5.4×); flows through to State 3's heating demand and EUI | **S2** (wrong numbers visible to user; bounded magnitude; cascades to State 3) | Port `resolveFlowMode` + `single_sided_factor` into S2 (lines 2247 + 2483) and inline-legacy (line 5213). ~12 lines total. Bridgewater pre/post in audit doc. |
| Wall / roof / floor conduction loss accumulator | S1 / S2 / inline-legacy each have their own | **Mixed** — S1/S2 parallel reimpl is intentional (Brief 28c); inline-legacy is a stale third path | Not directly observable on Bridgewater without a re-run; suspected divergence ≤ a few percent between S1 and S2 (same formula, different T_air traces). Inline-legacy could be much larger if hit by some callers. | S1 if cosmetic-only between S1/S2; S2 if inline-legacy is hit in production | Confirm formula identity S1↔S2 via inspection; no fix required there. For inline-legacy: archive decision needed (see §"Inline legacy fate" below). |
| Thermal bridging (H_TB) | Shared helper `computeThermalBridges` for S1+S2; absent from inline-legacy + DDay | **Mixed** | Inline-legacy + DDay paths show zero thermal bridging — silently wrong if a caller reaches them | S2 if a production caller hits inline-legacy without TB | Either add `computeThermalBridges` to inline-legacy, or archive inline-legacy entirely. |
| Infiltration (q50 → operational ACH) | Shared `deriveOperationalACH` for S1+S2; inline-legacy + DDay use raw constant ACH 0.5 | **Mixed** | If a caller passes a Brief 34-style q50 but hits inline-legacy, the q50 is ignored and infiltration = constant 0.5 ACH | S2 (wrong numbers if any production caller reaches the inline path with Brief 34 inputs) | Same fix shape as TB — make inline-legacy call the shared helper, or archive it. |
| Operable openings | S1 inline (Brief 28e); S2 mirror inline; inline-legacy simplified; DDay absent | **Mixed** — S2 comment says "mirror of State 1" | Same risk class as perm-vent (mirror could be stale) | S1 if mirror is current; S2 if it's stale | Inspect the mirror for drift since Brief 28e closed. Out of scope of this audit. |
| Internal gains (hourly profile) | S2 via `computeHourlyGains` (rich profile); inline-legacy + DDay via `hotel*Fraction` constants | **Stale stub** — pre-Brief 27 model retained for fallback | If a real project hits inline-legacy or DDay, internal gains shown are stubbed (hotel-tuned defaults), not project-driven | S2 if any production caller can reach either | Archive decision (see below). |
| Service energy (HVAC, DHW, fuel split) | S3 via `computeServiceEnergy`/`computeDhwFuelMix` (v2.5 templates with primary+secondary, Brief 38); inline-legacy + DDay via `sysDefaults` (legacy single-system efficiency table) | **Stale stub** | If any caller reaches inline-legacy, the entire systems result is computed with a different (and weaker) model. EUI, fuel split, carbon all affected. | S2 if reachable by a production view | Archive decision. |

### The five-calculator question (audit escalation)

The brief flagged ">4 top-level calculators" as a pause condition. The 5th path (inline legacy 'full') is:

- **Reachable**: confirmed by `HeatBalanceTab.jsx`, `ProjectDashboard.jsx`, and any caller passing empty libraryData.
- **Stale**: never received Brief 28c, 28-IM, 28k, 33, 34, 28f, 38 sweeps that landed on State 1/2/3.
- **Carries the same perm-vent bug** as State 2 (line 5213).
- **Architecturally orphaned**: predates the State 1/2/3 split; serves only callers that don't pass full v2.5 inputs.

**Recommendation: archive the inline-legacy path before Brief 39 begins.** The right form of archival depends on which callers still need a fallback:

- If `HeatBalanceTab.jsx`, `ProjectDashboard.jsx`, and `LiveResultsPanel.jsx` should be running State 3 — wire them to pass v2.5 libraryData. Delete the inline-legacy path. Then Brief 39's perm-vent fix is one location (State 2) instead of two.
- If those callers genuinely need a non-v2.5 fallback (e.g. for legacy projects without systems_config_v25) — convert the inline-legacy path into a call to `_calculateState2` with `mode='envelope-gains'`, dropping the inline systems-side entirely. Then Brief 39 fixes one location (State 2) and the inline-legacy path is just a routing decision, not a parallel physics implementation.

The same archival decision applies to degree-day, with the addition that DDay is intentionally a simplified model (HDD-based) for use when no weather data is available — a legitimate fallback. The recommendation for DDay is: keep the path, but clearly label its outputs as "degree-day approximation" so users know they're not seeing hour-by-hour physics.

### Architectural recommendation

**Pattern C (hybrid) is the right architecture and is mostly already in place.** Brief 39 doesn't need to refactor State 1 ↔ State 2 into a shared envelope helper — Brief 28c made the deliberate decision that they should be parallel for physics-of-the-trace reasons.

**What Brief 39 should do:**

1. **Decide the inline-legacy 'full' fate (prerequisite).** Without this decision, the perm-vent fix has to be applied in two places (S2 + inline-legacy) and any future sweep faces the same multiplication. Recommended option: convert inline-legacy to a thin router that calls `_calculateState2` (when v2.5 library isn't available) — keeps the fallback semantic but removes the parallel envelope physics.

2. **Port the State 1 perm-vent dispatch to State 2** (Audit 39 perm-vent fix). Six-line change, lines 2247 + 2483. If inline-legacy is archived per step 1, this is the only location to touch.

3. **Confirm the operable-openings "mirror"** in State 2 is current with State 1's Brief 28e implementation. Inspection-only — no fix unless drift is found.

4. **Documentation hygiene** — update CLAUDE.md Module Scopes (and any audit cross-refs) to note that State 2's parallel envelope reimpl is intentional, and that any future envelope-physics change to State 1 MUST be ported to State 2 as part of the same commit. The Brief 33/34 → State 2 deferral is the failure mode this rule prevents.

### What's NOT recommended

- **Don't introduce a shared `computePermanentVents` helper** for State 1 ↔ State 2. The integration is inline because the loss accumulation depends on the calculator's own `T_air` trace; extracting just the `Q_louvre_m3s` formula would either still be reimplemented in the integration loop or would force a callback pattern that's less readable than the inline code. The fix is to keep the formula inline in both places, with the same dispatch logic.

- **Don't combine State 1 and State 2 into a single calculator parameterised by `include_gains`.** The Brief 28c rationale (own `T_op` trace, own losses) means the two states are physically different; combining them invites the same class of bug it was designed to prevent.

- **Don't expand the cascade pattern to S1 → S2.** State 2's losses must come from its own trace; cascading from S1 was specifically reverted by Brief 28c.

---

## Read-only confirmation

No code modified in this commit. Single deliverable: this audit doc + a cross-link to `docs/audit/39_state2_permanent_vent_diagnosis.md` (the trigger case). Brief 39's scope is now grounded in:

- The escalation flag (5 calculators, inline-legacy needs an archival decision).
- The perm-vent fix scope (S2 only if inline-legacy is archived; S2 + inline-legacy if not).
- The shared-helper map (which envelope terms are already shared and which are parallel).
- The intentional-vs-accidental classification per term.

Standing by for Brief 39 authorisation.

---

## Brief 39 Part 1 outcome — Inline-legacy rationalisation deferred

**Author:** Claude Code (executor) — appended during Brief 39 Part 1 (2026-05-19).

Brief 39 Part 1 was authorised with the audit's Option (a) recommendation in mind — convert the inline-legacy 'full' path into a thin router calling `_calculateState2`. The Part 1 consumer audit (steps 1.1–1.2) found that this is not viable without a heavier consumer-side rewrite. Chris authorised **Option (c)** — patch inline-legacy in place with the same two-branch dispatch as State 1 — as the pragmatic ship-the-fix path. Architectural rationalisation of inline-legacy is deferred to a follow-up brief. This section documents the findings so the follow-up brief doesn't need to redo the consumer audit work.

### Consumer audit findings (the three live consumers of inline-legacy)

| Consumer | `libraryData` passed | Fields read from `result` | Verdict |
| --- | --- | --- | --- |
| `LiveResultsPanel.jsx:258` | propagated from parent (default `{}` if absent) | `eui_kWh_m2` (line 274); `annual_heating_kWh`, `annual_cooling_kWh`, `annual_dhw_kWh` (lines 289, 295, 301); `carbon_kgCO2_m2` (307); `gia_m2` (313); `fuel_split.{total_kWh, electricity_pct, gas_pct}` (320–342); `monthly.{heating_kWh, cooling_kWh, solar_kWh}` (349); passes whole `result` to `GainsLossesChart` (278) | **Heavy systems-side reads.** State 2 doesn't produce `eui_kWh_m2`, `carbon_kgCO2_m2`, `fuel_split`, or `monthly`. Option A (thin router → State 2) would break this view. |
| `HeatBalanceTab.jsx:33` | `{}` explicit | `liveResult?.heat_balance` only (lines 54, 68) | **Clean for Option A.** `heat_balance` is built by the shared `_buildHeatBalance` helper and is present on State 2's result. |
| `ProjectDashboard.jsx:212` | `{}` explicit | `instantResult?.eui` (line 219) | **Clean for Option A** — but the field name is *wrong*: the real field is `eui_kWh_m2`. This read has always returned `undefined`; the dashboard falls through to `results?.summary?.eui_kWh_per_m2`. Latent dead read — logged as Issue #16 in `29_open_issues.md`. |

### Why Option (c) instead of (a)

Option (a) (thin router → State 2 for envelope+gains, with a shared `legacySystemsAssembly` helper for systems-side fields) is architecturally correct but the systems-block extraction is non-trivial:

- Inline-legacy's systems block spans roughly `instantCalc.js:5286–5605` (320 lines). It does heating/cooling/DHW/fans dispatch via `sysDefaults`, builds the `fuel_split`, computes carbon, assembles `systems_flow`, accumulates `monthly` arrays.
- Extracting this into a callable helper that produces the same output shape requires either passing State 2's full result + a building/systems config or duplicating those inputs. The helper would also need access to the same constants and per-fuel split logic.
- The extracted helper would be a *second* systems engine (after State 3's `computeServiceEnergy` / `computeDhwFuelMix` / `computeVentilationEnergy`) — the same parallel-reimpl pattern problem that's already in scope.

Brief 39's purpose is to close the perm-vent bug class and prevent recurrence. Both happen with Option (c) in ~6 lines of code. The architectural cleanup of inline-legacy is real and worth doing, but it warrants its own focused brief.

### What the follow-up brief should do

The eventual rationalisation of inline-legacy should:

1. **Extract the systems block** (inline-legacy lines 5286–5605) into a module-scope helper, e.g. `assembleLegacySystemsResult(envelopeGainsResult, building, systems)` that takes a State-2-shape result + building + systems config and produces the systems-side fields (`fuel_split`, `carbon_kgCO2_m2`, `systems_flow`, `monthly`, `annual_heating_kWh`, etc.) using the same `sysDefaults`-based dispatch the inline path uses today.

2. **Convert inline-legacy into a router:** call `_calculateState2(...)` for envelope+gains, then `assembleLegacySystemsResult(...)` for systems-side, merge the two and return. Net effect: one less parallel envelope-physics implementation; the systems-side parallel implementation remains but is now isolated in a single helper.

3. **Bridgewater reconciliation step:** confirm that the four consumers (`LiveResultsPanel`, `HeatBalanceTab`, `ProjectDashboard`, plus any others surfaced during inspection) see the same `eui_kWh_m2`, `carbon_kgCO2_m2`, `fuel_split` numbers post-refactor as they did pre-refactor. Pure code-motion change — no math changes.

4. **Eventual delete:** once all consumers have been migrated to v2.5 libraryData and pass `engine: 'v2.5'` (so they hit State 3 directly), the inline-legacy router can be removed entirely and `assembleLegacySystemsResult` can stay as a v2.5-fallback helper for callers that don't want to maintain a full system_templates library.

The follow-up brief is roughly Brief 41-shaped (after Brief 40 — Systems Library Architecture, the rewritten draft Chris is preparing).

### Cross-link

- Brief 39 Part 1 commit lands the in-place patch.
- Issue #16 in `docs/audit/29_open_issues.md` documents the ProjectDashboard latent dead-read found during this audit.
- CLAUDE.md's new architectural rule (Brief 39 Part 4) explicitly names inline-legacy as a parity-required location so the follow-up brief can find this audit doc by following the rule.
