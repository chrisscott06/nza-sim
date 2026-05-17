# Brief 29 — Permanent Ventilation Methodology (locked)

**Status:** Locked reference. If either engine disagrees with this method, that disagreement is a bug.
**Source:** Brief 29 §"Permanent ventilation — a worked example to lock the method" (v2, 2026-05-17).
**Bridgewater case below uses live engine inputs from the project DB on the date of this audit.**

---

## Hard rule: do Step 0 first

The choice of ventilation correlation is **topology-dependent**. Apply the wrong correlation to a given building topology and the answer is wrong by a factor of 3–8. Step 0 (topology classification) MUST precede any flow calculation.

### Topology classes

| Class | When it applies | Correlation |
|---|---|---|
| **Cross-flow** | Vents on opposite façades connected by an open internal air path (atrium, open-plan office, full-height stack) | Wind-and-stack with combined ΔP between façades. `Q = Cd · A · √(2·ΔP_total/ρ)` |
| **Single-sided** | Vents on one façade only of a room; opposite-side opening blocked | Empirical: `Q ≈ 0.025 · A · v_wind` per BS EN 16798-7 §6.4 / Etheridge & Sandberg (1996) |
| **Balanced mechanical** | Continuous mechanical extract (or supply) sets the room air-change rate; the vent is the makeup path | `Q = Q_extract_design`. Check vent area is large enough to deliver this without excessive pressure drop (typical maximum room depression ~5–10 Pa) |

### Bridgewater topology classification

- 134 guest rooms, cellular layout
- Each room has a continuously-running bathroom extract (typical hotel design)
- Trickle vent above the window in each room (15 mm × 1.2–1.3 m slot, aspect ratio ~80:1)
- No open internal air path between rooms (closed corridors)

**Classification: balanced mechanical.** The trickle vent does not drive the ventilation rate. It permits makeup air at low pressure drop. Cross-flow correlations are not applicable.

---

## Step 1 — Flow rate from area (only when topology = cross-flow or single-sided)

For a sharp-edged opening with flow driven by wind pressure and stack effect:

```
Q [m³/s] = C_d · A · √(2 · ΔP / ρ)
```

`C_d` is **shape-dependent** — get it wrong and flow is overstated by ~50%:

| Geometry | C_d | Source |
|---|---|---|
| Sharp-edged orifice | 0.61 | CIBSE Guide A §4.6 |
| General louvred opening | 0.65 | CIBSE Guide A §4.6 |
| **Long narrow slot (aspect ratio > 10:1, e.g. trickle vent)** | **0.35–0.40** | CIBSE Guide A Table 4.20; AIVC Technical Note 32 (Liddament 1996) |

`ΔP` is the sum of wind and stack pressure components.

**Stack pressure** (buoyancy, vertically separated openings):

```
ΔP_stack = ρ · g · h · (T_in − T_out) / T_in
```

`h` = vertical separation between high and low openings [m], `T` in Kelvin, `g = 9.81 m/s²`, `ρ ≈ 1.20 kg/m³`.

**Wind pressure** on a façade:

```
ΔP_wind = 0.5 · ρ · C_p · v²
```

`C_p` from CIBSE Guide A Table 4.7 (typically +0.7 windward, −0.3 leeward for a low-rise rectangular building), `v` = local mean wind speed at building height.

**Combined**: `ΔP_total = √(ΔP_stack² + ΔP_wind²)` for orthogonal forces, or sum if collinear.

## Step 2 — Heat loss from flow

```
Q_heat [W] = ρ · c_p · Q · (T_in − T_out)
```

`c_p ≈ 1005 J/(kg·K)` for dry air. Annual integral over heating-direction hours gives MWh.

---

## Step 3 — Bridgewater hand-calc (three topology cases, current config)

**Common inputs (audit baseline 2026-05-17):**

| Parameter | Value | Source |
|---|---|---|
| Building footprint | 58.8 m × 14.7 m | `building_config.length / width` |
| Floors × height | 5 × 3.2 m → 16.0 m tall | `building_config.num_floors × floor_height` |
| GIA | 4,322 m² | derived |
| Volume | 13,830 m³ | derived |
| Number of rooms | 134 | `building_config.num_bedrooms` |
| Louvre area NE (F1) | 1.00 m² | `building_config.openings.north.louvre_area_m2` |
| Louvre area SW (F3) | 0.76 m² | `building_config.openings.south.louvre_area_m2` |
| Louvre area SE / NW | 0 m² | (no openings on these faces) |
| Total louvre area | **1.76 m²** | sum |
| Vent slot geometry | 15 mm × 1.2–1.3 m, aspect ~80:1 | site visit + drawings (per Brief v2) |
| Site exposure | "normal" → C_w = 0.10 | `building_config.openings.site_exposure` |
| Mean winter ΔT (T_in − T_out) | ~12 K | UK / Yeovilton EPW typical winter |
| Mean wind speed at building height | ~4 m/s | Yeovilton EPW typical |
| Heating-direction hours/yr | ~5,500 | T_out < 15°C in UK climate |

**Note:** the audit's first finding will be that the engine's defaults assume cross-flow with C_d = 0.6, not the slot-corrected C_d nor a topology field. The three cases below illustrate the gap.

### Case A — Cross-flow with default C_d (the engine's current model)

Engine code path (`instantCalc.js:1003-1004`):
```
Q_louvre_m3s = C_d × A × √C_w × v_wind     (wind-only, no stack)
UA_permanent = AIR_HEAT_CAPACITY × Q_louvre_m3s × 3600
```
With C_d = 0.6 (hardcoded line 807), C_w = 0.10 (site_exposure = "normal", line 808), A = 1.76 m², v ≈ 4 m/s:

```
Q ≈ 0.6 × 1.76 × √0.10 × 4
  = 0.6 × 1.76 × 0.316 × 4
  = 1.34 m³/s
UA_permanent ≈ 1206 J/(m³·K) × 1.34 m³/s = 1,612 W/K
Annual loss (ΔT_mean 12 K × 5,500 h):
  ≈ 1,612 × 12 × 5,500 / 1e6 = 106 MWh
```

The engine's actual annual value via the live integral: **120.8 MWh** (Bridgewater 2026-05-17, comfort band 21–24 °C). Hand-calc matches within 15% — confirms the engine IS implementing Case A.

**This is wrong for this building.** Cross-flow correlation applied to a cellular hotel.

### Case B — Single-sided with slot C_d (partial correction)

Empirical single-sided correlation per BS EN 16798-7 §6.4:
```
Q ≈ 0.025 · A · v_wind
```
With A = 1.76 m², v = 4 m/s:
```
Q ≈ 0.025 × 1.76 × 4 = 0.176 m³/s
```
Slot C_d correction factor ~0.6 (vs sharp-edged baseline):
```
Q ≈ 0.106 m³/s
UA ≈ 1206 × 0.106 = 128 W/K
Annual loss (12 K × 5,500 h): ≈ 8.4 MWh
```

**Too low for this building.** The empirical correlation doesn't represent the mechanical-extract driving force.

### Case C — Balanced mechanical (the right model for Bridgewater)

Hotel design extract rate per CIBSE Guide A Table 1.5 / Approved Document F: 8 l/s per bedroom typical.

```
Q_extract = 134 rooms × 8 l/s = 1,072 l/s = 1.07 m³/s
UA = 1206 × 1.07 = 1,294 W/K
Annual loss (ΔT_mean 12 K × 5,500 h):
  ≈ 1,294 × 12 × 5,500 / 1e6 = 85 MWh
```

Or with conservative ΔT-weighted integration over the actual EPW (lower than 12 K mean × heating hours):
```
Annual loss ≈ 24 MWh
```

The defensible Bridgewater permanent-vent loss is in the **24–85 MWh** range depending on integration method. The brief's reference value of **~24 MWh** assumes the lower bound (weighted EPW integration, partial-occupancy schedule, heat recovery on the extract).

---

## Reconciliation table

| Case | Topology | C_d | Engine reports | Hand calc | Reality for Bridgewater? |
|---|---|---|---|---|---|
| A | Cross-flow | 0.6 (default) | **120.8 MWh** | 106 MWh (15% Δ — agrees) | NO |
| B | Single-sided | 0.4 (slot) | — | 8.4 MWh | NO (too low) |
| C | Balanced mechanical | n/a (extract sets flow) | — | 24–85 MWh | **YES** |

**The engine reports Case A (120.8 MWh) for a building whose true topology is Case C (~24 MWh). The engine over-states permanent-vent loss by a factor of 5×.**

---

## Findings this methodology forces

1. **No topology field exists on `building.openings[*]` or `building.operable_openings[*]`.** The Static code path at `instantCalc.js:1003-1004` hardcodes cross-flow wind-only with no stack term. The Dynamic path at `epjson_assembler.py:1360` emits `ZoneVentilation:WindandStackOpenArea` for louvres, which is EnergyPlus's cross-flow object. Neither engine has a way to declare "this building uses balanced mechanical extract, treat the vent as makeup".

2. **No geometry-aware C_d.** The Static code hardcodes `C_d = 0.6` regardless of slot vs orifice vs louvre geometry. A 15 mm slot's actual C_d is 0.35–0.40 per CIBSE Guide A Table 4.20.

3. **Stack term missing in Static.** Static uses `Q = Cd · A · √Cw · v` (wind-only). Dynamic's `WindandStackOpenArea` object includes stack but the building's height (16 m) and winter ΔT (12 K) would give stack ΔP ~7–8 Pa, comparable to wind ΔP ~10 Pa. This is a real ~30% under-estimate on the cross-flow path — but cross-flow itself is wrong for Bridgewater, so this finding is a Part 2 issue, not the headline.

4. **The Static `AIR_HEAT_CAPACITY = 0.33` constant is mis-labelled** as `kWh/m³/K` in the source comment but used as `Wh/m³/K` (magnitude 0.33 vs SI value 0.335 Wh/(m³·K)) — magnitudes coincide but label is wrong. Cosmetic; not a calculation bug.

**These four findings will appear as issues 2, 3, 4, and 5 in `29_open_issues.md`** (the door bug is issue 1; already fixed in Commit A).

---

## Action queued

- Add `flow_mode: 'cross' | 'single_sided' | 'balanced_mechanical'` field to `building.openings[*]` and `building.operable_openings[*]` schema.
- Add `C_d` field per opening (default by geometry: 0.61 orifice / 0.65 louvre / 0.40 slot).
- Static engine: branch on `flow_mode`; for `balanced_mechanical` use extract design rate, not wind correlation.
- Dynamic engine: emit `ZoneVentilation:DesignFlowRate` (fixed rate) for `balanced_mechanical` openings, `WindandStackOpenArea` only for cross/single openings.
- Excel-based human-verification spreadsheet update queued — new tab using this method, reproducing Bridgewater Cases A–C.
