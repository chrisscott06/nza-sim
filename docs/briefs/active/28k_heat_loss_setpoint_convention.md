# Brief 28k — Heat loss and gain: setpoint convention

**Status:** Active
**Author:** Chris (with Claude Chat)
**Date opened:** 2026-05-15
**Validation evidence:** `Bridgewater_Bottom_Up_Energy_Model.xlsx` (hand-calc spreadsheet, root)
**Supersedes:** None — but invalidates the loss-reporting headline numbers from Briefs 28b and 28j (mechanics of those briefs unchanged; just the loss interpretation)

---

## Background

The Static engine's loss accumulator and demand calculation use a non-standard convention. This was discovered after four days of investigation triggered by Chris noticing that "envelope-only heat loss" numbers didn't make physical sense for a building with a 21°C heating setpoint.

### What the engine currently does

Per-element heat loss is accumulated as:

```javascript
const dT_air_for_loss = T_air - T_out          // free-running zone T minus outdoor
if (dT_air_for_loss > 0) {
  acc_cond_wall   += U × A × dT_air_for_loss   // counts only when zone warmer than outside
  // ... same pattern for roof, glazing, infiltration, permanent vents
}
```

Three issues with this:

1. **`T_air` is the free-running zone temperature trace** — what the building does without any heating. It is not the heating setpoint. The number that pops out is internally self-referential: the building "loses" what it loses because it sits where it sits, which is determined by how much it loses.

2. **The `dT > 0` gate only counts outward heat flow.** Inward heat flow on hot summer days (when outdoor air or sol-air exceeds indoor) is silently dropped from the tally.

3. **Walls and roof use plain `T_out` for the loss accumulator**, despite the wall physics inside `stepWallLinearized` correctly using sol-air temperature. The engine has the right answer internally but reports against the wrong driving temperature.

Heating demand uses a hybrid that's similarly muddled:

```javascript
if (T_op < comfortBand.lower_c) {                    // free-running gate
  const Q_loss_at_lower = UA_total × (comfortBand.lower_c - T_out)
  const heating_Wh = max(0, Q_loss_at_lower - Q_solar_in_Wh_for_demand)
  acc_heating_demand_Wh += heating_Wh
}
```

The formula inside the branch is the correct setpoint-anchored convention. But the *gate* (`T_op < comfortBand.lower_c`) only counts hours when the free-running zone is below the setpoint. In a gain-dominated building like Bridgewater, the free-running zone is often above 21°C in winter (internal gains + solar carry it), so most heating hours get excluded and demand reads low. Pre-28j Bridgewater State 2 heating demand was 11.5 MWh annual; post-28j it's 88.7 MWh because the gate behaviour changes with edits Chris made to gains. Neither is the right answer because both are gate-dependent.

### What the standard convention is

Every rigorous building energy methodology (ISO 52016-1:2017, CIBSE Guide A, ASHRAE Handbook of Fundamentals, EnergyPlus heat balance method, PHPP) follows the same pattern:

```
For each hour h, for each element:
  Q_heating_loss_h = max(0, U × A × (T_setpoint_heat − T_driving_h))
  Q_cooling_gain_h = max(0, U × A × (T_driving_h − T_setpoint_cool))

Where:
  T_driving = T_sol_air for opaque (walls, roof). T_sa = T_out + α × G_solar / h_out
  T_driving = T_out for glazing conduction and ventilation
  Solar transmission through glazing = g × G_incident × A, integrated separately

Heating demand = max(0, hourly losses − hourly useful gains), summed annually
Cooling demand = max(0, hourly gains − hourly useful losses), summed annually
```

Heat loss and heat gain are reported as separate accumulators, never netted. Both are calculated against fixed indoor setpoints, not against a free-running zone trace.

### Why the convention matters

A building physicist reading "Bridgewater envelope heat loss = 146 MWh" expects that number to mean "this is the heat that must be supplied to maintain a 21°C zone." Currently it means "this is what the building lost between its free-running state and outside, only when zone happened to be warmer than outside, with no setpoint involved." These are different physical quantities. The current convention produces numbers that:

- Are not comparable across buildings (because they depend on the free-running trace, which depends on the building's gains)
- Are not comparable across calculations on the same building (because changing internal gains changes the trace, which changes the reported "loss")
- Are not interpretable as system sizing requirements
- Don't reconcile against published CIBSE quick estimates, hand-calcs, or EnergyPlus Ideal Loads outputs

### How we got here (acknowledgement)

Brief 28b validated Static against Dynamic by matching free-running zone temperature traces. Both engines free-running, both matching within 0.5K, declared validated. **But neither was computing heat loss against the standard convention.** The mass model is right (still useful for overheating analysis). The headline loss number was always against the wrong target. Brief 28j inherited the same convention via the heating demand gate.

The fix is engine-layer, not display-layer. Displaying free-running losses with a different label is not equivalent — the heat balance arithmetic only closes if both sides use the same convention.

---

## Scope

### In scope

1. Replace per-element loss accumulator in `_calculateEnvelopeOnly` (`instantCalc.js` line ~705-755) with symmetric heating/cooling accumulators against setpoint:
   - Opaque elements use sol-air temperature
   - Glazing uses T_out
   - Ventilation uses T_out
   - Ground floor uses ground temperature
2. Replace the equivalent block in `_calculateState2` (line ~1444+)
3. Replace heating demand and cooling demand calculations:
   - Remove the free-running gate (`if T_op < lower_c`)
   - Integrate setpoint-anchored loss minus useful gains at every hour, summed annually
4. Add new engine output block `losses_at_setpoint`:
   ```
   losses_at_setpoint: {
     external_wall:    { heating_loss_kwh, cooling_gain_kwh, area_m2, kwh_per_m2 },
     roof:             { heating_loss_kwh, cooling_gain_kwh, area_m2, kwh_per_m2 },
     ground_floor:     { heating_loss_kwh, cooling_gain_kwh, area_m2, kwh_per_m2 },
     glazing:          { heating_loss_kwh, cooling_gain_kwh, solar_transmission_kwh,
                         by_face: { F1: {...}, F2: {...}, F3: {...}, F4: {...} } },
     fabric_leakage:   { heating_loss_kwh, cooling_gain_kwh },
     permanent_vents:  { heating_loss_kwh, cooling_gain_kwh },
     thermal_bridging: { heating_loss_kwh, cooling_gain_kwh },
     totals:           { total_heating_loss_kwh, total_cooling_gain_kwh, total_solar_transmission_kwh }
   }
   ```
5. Update `heating_demand_mwh` and `cooling_demand_mwh` to come from the new setpoint convention. These flow through to State 3 systems unchanged in mechanism.
6. Keep the existing `losses` block alongside `losses_at_setpoint` for one release cycle, labelled as `free_running_balance` in the schema and as a diagnostic in the UI. Schedule removal after canonical adoption.

### Out of scope (deferred)

- Utilisation factor for gains. ISO 52016 hourly method handles gain-loss timing implicitly at hourly resolution. For V1, useful gains = all gains at each hour. Defer time-constant-based utilisation factor to a future brief.
- Multi-zone calculation. Single-zone unchanged.
- Display layer rework. Headline tab labels change minimally (rename "free-running balance" to a diagnostic tab; setpoint convention becomes the default headline). Display brief is separate.
- Equipment-first systems model. Library-template systems retained.
- Brief 28b parameter retuning. Tuning was for free-running zone trace match, still valid for overheating diagnostic. Headline losses no longer depend on those parameters.
- Brief 28j MVHR cap mechanics. Unchanged — same hourly cap math, just against setpoint-anchored heating demand instead of free-running gate demand. The hourly demand array passed to `computeVentilationEnergy` will produce different numbers but the function logic is unchanged.

### Not changing

- Wall physics in `stepWallLinearized` (CTF multi-node model). Already uses sol-air correctly on outside boundary.
- Solar gain calculation per facade. Already correct.
- Free-running zone temperature trace. Retained for overheating analysis (`comfort_hours`, `summer_max_T`, `winter_min_T`). Not the headline.
- State 3 systems pipeline. Consumes `heating_demand_mwh` and `cooling_demand_mwh` as before.
- Brief 28j hourly MVHR cap mechanics inside `computeVentilationEnergy`.

---

## Engine changes

### File: `frontend/src/utils/instantCalc.js`

#### Function: `_calculateEnvelopeOnly` (line ~406)

**Replace** the loss accumulator block (~line 705-728) with:

```javascript
// Per-element heating-direction loss and cooling-direction gain.
// Standard convention (ISO 52016 / CIBSE / ASHRAE):
//   Q_heating_loss_h = max(0, U × A × (T_setpoint_heat − T_driving_h))
//   Q_cooling_gain_h = max(0, U × A × (T_driving_h − T_setpoint_cool))
// T_driving = T_sa for opaque (sol-air captures hot-air conduction AND solar absorption)
// T_driving = T_out for glazing and ventilation
// T_driving = T_ground for ground floor

const T_heat = comfortBand.lower_c
const T_cool = comfortBand.upper_c

// Sol-air T_sa_wall, T_sa_roof already computed earlier in the loop
// Opaque walls + roof
const dT_heat_wall = Math.max(0, T_heat - T_sa_wall)
const dT_cool_wall = Math.max(0, T_sa_wall - T_cool)
acc_heat_loss_wall   += wholeWallU_ext  * total_wall_opaque * dT_heat_wall
acc_cool_gain_wall   += wholeWallU_ext  * total_wall_opaque * dT_cool_wall

const dT_heat_roof = Math.max(0, T_heat - T_sa_roof)
const dT_cool_roof = Math.max(0, T_sa_roof - T_cool)
acc_heat_loss_roof   += wholeWallU_roof * roof_area * dT_heat_roof
acc_cool_gain_roof   += wholeWallU_roof * roof_area * dT_cool_roof

// Glazing (T_out, no sol-air on glass)
const dT_heat_out = Math.max(0, T_heat - T_out)
const dT_cool_out = Math.max(0, T_out - T_cool)
acc_heat_loss_glaz_n += glaz_face_UA('north') * dT_heat_out
acc_heat_loss_glaz_e += glaz_face_UA('east')  * dT_heat_out
acc_heat_loss_glaz_s += glaz_face_UA('south') * dT_heat_out
acc_heat_loss_glaz_w += glaz_face_UA('west')  * dT_heat_out
acc_cool_gain_glaz_n += glaz_face_UA('north') * dT_cool_out
acc_cool_gain_glaz_e += glaz_face_UA('east')  * dT_cool_out
acc_cool_gain_glaz_s += glaz_face_UA('south') * dT_cool_out
acc_cool_gain_glaz_w += glaz_face_UA('west')  * dT_cool_out

// Ventilation (T_out)
acc_heat_loss_leakage   += UA_leakage    * dT_heat_out
acc_heat_loss_permanent += UA_permanent  * dT_heat_out
acc_cool_gain_leakage   += UA_leakage    * dT_cool_out
acc_cool_gain_permanent += UA_permanent  * dT_cool_out

// Ground floor (T_ground)
const dT_heat_ground = Math.max(0, T_heat - T_ground)
const dT_cool_ground = Math.max(0, T_ground - T_cool)
acc_heat_loss_floor += wholeWallU_floor * ground_area * dT_heat_ground
acc_cool_gain_floor += wholeWallU_floor * ground_area * dT_cool_ground

// Solar transmission through glazing — always-on annual gain (separate from conduction)
// Q_solar_glaz_zone is already computed elsewhere in the loop per facade
acc_solar_trans_glaz_n += Q_solar_glaz_zone_n
acc_solar_trans_glaz_e += Q_solar_glaz_zone_e
acc_solar_trans_glaz_s += Q_solar_glaz_zone_s
acc_solar_trans_glaz_w += Q_solar_glaz_zone_w
```

Declare these accumulators alongside existing ones near line 557:

```javascript
// Setpoint-convention accumulators (Brief 28k)
let acc_heat_loss_wall = 0, acc_heat_loss_roof = 0, acc_heat_loss_floor = 0
let acc_heat_loss_glaz_n = 0, acc_heat_loss_glaz_s = 0, acc_heat_loss_glaz_e = 0, acc_heat_loss_glaz_w = 0
let acc_heat_loss_leakage = 0, acc_heat_loss_permanent = 0

let acc_cool_gain_wall = 0, acc_cool_gain_roof = 0, acc_cool_gain_floor = 0
let acc_cool_gain_glaz_n = 0, acc_cool_gain_glaz_s = 0, acc_cool_gain_glaz_e = 0, acc_cool_gain_glaz_w = 0
let acc_cool_gain_leakage = 0, acc_cool_gain_permanent = 0

let acc_solar_trans_glaz_n = 0, acc_solar_trans_glaz_s = 0, acc_solar_trans_glaz_e = 0, acc_solar_trans_glaz_w = 0
```

**Replace** the demand calculation block (~line 743-754) with:

```javascript
// Standard convention demand: integrate hourly heat balance at setpoint, no free-running gate.
// Heating demand at hour = max(0, total fabric+vent loss at heating setpoint − useful solar gains)
// Cooling demand at hour = max(0, total fabric+vent gain at cooling setpoint + solar transmission − useful loss-direction conduction)

const hourly_heat_loss_W = (
  wholeWallU_ext  * total_wall_opaque * dT_heat_wall +
  wholeWallU_roof * roof_area         * dT_heat_roof +
  glaz_face_UA('north') * dT_heat_out + glaz_face_UA('east') * dT_heat_out +
  glaz_face_UA('south') * dT_heat_out + glaz_face_UA('west') * dT_heat_out +
  UA_leakage * dT_heat_out + UA_permanent * dT_heat_out +
  wholeWallU_floor * ground_area * dT_heat_ground
)
const Q_solar_through_glazing_h = (acc_solar_trans_glaz_n_this_h + /* etc, all 4 facades */)

const heating_Wh_at_setpoint = Math.max(0, hourly_heat_loss_W - Q_solar_through_glazing_h)
acc_heating_demand_Wh += heating_Wh_at_setpoint

// Cooling: cooling-direction conduction + solar through glazing + internal gains (in State 2+)
// In envelope-only (no internal gains), cooling demand = cooling fabric gain + solar transmission
const hourly_cool_gain_W = (
  wholeWallU_ext  * total_wall_opaque * dT_cool_wall +
  wholeWallU_roof * roof_area         * dT_cool_roof +
  glaz_face_UA('north') * dT_cool_out + /* etc */ +
  UA_leakage * dT_cool_out + UA_permanent * dT_cool_out
)
const cooling_Wh_at_setpoint = hourly_cool_gain_W + Q_solar_through_glazing_h
acc_cooling_demand_Wh += cooling_Wh_at_setpoint
```

**Add** new output block in the return statement (~line 776+):

```javascript
losses_at_setpoint: {
  external_wall: {
    heating_loss_kwh: r1(acc_heat_loss_wall / 1000),
    cooling_gain_kwh: r1(acc_cool_gain_wall / 1000),
    area_m2: Math.round(total_wall_opaque),
    kwh_per_m2: perM2(acc_heat_loss_wall)
  },
  roof: { /* same shape */ },
  ground_floor: { /* same shape */ },
  glazing: {
    heating_loss_kwh: r1((acc_heat_loss_glaz_n + ...) / 1000),
    cooling_gain_kwh: /* sum */,
    solar_transmission_kwh: r1((acc_solar_trans_glaz_n + ...) / 1000),
    by_face: {
      F1: { heating_loss_kwh: r1(acc_heat_loss_glaz_n/1000), cooling_gain_kwh: ..., solar_transmission_kwh: ... },
      F2: { /* east */ },
      F3: { /* south */ },
      F4: { /* west */ }
    }
  },
  fabric_leakage:   { heating_loss_kwh: r1(acc_heat_loss_leakage/1000), cooling_gain_kwh: r1(acc_cool_gain_leakage/1000) },
  permanent_vents:  { heating_loss_kwh: r1(acc_heat_loss_permanent/1000), cooling_gain_kwh: r1(acc_cool_gain_permanent/1000) },
  thermal_bridging: { heating_loss_kwh: 0, cooling_gain_kwh: 0 },  // populated only if Y-factor > 1
  totals: {
    total_heating_loss_kwh: r1((acc_heat_loss_wall + acc_heat_loss_roof + acc_heat_loss_floor +
                                 acc_heat_loss_glaz_n + acc_heat_loss_glaz_s + acc_heat_loss_glaz_e + acc_heat_loss_glaz_w +
                                 acc_heat_loss_leakage + acc_heat_loss_permanent) / 1000),
    total_cooling_gain_kwh: /* equivalent sum */,
    total_solar_transmission_kwh: r1((acc_solar_trans_glaz_n + acc_solar_trans_glaz_s + acc_solar_trans_glaz_e + acc_solar_trans_glaz_w) / 1000)
  }
}
```

Keep the existing `losses` block alongside, relabelled internally for clarity. Display layer continues consuming both for transition period.

#### Function: `_calculateState2` (line ~1216)

Same replacement pattern. Same accumulators. Same output schema additions.

Additionally:
- In State 2, internal gains contribute to heat balance. Heating demand at hour = max(0, fabric+vent loss − useful_internal_gains_h − useful_solar_through_glazing_h). Cooling demand at hour = fabric+vent cool gain + solar transmission + internal_gains_at_hour.
- For V1, useful_internal_gains_h = internal_gains_h × 1.0 (no utilisation factor).

#### Function: `_calculateState3` (line ~2139)

No engine code change. State 3 consumes `heating_demand_mwh` and `cooling_demand_mwh` from State 2 result; if those are correct under the new convention, State 3 outputs flow through unchanged.

Brief 28j hourly MVHR cap in `computeVentilationEnergy` is unchanged. It receives the hourly heating demand array from State 2 and caps recovery per hour at that hour's demand. State 2's hourly array now uses setpoint convention; the cap math is identical.

---

## Hand-calc validation targets

**Source:** `Bridgewater_Bottom_Up_Energy_Model.xlsx` (workbook in project root), specifically `05_Heat_Loss` tab.

**Bridgewater current configuration:**
- GIA 4322 m² (58.8 × 14.7 × 5)
- Volume 13,830 m³
- Wall opaque 1,428 m², Roof 864 m², Floor 864 m²
- Glazing: F1=517, F2=24, F3=358, F4=26 m² (total 924)
- U-values: wall 0.18, roof 0.16, floor 0.22, glazing 1.40
- Setpoints: 21°C heating, 25°C cooling
- Permanent vents: NE 1.0 m², SW 0.76 m², equivalent ACH 0.13
- Background infiltration: 0.20 ac/h
- Weather: Yeovilton TMYx 2011-2025 EPW

### Per-element heating-direction loss at 21°C setpoint

| Element | Spreadsheet kWh/yr | Tolerance | Engine target |
|---|---:|---:|---|
| External wall F1 (NE) | 5,929 | ±15% | `losses_at_setpoint.external_wall.heating_loss_kwh` × F1 area share |
| External wall F2 (SE) | 2,766 | ±15% | (per facade) |
| External wall F3 (SW) | 7,678 | ±15% | |
| External wall F4 (NW) | 2,941 | ±15% | |
| External walls total | 19,314 | ±15% | `losses_at_setpoint.external_wall.heating_loss_kwh` |
| Roof | 9,788 | ±15% | `losses_at_setpoint.roof.heating_loss_kwh` |
| Ground floor | 16,225 | ±15% | `losses_at_setpoint.ground_floor.heating_loss_kwh` |
| Glazing F1 (NE) | 62,537 | ±15% | `losses_at_setpoint.glazing.by_face.F1.heating_loss_kwh` |
| Glazing F2 (SE) | 2,843 | ±15% | |
| Glazing F3 (SW) | 43,208 | ±15% | |
| Glazing F4 (NW) | 3,127 | ±15% | |
| Glazing total | 111,715 | ±15% | `losses_at_setpoint.glazing.heating_loss_kwh` |
| Background infiltration | 79,991 | ±15% | `losses_at_setpoint.fabric_leakage.heating_loss_kwh` |
| Permanent vents | 51,994 | ±15% | `losses_at_setpoint.permanent_vents.heating_loss_kwh` |
| **TOTAL fabric + ventilation** | **289,030** | **±15%** | `losses_at_setpoint.totals.total_heating_loss_kwh` |

### Per-element cooling-direction gain at 25°C setpoint

| Element | Spreadsheet kWh/yr | Tolerance |
|---|---:|---:|
| External walls (sol-air, all facades) | ~683 | ±25%¹ |
| Roof (sol-air) | ~1,280 | ±25% |
| Glazing conduction (cooling-side) | ~293 | ±25% |
| Ventilation cooling | ~346 | ±25% |
| **TOTAL fabric+vent cooling gain** | **~2,600** | **±25%** |

¹ Cooling gain absolute values are very small for UK climate (CDH-25 = 227 K·h/yr). Larger tolerance reflects that small absolute values amplify rounding and floor effects.

### Solar transmission through glazing (always-on)

| Facade | Spreadsheet kWh/yr |
|---|---:|
| F1 (NE) | ~96,000 |
| F2 (SE) | ~8,000 |
| F3 (SW) | ~132,000 |
| F4 (NW) | ~6,000 |
| **TOTAL solar transmission** | **~242,000** |

### CIBSE quick-estimate sanity check

UA total × HDD-15.5 × 24 = 3,408 × 1,736 × 24 / 1e6 = **142 MWh**

Bottom-up net heating demand (after useful internal + solar gains subtracted from 289 MWh raw loss) should land near this value for an approximately typical building. Bridgewater under Home Office continuous occupancy has high internal gains; net heating demand expected somewhere in the 80-150 MWh range. Outside that range without explanation is a flag.

---

## Validation against Dynamic engine

The current "Static-vs-Dynamic at envelope-only matches within 0.5K mean T" validation from Brief 28b is unaffected — that was a free-running zone temperature comparison. Still valid for the mass model.

The new convention requires a different Dynamic reference:

**Configure Dynamic with Ideal Loads Air System** at the heating/cooling setpoints (21°C / 25°C). EnergyPlus reports:
- `Zone Ideal Loads Supply Air Total Heating Energy` — directly comparable to Static's `heating_demand_mwh`
- `Zone Ideal Loads Supply Air Total Cooling Energy` — directly comparable to Static's `cooling_demand_mwh`
- `Zone Ideal Loads Outdoor Air Total Heating Energy` — for ventilation-related component breakdown

Tolerance: Static `heating_demand_mwh` should match EP Ideal Loads heating output within ±15% on Bridgewater envelope-only and State 2 configurations.

For raw envelope-only loss without HVAC, configure EP with very wide setpoints (e.g. heating -100°C, cooling +100°C, no ventilation HRE) and read `Surface Outside Face Conduction Heat Transfer Energy` per surface plus `Zone Infiltration Total Heat Loss Energy`. Sum across surfaces of the same type to get per-element loss. Should match Static `losses_at_setpoint.{element}.heating_loss_kwh` within ±15%.

If Static and EP disagree by more than 15% on per-element loss with consistent inputs, halt and investigate before proceeding.

---

## Halt gates

Investigation halts at these explicit points for Chris's review:

1. **After implementation of loss accumulator changes in `_calculateEnvelopeOnly`** — before touching `_calculateState2`. Run on Bridgewater envelope-only mode. Report per-element `losses_at_setpoint` numbers. Compare to spreadsheet `05_Heat_Loss` row by row. **PASS = all 14 rows within ±15%. FAIL = any row outside.** If FAIL, do not proceed to State 2; report the failing rows and the suspected cause.

2. **After implementation of demand calculation changes in `_calculateEnvelopeOnly`** — report `heating_demand_mwh` and `cooling_demand_mwh` for Bridgewater envelope-only. Compare against Dynamic-with-Ideal-Loads if available, or document that the comparison is pending Dynamic reconfiguration. **PASS = within ±15% of Dynamic Ideal Loads (if available) or within ±15% of (spreadsheet raw loss minus solar transmission useful fraction).** If FAIL, halt.

3. **After implementation in `_calculateState2`** — same comparisons as Gate 1 and Gate 2 but with internal gains active. State 2's `heating_demand_mwh` should be substantially lower than State 1's (gains offset losses). Net heating demand expected 80-150 MWh on Bridgewater. **PASS = within range. FAIL = outside, halt.**

4. **Before any State 3 / display-layer / further engine work** — final validation pass. Bridgewater envelope-only, State 2, and State 3 outputs all reviewed against spreadsheet. Document any deltas in `docs/validation/brief_28k_validation.md`. Chris signs off.

At any halt gate, Claude Code reports findings and waits for review. No subsequent work proceeds until each gate clears.

---

## PASS / FAIL browser scenarios

Per Development Bible: "Explicit verification scenarios — what to do in the browser, what to check, what PASS and FAIL look like."

### Scenario 1 — Bridgewater envelope-only, Static engine

**Setup:**
1. Open Bridgewater project (`14b4a5b1-8c73-4acb-8b65-1d22f05ec969`)
2. Settings: length 58.8, width 14.7, num_floors 5, orientation 42°, U-values as canonical (wall 0.18, roof 0.16, floor 0.22, glazing 1.40), permanent openings NE 1.0 + SW 0.76, infiltration 0.2 ac/h, comfort band 21/25
3. Navigate to Building tab → Heat Balance view
4. Force state mode "Envelope only" (use new state-mode toggle if shipped; otherwise temporarily disable systems_config_v25)

**Check:**
- Heat Balance display shows two views: "Setpoint convention" (default) and "Free-running balance" (diagnostic)
- Setpoint convention tab shows per-element loss numbers

**PASS criteria:**
- Total fabric+vent heat loss displays 280-300 MWh (target 289 MWh ±5% headline tolerance)
- External walls total displays 17-22 MWh (target 19 MWh)
- Glazing total displays 100-125 MWh (target 112 MWh)
- Roof displays 8-12 MWh (target 10 MWh)
- Ground floor displays 14-18 MWh (target 16 MWh)
- Infiltration displays 70-90 MWh (target 80 MWh)
- Permanent vents displays 45-58 MWh (target 52 MWh)
- Heating demand at envelope-only displays close to total loss (no gains to offset)
- Cooling demand at envelope-only displays small (<10 MWh, UK climate)

**FAIL signals:**
- Any per-element loss outside ±15% of spreadsheet target
- Total loss less than 250 MWh or more than 330 MWh
- Heating demand at envelope-only much less than total loss (suggests free-running gate still active somewhere)
- Cooling demand large at envelope-only (suggests gate-suppressed gains leaking through)

### Scenario 2 — Bridgewater State 2 (envelope + internal gains)

**Setup:**
1. Same as Scenario 1 but with internal gains enabled (occupancy, lighting, equipment from current Bridgewater config)
2. State mode "Envelope + gains"

**Check:**
- Heat Balance display shows the same per-element heat loss numbers as Scenario 1 (fabric loss doesn't change when gains are added — only T_setpoint and T_out drive it)
- Heat balance display shows internal gains as separate offset line items
- Heating demand is loss minus useful gains
- Cooling demand reflects cooling gains plus internal gains during cooling hours

**PASS criteria:**
- Per-element heat loss numbers byte-identical to Scenario 1
- Internal gains breakdown shows people, lighting, equipment as separate line items
- Net heating demand 60-150 MWh (Bridgewater is gain-dominated under Home Office continuous occupancy)
- Net cooling demand reflects internal gains in summer — value depends on internal gain inputs

**FAIL signals:**
- Per-element heat loss changes between Scenario 1 and Scenario 2 (would indicate the loss calc is still gain-coupled)
- Net heating demand is 0 MWh or negative (suggests gains exceed losses everywhere — input or utilisation factor issue, flag for review)
- Net heating demand identical to State 1 demand (suggests gains aren't being subtracted)

### Scenario 3 — Bridgewater State 3 (full systems)

**Setup:**
1. State mode "Full" — VRF heating SCOP 5.12, electric panel secondary, gas boiler + ASHP DHW, MVHR + WC extract
2. Navigate to Results → Energy & Carbon

**Check:**
- Annual energy use by service and fuel
- EUI and carbon
- Per-system energy consumption

**PASS criteria:**
- Heating fuel (electricity for VRF + panel) reflects net heating demand from State 2 divided by SCOP-weighted efficiency. Should land in the 15-30 MWh range (60-120 MWh heating demand ÷ ~4.5 weighted SCOP).
- Cooling fuel similar pattern, very small for UK
- DHW fuel: gas ~178 MWh, electricity ~53 MWh (50/50 split, per spreadsheet 09_DHW)
- MVHR recovery offsets heating demand visibly, but doesn't eliminate it (Brief 28j hourly cap working)
- Total electricity 250-350 MWh; total gas 150-220 MWh; EUI 100-130 kWh/m² (still uncalibrated vs measured 176)
- Banner remains visible: "Uncalibrated model — measured energy comparison required"

**FAIL signals:**
- Heating fuel reads near zero (suggests free-running gate or MVHR cap broken)
- Total electricity > 600 MWh or < 200 MWh
- DHW gas reads near zero or > 350 MWh
- Energy & Carbon tab crashes or shows NaN

### Scenario 4 — sensitivity test on permanent vent area

**Setup:**
1. Bridgewater envelope-only
2. Note baseline permanent vent loss number
3. Change permanent vent area inputs: NE 1.0 m² → 2.0 m², SW 0.76 → 1.52 m² (double both)
4. Re-run

**Check:**
- Permanent vent loss number doubles (assuming linear relationship between vent area and equivalent ACH)
- Total fabric+vent loss increases by ~52 MWh
- Headline EUI increases proportionally

**PASS criteria:**
- Permanent vent loss within ±20% of 2× baseline (some nonlinearity in flow model is fine, but order-of-magnitude correctness)
- Other element losses unchanged

**FAIL signals:**
- Permanent vent loss changes by ≤50% or ≥250%
- Other element losses change (indicates coupling that shouldn't exist)

---

## Validation evidence required

Per Development Bible: "Verification means evidence. Screenshots + numbers + pass/fail checkboxes."

Claude Code reports back with:

1. **Per-element loss numbers** from engine, in a table, alongside spreadsheet targets, with PASS/FAIL marked per row
2. **Screenshots** of:
   - Heat Balance view at envelope-only showing setpoint convention numbers
   - Heat Balance view at State 2 showing same loss numbers + gains breakdown
   - Energy & Carbon tab at State 3
3. **Engine diff** showing the lines changed in `instantCalc.js` for the loss accumulator and demand calc replacement
4. **Test output** confirming all existing tests still pass (163/163 green or whatever the current count is)
5. **Dynamic comparison** if EP can be reconfigured for Ideal Loads in time; if not, document that as pending
6. **Documentation file** `docs/validation/brief_28k_validation.md` capturing all of the above

If any halt gate fails, the report is the same shape but with failing rows highlighted and a hypothesis for the cause. No proceeding without Chris signing off.

---

## Implications for previous work

**Brief 28b (mass model tuning):** Tuning parameters (rad_frac 0.30, internal_mass 250, glaz_inside_abs 0.07) remain useful for overheating analysis (summer max, comfort hours, free-running zone). They no longer drive the headline loss numbers. The "Static-vs-Dynamic at envelope-only within 0.5K" validation is still real — it validated free-running zone temperature, not heat loss. Comfort hours and summer max numbers stay canonical.

**Brief 28j (hourly MVHR cap):** Mechanics unchanged. The `computeVentilationEnergy` function still receives an hourly heating demand array and caps recovery per hour at that hour's demand. Post-28k, the hourly heating demand array is computed using the setpoint convention (no free-running gate). MVHR effective recovery will land at a different number because heating demand is being calculated differently, but the cap math is identical. Expect MVHR recovery offset to look more sensible post-28k.

**Brief 28f Part 5.4 (Systems UI rewrite):** Unaffected — Systems UI consumes `heating_demand_mwh` and `cooling_demand_mwh` as inputs. As long as those numbers are correct, the UI works. 5.4 can proceed in parallel or after 28k.

**State 3 Energy & Carbon tab (Path C):** Numbers will move. Pre-28k:  EUI 90-100 kWh/m² with heating fuel near zero. Post-28k: expected EUI 100-130 kWh/m² with heating fuel ~15-30 MWh visible. Both still below measured (~176 kWh/m²), gap is calibration territory.

**Dynamic state-mode audit (commit 6d4d96a):** Findings stand — Bridgewater's legacy `systems_config` was routing Dynamic to "full" mode when Chris wanted envelope-only. UI state-mode toggle still needed regardless. Audit document `docs/validation/dynamic_state_mode_audit_2026_05.md` retained.

---

## File pointers

**Engine files affected:**
- `frontend/src/utils/instantCalc.js` — `_calculateEnvelopeOnly` (line ~406-870), `_calculateState2` (line ~1216-1700)
- `frontend/src/utils/wallModel.js` — no change (sol-air already correct internally)

**Engine files not affected:**
- `frontend/src/utils/computeVentilationEnergy.js` (Brief 28j) — mechanics unchanged
- `frontend/src/utils/instantCalc.js::_calculateState3` (line ~2139) — consumes demand outputs

**Display layer (not in scope for this brief, separate UI brief to follow):**
- `frontend/src/components/modules/balance/HeatBalance.jsx`
- `frontend/src/utils/stateMode.js`

**Validation references:**
- `Bridgewater_Bottom_Up_Energy_Model.xlsx` (project root) — canonical hand-calc
- `docs/validation/yeovilton_epw_summary.md` — weather summary
- `docs/validation/bridgewater_baseline_inputs.md` — Bridgewater config snapshot
- `docs/validation/brief_28k_validation.md` — to be created by Claude Code

**Brief location:**
- `docs/briefs/active/28k_heat_loss_setpoint_convention.md`

---

## Acknowledgement

This brief exists because Brief 28b validated against the wrong target. The mass model is right but the loss convention was non-standard and never reviewed against published methodology until Chris pushed on it after four days of investigation. Lesson logged: future briefs that touch fabric heat loss must include a hand-calc validation step against standard convention (CIBSE/ISO 52016/ASHRAE) before declaring an engine validated. Free-running zone temperature trace match is not equivalent to heat loss validation.

---

**End of Brief 28k.**
