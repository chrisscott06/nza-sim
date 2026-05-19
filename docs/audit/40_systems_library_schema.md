# Brief 40 — Systems library schema

**Status:** Part 1 deliverable (this commit). Canonical design reference for Brief 40 Parts 2–5.

**Linked work:**
- Brief 40 brief: [`docs/briefs/active/40_systems_library_architecture.md`](../briefs/active/40_systems_library_architecture.md)
- Predecessor: Brief 38 Sankey polish shipped `consumption.space_heating.{primary,secondary}` + `consumption.space_cooling.{primary,secondary}` with `{delivered_mwh, fuel_mwh, fuel, efficiency}` — the existing n=2 proportional split this brief generalises to N systems
- Predecessor: Brief 42 close (`224ef60`) — established the "each opening declares its own physics" pattern (per-opening `cd` + `flow_mode` with null = follow comfort band). Brief 40 reuses that shape for system setpoints (`null` = follow comfort band; otherwise use the system's own setpoint)
- Module scope: CLAUDE.md "Module scopes" Systems section — expanded from stub to full scope in the same commit as this doc

---

## §1. Generic system shape

Every system, regardless of service, carries the following fields:

```
{
  id: string,                                       // stable UUID
  label: string,                                    // user-facing name ("Main GSHP", "Back-up boiler")
  service: 'heating' | 'cooling' | 'dhw' | 'ventilation' | 'lighting' | 'small_power',
  source: enum,                                     // service-specific — see §2
  efficiency_metric: number | object,               // service-specific shape — see §2
  setpoint: number | null,                          // null = follow comfort band's corresponding setpoint
  control_mechanism: 'constant'
                   | 'weather_compensation'
                   | 'occupancy_driven'
                   | 'scheduled',
  control_schedule_id: string | null,               // when control_mechanism === 'scheduled', references a Brief 37 schedule
  share_pct: number,                                // 0–100; per-service shares MUST sum to exactly 100
  capacity_kw: number | null,                       // stored but not used in proportional split (informational)
  notes: string,
}
```

**Per-service array shape** on the building config:

```
systems_config_v40: {
  heating:     [system, ...],
  cooling:     [system, ...],
  dhw:         [system, ...],
  ventilation: [system, ...],
  lighting:    [system, ...],
  small_power: [system, ...],
}
```

**Field-name note (Part 2 refinement):** the Brief 40 shape lives at
`building.systems_config_v40` to avoid clashing with the existing legacy
`building.systems_config` fallback used by State 3 (`instantCalc.js`
line 4018: `building.systems_config_v25 ?? building.systems_config`).
The naming mirrors `systems_config_v25` (Brief 28f) so the migration
history (legacy → v25 → v40) is visible in field names. Part 5 migration
populates `systems_config_v40` from `systems_config_v25` for Bridgewater.
References elsewhere in this doc to "`systems_config.{service}[...]`"
should be read as `systems_config_v40.{service}[...]`.

The `share_pct` invariant is enforced by the engine (error on validation) and prevented by the UI (Part 3's share-validation logic with normalise / distribute quick-fixes).

The setpoint semantics — `null` = follow the comfort band's corresponding setpoint, non-null = use the system's own setpoint — mirror Brief 42's per-opening cd/flow_mode pattern (cd/flow_mode = null on a facade falls back to the building-wide value at migration time, then becomes the per-opening value once edited). **No inheritance pattern.** "Follow comfort" is a per-system null, not a live link; changing the comfort band changes the resolved setpoint at compute time, but editing the system to a custom setpoint severs the relationship.

---

## §2. Per-service schemas

### §2.1 Heating

```
source: 'electricity' | 'gas' | 'oil' | 'biomass'
      | 'district_heating'
      | 'ambient_air'     // ASHP
      | 'ambient_ground', // GSHP
efficiency_metric: number,        // SCOP (heat pumps) or seasonal combustion η — dimensionless
setpoint: number | null,          // °C; null = comfort_band.lower_c
```

Field-label hint for the UI (`SystemEditorCard`): the efficiency field is labelled **SCOP** when `source ∈ { ambient_air, ambient_ground, district_heating, electricity }` (electric heat pumps + heat-network exit-side COP) and **Seasonal η** when `source ∈ { gas, oil, biomass }`. The schema doesn't distinguish — only the UI label changes.

### §2.2 Cooling

```
source: 'electricity' | 'district_cooling',
efficiency_metric: number,        // SEER — dimensionless
setpoint: number | null,          // °C; null = comfort_band.upper_c
```

Field-label hint: **SEER** for the efficiency field.

### §2.3 DHW

```
source: 'electricity' | 'gas' | 'oil' | 'biomass'
      | 'district_heating'
      | 'ambient_air'             // air-source heat pump DHW
      | 'ambient_ground'          // ground-source heat pump DHW
      | 'solar_thermal_assisted', // listed but out of scope per Principle 4
efficiency_metric: number,        // overall point-of-use η (generation + storage + distribution) — dimensionless
setpoint: number,                 // storage temperature in °C — default 60 (legionella)
tap_outlet_temp_c: number,        // tap outlet temperature in °C — default 40 (hotel; building-type-driven)
cold_supply_temp_c: number,       // cold supply temperature in °C — default 10

// Brief 40 Part 2 schema refinement (2026-05-19): demand basis is per-system
// to preserve the modern engine's per-occupant-hour DHW shape during
// migration. See §12 "DHW demand basis — refinement during Part 2" for
// the rationale.
demand_basis: 'per_m2' | 'per_person',
demand_litres_per_m2_day: number | null,        // populated when demand_basis === 'per_m2'
demand_litres_per_person_per_day: number | null,// populated when demand_basis === 'per_person'
```

Default `demand_basis` by building type (Part 5 migration applies):
- **Hotel** → `per_person` (matches modern engine's `dhwKwhPerPersonHour` shape; the per-occupant-hour basis captures hotel DHW physics naturally)
- **Office** → `per_m2` (commercial benchmark style; per-m² gives cleaner CIBSE TM54 comparison)
- **Other / unspecified** → `per_m2` (conservative default — easier to populate from area benchmarks than from occupancy density)

Default values per basis:
- `per_person`: 80 L/person/day (matches current `dhwKwhPerPersonHour` default `litres_per_person_per_day = 80`)
- `per_m2`: 1.1 L/m²/day (matches the current per-m² legacy constant)

**No `setpoint: null` for DHW** — DHW storage temperature is a system property, not a comfort band derivative. The diagnostic surfaces over-delivery when `tap_outlet_temp_c < setpoint` and tap-mixing isn't actively reducing energy (uncommon but real on commercial sites without thermostatic mixing valves).

### §2.4 Ventilation

```
source: 'electricity' | 'natural', // 'natural' listed for completeness; out of Systems scope (Operation/Building territory)
efficiency_metric: {
  sfp_w_per_lps: number,           // Specific Fan Power, W/(l/s)
  recovery_sensible_pct: number,   // 0–100; only meaningful for MVHR
  recovery_latent_pct: number,     // 0–100; only meaningful for enthalpy-wheel MVHR
},
flow_rate: number,                 // scalar — units depend on flow_rate_basis
flow_rate_basis: 'per_person' | 'per_m2' | 'constant',
setpoint: null,                    // not applicable to ventilation — always null
defrost_penalty_kwh: number | null,// optional; for cold-climate MVHR
```

The efficiency_metric is an object because ventilation has multiple independent parameters (fan power *and* recovery), not a single seasonal efficiency.

### §2.5 Lighting (thin)

```
source: 'electricity',
efficiency_metric: null,           // n/a — gain comes from Internal Gains
setpoint: null,
control_mechanism: 'constant' | 'daylight_dimming' | 'occupancy_sensors' | 'both',
control_factor: number,            // multiplier on Internal Gains lighting gain → delivered electricity
share_pct: number,                 // typically 100
```

Default `control_factor` by `control_mechanism` (editable seeds, not fixed):
- `constant`           → 1.00
- `daylight_dimming`   → 0.70
- `occupancy_sensors`  → 0.70
- `both`               → 0.50

**Heat-gain provenance:** lighting heat gain remains sourced from the Internal Gains module's `lpd × gia × schedule_fraction` integrand. The Systems lighting entry only computes the *delivered electrical energy* for end-use accounting (kWh of electricity drawn from the meter) — applying the `control_factor` to the gain → delivered electricity multiplier. No double-counting in the heat balance because lighting heat is upstream of the Systems split.

### §2.6 Small power (thin)

```
source: 'electricity',
efficiency_metric: null,
setpoint: null,
control_mechanism: 'constant',     // only constant supported in v1 (most small power is plug load)
control_factor: number,            // typically 1.0 — present for future use
share_pct: number,                 // typically 100
```

Same heat-gain provenance principle as lighting: heat is upstream from Internal Gains; Systems handles only the delivered electrical figure.

---

## §3. Proportional-split mathematics

### §3.1 Heating / cooling / DHW (single seasonal η)

For each service with N systems:

```
invariant: Σ share_pct[i] = 100
```

Per system `i`:

```
delivered_i      = demand_at_this_setpoint × (share_pct[i] / 100)
source_energy_i  = delivered_i / efficiency_metric_i
```

Where `demand_at_this_setpoint` is:
- The comfort-band demand from the upstream envelope/internal-gains pipeline, if `setpoint_i == null`
- The recomputed demand using `setpoint_i`, if non-null (Part 2 implements this via `_calculateState2(..., { setpointOverride: { heating | cooling: setpoint_i } })`)

**Blended seasonal efficiency** for the service (the headline efficiency the UI surfaces at the service level):

```
blended_efficiency = 1 / Σ_i (share_pct[i] / 100 / efficiency_metric_i)
                   = weighted harmonic mean of efficiencies, weighted by share
```

Sanity: with `share_pct = [60, 40]` and `efficiency_metric = [3.5, 0.85]` (GSHP at 60% + gas boiler at 40%):
```
blended = 1 / (0.6/3.5 + 0.4/0.85)
        = 1 / (0.17143 + 0.47059)
        = 1 / 0.64202
        ≈ 1.557
```
i.e. the dual-system delivers ~1.56 kWh of heat per kWh of source energy on a weighted basis. **Used for reporting only — the per-system source_energy figures are the source of truth.**

### §3.2 Ventilation

Multiple ventilation systems compose by summing per-system contributions:

```
fan_electrical_i = flow_rate_i × sfp_i × hours_active_i × (share_pct[i] / 100)
recovered_kWh_i  = depends on per-system MVHR effectiveness × per-system flow × ΔT_hours
```

**Recovery composition rule:** total recovered kWh = Σ_i recovered_kWh_i. Do NOT compose recovery percentages (that would over-count if multiple systems claim recovery on overlapping flow). Recovery reduces the heating demand seen by heating systems and the cooling demand seen by cooling systems — which feeds back into the heating/cooling per-system delivered calc in §3.1 (the recovery credit lands on `demand_at_this_setpoint` before the share split).

`flow_rate` interpretation by `flow_rate_basis`:
- `per_person`  → flow = flow_rate × current_people_count (hour by hour)
- `per_m2`      → flow = flow_rate × gia
- `constant`    → flow = flow_rate (l/s; constant across hours)

### §3.3 Lighting / small power (thin)

```
delivered_electrical_i = gain_from_internal_gains × control_factor_i × (share_pct[i] / 100)
```

Where `gain_from_internal_gains` is the kWh figure for the corresponding service from the Internal Gains module's annual roll-up. For lighting that's the annual lighting integral; for small power, the annual equipment integral.

No fuel split — `source` is always `'electricity'` for these thin entries.

---

## §4. DHW tap-mix mathematics

The current engine (pre-Brief-40, `instantCalc.js` lines 202–205 + the State 3 DHW block) treats `DHW_LITRES_PER_M2_DAY × GIA` as litres needing full heating from `DHW_COLD_TEMP` (10°C) to `DHW_SETPOINT` (60°C). This overestimates because real tap consumption is mixed at the outlet — only the hot fraction needs full-temperature heating; the rest is cold-supply blended in.

### §4.1 The correction (basis-independent)

The tap-mix correction is a per-litre scaling factor that applies regardless of *how* total tap-litres-per-day is computed. The formula:

```
hot_fraction = (tap_outlet_temp_c − cold_supply_temp_c) / (setpoint − cold_supply_temp_c)
boiler_litres_per_day = total_tap_litres_per_day × hot_fraction
annual_dhw_thermal_kWh = boiler_litres_per_day × (setpoint − cold_supply_temp_c) × WATER_SHC × 365
annual_dhw_source_kWh  = annual_dhw_thermal_kWh / dhw_system_efficiency
```

Where `WATER_SHC = 4.18 kJ/(L·K) ÷ 3600 s/h = 1.161 × 10⁻³ kWh/(L·K)`.

`total_tap_litres_per_day` depends on the `demand_basis` (§2.3 schema refinement):

- `demand_basis === 'per_m2'`: `total_tap_litres_per_day = demand_litres_per_m2_day × GIA`
- `demand_basis === 'per_person'`: `total_tap_litres_per_day = demand_litres_per_person_per_day × avg_occupants_at_hour_h` (per-hour basis, summed over 8760)

For the per-person basis, the per-hour aggregation matches the modern engine's `annual_occupant_hours × dhwKwhPerPersonHour` convention — the demand scales with actual occupancy rather than installed area. The tap-mix correction multiplies the resulting kWh figure by `hot_fraction`.

### §4.2 Bridgewater default values

```
tap_outlet_temp_c  = 40   (hotel default; building-type-driven)
cold_supply_temp_c = 10
setpoint           = 60   (legionella safety; not user-editable below 60 without a warning)

hot_fraction        = (40 − 10) / (60 − 10) = 30/50 = 0.60
boiler_litres_per_day = 1.1 × GIA × 0.60 = 0.66 × GIA L/day
```

### §4.3 Expected magnitude on Bridgewater

Bridgewater migrates with `demand_basis: 'per_person'` (hotel type — see §12 refinement rationale) populated from the current `dhwKwhPerPersonHour` shape. The pre-Brief-40 engine on Bridgewater uses:

```
dhw_kwh_per_person_hour = f(litres_per_person_per_day, store_temp_c, cold_mains_temp_c)
                        // current default: 80 L/person/day, 60°C store, 10°C cold mains → 0.1935 kWh/person/hour
annual_dhw_thermal_kWh   = annual_occupant_hours × dhw_kwh_per_person_hour
```

Post-Brief-40 with tap-mix correction (per-person basis, Bridgewater hotel default `tap_outlet_temp_c = 40`):

```
hot_fraction               = (40 − 10) / (60 − 10) = 0.60
annual_dhw_thermal_post    = annual_dhw_thermal_pre × hot_fraction
                           = annual_dhw_thermal_pre × 0.60
```

**Pre × hot_fraction = post.** Bridgewater post-Brief-40 DHW thermal MWh = Bridgewater pre-Brief-40 DHW thermal MWh × 0.60. That's the Part 5 verification: the migration script populates `demand_litres_per_person_per_day` from the pre-Brief-40 engine constant; the only DHW number-change is the tap-mix correction; the multiplicative factor is exactly `hot_fraction`. Principle 6 (no calibration) honoured cleanly. **Falsifiable target:** Bridgewater post / Bridgewater pre = 0.60 ± rounding.

### §4.4 Physics-derived expected bracket (not a calibration target)

Per Brief 33 Principle 1 / Brief 40 Principle 6: the engine produces what the physics produces. The 40% reduction is the *mathematical consequence* of the `hot_fraction` correction with Bridgewater's default parameters. If Part 2's tap-mix wiring lands Bridgewater at e.g. 48 MWh or 54 MWh, that's a pass (parameters drift slightly within tolerance). If it lands at e.g. 80 MWh (no apparent correction) or 30 MWh (over-corrected), that's a finding — Part 2 escalates per the brief's "When to escalate" §.

---

## §5. Comfort-vs-setpoint diagnostic mathematics

For each system whose `setpoint` differs from the comfort band's corresponding setpoint, the diagnostic surfaces three numbers per system + a per-service roll-up.

### §5.1 Per-system diagnostic

```
demand_at_comfort_i        = total_service_demand × (share_pct[i] / 100)
                             // service demand computed with comfort band setpoints
delivered_at_setpoint_i    = service_demand_at_setpoint_i × (share_pct[i] / 100)
                             // service demand recomputed with this system's setpoint
delta_i                    = delivered_at_setpoint_i − demand_at_comfort_i
delta_pct_i                = 100 × delta_i / demand_at_comfort_i  // signed
```

Sign convention:
- `delta_i > 0` → overdelivery (system delivers more than the building needs at comfort)
  - Heating: setpoint above comfort.lower_c (heating to 23°C while comfort says 21°C)
  - Cooling: setpoint below comfort.upper_c (cooling to 20°C while comfort says 24°C)
- `delta_i < 0` → underdelivery
  - Heating: setpoint below comfort.lower_c (heating to 18°C while comfort says 21°C)
  - Cooling: setpoint above comfort.upper_c (cooling to 26°C while comfort says 24°C)

### §5.2 DHW diagnostic

DHW has no "comfort setpoint" in the same sense — the demand side is fixed at `tap_outlet_temp_c` (what the user actually pulls from the tap). The diagnostic surfaces what would be delivered if no tap-mix blending were applied (i.e. if all DHW were delivered at `setpoint` directly to the tap, which some commercial buildings do):

```
demand_at_tap        = annual_dhw_thermal_kWh   // tap-mix corrected (Brief 40)
delivered_no_mix     = boiler_litres_per_day_at_full_demand × (setpoint − cold_supply_temp_c) × WATER_SHC × 365
                     // i.e. demand × (setpoint − cold) / (tap − cold) = demand / hot_fraction
delta                = delivered_no_mix − demand_at_tap
                     = demand_at_tap × (1/hot_fraction − 1)
```

For Bridgewater defaults: `delta = demand × (1/0.6 − 1) = demand × 0.667` — i.e. a building with no thermostatic mixing valve delivers 66.7% more DHW thermal than one with mixing. This is the magnitude the diagnostic surfaces if a user toggles "no mixing" via setting `tap_outlet_temp_c = setpoint`.

### §5.3 Per-service roll-up

For each service:

```
total_demand_at_comfort      = Σ_i demand_at_comfort_i
total_delivered_at_setpoint  = Σ_i delivered_at_setpoint_i
total_delta                  = total_delivered_at_setpoint − total_demand_at_comfort
total_delta_pct              = 100 × total_delta / total_demand_at_comfort
```

The `SystemsDiagnosticPanel` (Part 3) renders the per-service table.

### §5.4 Resolution of `setpoint: null`

When a system's setpoint is null, the comfort band's corresponding setpoint is substituted at compute time:
- `heating system, setpoint: null` → use `comfortBand.lower_c`
- `cooling system, setpoint: null` → use `comfortBand.upper_c`
- DHW has no comfort band → `setpoint: null` is invalid for DHW (Part 2 engine should error if it sees this)

`setpoint_resolved_i = setpoint_i ?? comfort_band_corresponding_setpoint`

---

## §6. Engine return shape (Part 2 produces this)

`systemsEngine.computeSystemsDelivered(...)` returns an extension of Brief 38 Sankey polish's `consumption` object. Existing primary/secondary structure on heating + cooling stays for backward compat with the Sankey rendering; the new `systems[]` array adds N-way per-system detail.

```
{
  heating: {
    demand_at_comfort_mwh: number,
    delivered_total_mwh:    number,
    blended_efficiency:     number,
    primary:   { delivered_mwh, fuel_mwh, fuel, efficiency },  // Brief 38 backcompat — populated from systems[0]
    secondary: { delivered_mwh, fuel_mwh, fuel, efficiency },  // Brief 38 backcompat — populated from systems[1] or null
    systems: [
      {
        id, label, share_pct,
        setpoint: number | null,
        setpoint_resolved: number,            // setpoint ?? comfort band lower_c
        demand_at_this_setpoint_mwh,
        delivered_mwh,
        source_energy_mwh,
        source_fuel,                          // e.g. 'electricity', 'gas', 'district_heating'
        efficiency,                           // copy of efficiency_metric for transparency
        delta_vs_comfort_mwh,                 // §5.1
        delta_vs_comfort_pct,
      },
      ...
    ],
  },
  cooling: { ... },                          // same shape as heating, with upper_c instead of lower_c
  dhw: {
    tap_outlet_temp_c, cold_supply_temp_c, hot_fraction,
    boiler_litres_per_day, demand_litres_per_m2_day,
    annual_dhw_thermal_mwh,
    delivered_total_mwh,
    blended_efficiency,
    primary, secondary,
    systems: [...],
    diagnostic: {
      delivered_no_mix_mwh,                  // §5.2
      delta_mwh, delta_pct,
    },
  },
  ventilation: {
    systems: [
      { id, label, share_pct, sfp_w_per_lps, flow_rate, flow_rate_basis,
        fan_electrical_mwh, recovery_sensible_pct, recovery_latent_pct,
        recovered_heating_mwh, recovered_cooling_mwh, defrost_penalty_mwh },
      ...
    ],
    total_fan_electrical_mwh,
    total_recovered_heating_mwh,
    total_recovered_cooling_mwh,
  },
  lighting: {
    systems: [
      { id, label, share_pct, control_mechanism, control_factor,
        gain_from_internal_gains_mwh, delivered_electrical_mwh },
      ...
    ],
    total_delivered_electrical_mwh,
  },
  small_power: { ... },                      // same shape as lighting
  totals: {
    eui_kWh_per_m2,
    annual_source_kWh,
    fuel_split: { electricity_kWh, gas_kWh, oil_kWh, biomass_kWh, district_heating_kWh, district_cooling_kWh },
    carbon_kgCO2_per_m2,
  },
}
```

---

## §7. Migration notes (Part 5 detail)

The Brief 40 Part 5 migration maps Bridgewater's existing `params.systems_config_v25` (or whatever shape persists today) to the new schema:

| Pre-Brief-40 field | Brief 40 field | Notes |
|--------------------|----------------|-------|
| `systems_config.space_heating.primary.system`  | `systems_config.heating[0].source` (mapped) | `gas_boiler` → `gas`; `gshp` → `ambient_ground`; etc. — full map in Part 5 |
| `systems_config.space_heating.primary.efficiency_override` | `systems_config.heating[0].efficiency_metric` | Numeric pass-through |
| `systems_config.space_heating.primary.share_pct` (Brief 38) | `systems_config.heating[0].share_pct` | Direct |
| `systems_config.space_heating.secondary.*`     | `systems_config.heating[1].*`               | Same shape if present |
| `systems_config_v25.ventilation[i].*`          | `systems_config.ventilation[i].*`           | Per-system pass-through |
| `sys.dhw.litres_per_person_per_day` (modern engine, v25 shape) | `systems_config.dhw[0].demand_litres_per_person_per_day` | When migrating into `demand_basis: 'per_person'` (Bridgewater default — hotel) |
| `DHW_LITRES_PER_M2_DAY` (inline-legacy engine constant) | `systems_config.dhw[0].demand_litres_per_m2_day` | When migrating into `demand_basis: 'per_m2'` (office / other building types default) |
| (new — schema refinement §12)                  | `systems_config.dhw[0].demand_basis`        | Per building type — hotel → `per_person`; office / other → `per_m2` |
| `sys.dhw.cold_mains_temperature_c` (modern engine) / `DHW_COLD_TEMP` (legacy) | `systems_config.dhw[0].cold_supply_temp_c` | Default 10 |
| `sys.dhw.store_temperature_c` (modern engine) / `DHW_SETPOINT` (legacy) | `systems_config.dhw[0].setpoint`            | Default 60 |
| (new)                                          | `systems_config.dhw[0].tap_outlet_temp_c`   | Default 40 (hotel) — drives the tap-mix correction |
| (none — implicit in EUI)                       | `systems_config.lighting[0]`                | New thin entry, control_factor 1.0 share 100 |
| (none — implicit in EUI)                       | `systems_config.small_power[0]`             | New thin entry, control_factor 1.0 share 100 |

Bridgewater's pre/post headline numbers (delivered MWh per service, EUI, fuel split) are captured in Part 5 and appended to this doc as **§8 Bridgewater migration**.

---

## §8. Bridgewater migration — pre/post

*To be filled in at Part 5 (`scripts/40_bridgewater_systems_migration.py` execution).*

| Service | Pre delivered (MWh) | Post delivered (MWh) | Δ | Reason |
|---------|---------------------|----------------------|----|--------|
| Heating | TBD | TBD | TBD | Expected ~unchanged (proportional split for n=2 already shipped in Brief 38) |
| Cooling | TBD | TBD | TBD | Expected ~unchanged for same reason |
| DHW (thermal) | TBD | TBD | TBD | Expected ~40% reduction from tap-mix correction per §4 |
| Ventilation (fan kWh) | TBD | TBD | TBD | Magnitude documented |
| Lighting (delivered electrical) | TBD | TBD | TBD | New as separate line item |
| Small power (delivered electrical) | TBD | TBD | TBD | New as separate line item |
| **Total EUI (kWh/m²)** | TBD | TBD | TBD | Net of above |
| **Fuel split** | TBD | TBD | TBD | Per-fuel kWh breakdown |
| **Carbon (kgCO2/m²)** | TBD | TBD | TBD | Net of above |

### Comfort-vs-setpoint diagnostic — Bridgewater post-migration

Per-system deltas captured here once migration runs, per §5 — particularly any service with `setpoint ≠ comfort` (cooling at 20°C vs comfort 24°C is the canonical example Chris flagged).

---

## §9. Part 2 engine verification (sanity tests)

### Formula-level verification (executed at code time, 2026-05-19)

The four sanity-test targets verified against the `systemsEngine.js` formulae as written:

**1. Single heating system, SCOP 3.5, share 100%, setpoint null.**
- `share = 100/100 = 1.0`; `setpoint_resolved = comfortBand.lower_c`
- No diagnostic recompute (setpoint matches comfort) → `demand_at_this_setpoint = demand_at_comfort`
- `delivered = demand_at_comfort × 1.0 = demand_at_comfort` ✓
- `source_energy = delivered / 3.5` ✓
- `blended_efficiency = 1 / (1.0 / 3.5) = 3.5` ✓

**2. Two heating systems, GSHP SCOP 3.5 @ 60% + gas boiler η 0.85 @ 40%, both null setpoint.**
- `blended_efficiency = 1 / (0.6/3.5 + 0.4/0.85)`
- `= 1 / (0.171428... + 0.470588...)`
- `= 1 / 0.642016...`
- `≈ 1.557` ✓

  *Note: the brief Part 2 step 2.5 text states "≈ 1.43" for this calc — that's an arithmetic typo in the brief text. The mathematically correct value is 1.557 and the `systemsEngine.js` implementation produces 1.557. The brief's underlying intent (weighted harmonic mean per §3.1) is preserved.*

**3. Cooling, custom setpoint 20°C with comfort upper 24°C.**
- `setpointDiffers = true` (|20 − 24| = 4 > 0.05 threshold)
- `state2Recompute({ cooling: 20 })` produces a State 2 result with the demand integral computed at `T_cool = 20` instead of `T_cool = 24`. The setpoint substitution lands at `_calculateState2` line ~2718 (now `effectiveUpperC`).
- For UK weather (Bridgewater EPW): more cooling-direction hours satisfy `T_out > 20°C` than `T_out > 24°C`, so the integrand `Σ max(0, T_out − T_cool) × U×A × hour` grows — `demand_at_this_setpoint > demand_at_comfort`.
- `delta_vs_comfort > 0` (overcool — system delivers cooling the building doesn't strictly need at comfort)
- Magnitude verified at Bridgewater walkthrough (Part 5 / Part 6 — captured in §8 / Part 5 audit append)

**4. DHW with default tap 40°C (per-person basis).**
- `hot_fraction = (40 − 10) / (60 − 10) = 30/50 = 0.60` ✓
- For an 80 L/person/day, 60°C store, 10°C cold supply config matching the pre-Brief-40 `dhwKwhPerPersonHour` defaults:
  - Pre (no tap-mix): `annual_dhw_thermal_pre = annual_occupant_hours × 0.1935 kWh/person/hour`
    - Where `0.1935 = (80/24) × 50 × WATER_SHC_KWH_PER_L_PER_K` — derivable from `dhwKwhPerPersonHour(80, 60, 10)` in `instantCalc.js`
  - Post (with tap-mix in `systemsEngine._computeDhw`):
    - `total_tap_litres_per_day = (annual_occupant_hours / 24) × 80 / 365`
    - `boiler_litres_per_day = total_tap_litres_per_day × 0.60`
    - `annual_dhw_thermal_post = boiler_litres_per_day × 50 × 0.001161 × 365`
    - Algebraically reduces to: `annual_dhw_thermal_post = annual_dhw_thermal_pre × 0.60`
- **Post / Pre = 0.60 ± rounding** ✓ — matches the falsifiable target in §4.3

All four formula targets verified. Bridgewater-specific MWh values populate in §8 at Part 5 migration.

### Rule 14 sweep result for Part 2

The setpoint parameterisation (Brief 40 Part 2 step 2.1) was applied across:

- **State 2 (`_calculateState2`):** ✓ — `opts.setpointOverride` parameter added; `effectiveLowerC` / `effectiveUpperC` substituted in:
  - `H_floor_const` / `C_floor_const` (~line 2315)
  - `T_heat` / `T_cool` inside the hour loop (~line 2718)
  - Per-element heat loss + cooling gain accumulators cascade from those locals
  - Comfort-hour counters + zone-air init temperatures intentionally NOT substituted (those questions are comfort-related, not setpoint-related)

- **State 1 (`_calculateEnvelopeOnly`):** ✓ — Rule 14 parity. `opts = {}` added as 8th positional parameter; State 2's call site updated to pass `opts` as 8th positional (was incorrectly passing as 7th `tuning` position before the fix). Same `effectiveLowerC` / `effectiveUpperC` substitution pattern. State 1 doesn't compute system delivered energy itself, so the override is not consumed by `computeSystemsDelivered` for the diagnostic — but Rule 14 keeps the parameter symmetric across State 1 + State 2 so any future consumer reading State 1 with an override gets a consistent demand integral.

- **Inline-legacy (`_calculateDegreeDay`, line 5283+):** **NO OVERRIDE APPLIED.** Finding: inline-legacy uses hardcoded `T_heat_setpoint = 21` / `T_cool_setpoint = 24` (lines 5319–5320), not derived from `comfortBand` at all. The setpoint override parameter is mechanically inapplicable — inline-legacy operates on a separate setpoint contract entirely. Documented as a Rule 14 sweep finding rather than as a forced port: porting would mean rewriting inline-legacy to consume `comfortBand`, which is significantly larger work and falls under the deferred inline-legacy rationalisation follow-up brief (per `docs/audit/39_calculation_flow_map.md` §"Inline-legacy rationalisation — deferred"). Spirit of Rule 14 is preserved: the silent-drift risk is absent because inline-legacy doesn't share the comfort-band setpoint contract in the first place; there's nothing to drift between.

  Once the inline-legacy rationalisation follow-up lands, the setpoint override should be ported into inline-legacy alongside its consumption of `comfortBand`.

- **`_calculateState3` (Brief 28f State 3):** ✓ — `state2Recompute` closure constructed inside `_calculateState3` so `systemsEngine.computeSystemsDelivered` can request State 2 recompute at any system's setpoint. Closure approach avoids circular imports between `instantCalc.js` and `systemsEngine.js`.

### Wire-in to `_calculateState3`

`consumption.brief40` attached as a sibling to the existing Brief 38 polish `consumption.space_heating` / `.space_cooling` / `.dhw` blocks. Value is the `computeSystemsDelivered` return shape (§6) when `building.systems_config_v40` is non-empty for any service; `null` otherwise. Existing consumers (Sankey, Live Results, Heat Balance) read the unchanged Brief 38 polish blocks — Brief 40 Part 3 UI consumes `consumption.brief40` for the new per-service sections + comfort-vs-setpoint diagnostic panel.

### Build verification

`npm run build` clean. 3186 modules transformed; 2.51 MB JS (gzip 698 kB) — ~10 kB JS growth from `systemsEngine.js`. No new lint / type errors.

---

## §10. Out of scope (explicit)

Per Brief 40 Principles 1, 4 and "What MUST NOT happen":

- Dynamic-side code (`sql_parser.py`, `epjson_assembler.py`, simulation API endpoints) — frozen
- Renewables (PV, solar thermal) — follow-up brief
- Heat networks at the network level — `district_heating` / `district_cooling` are treated as sources with an efficiency and loss factor; no network-side modelling
- Priority + capacity stacking, lead/lag, schedule-based system handoff — proportional split only
- Calibration of Bridgewater post-migration numbers to match pre-migration figures — any movement is explained from first principles, not calibrated
- Inheritance patterns — "follow comfort band" is a `setpoint: null` per-system flag, not a live link
- `balanced_mechanical` or any other systems concept into the envelope path (per CLAUDE.md Module scopes Building section)

---

## §11. Open questions parked for Part 2/3 (not blockers on Part 1)

- **DHW setpoint range:** the schema permits `setpoint` < 60 but the UI should warn (legionella risk above 50°C circulation, below 60°C storage). Part 3 UI work.
- **Ventilation `flow_rate_basis: 'constant'`:** units assumed l/s; clarify in Part 3 UI label.
- **Per-service shared fuel kWh:** when heating and DHW both burn gas, do the kWh roll into one `gas_kWh` figure in `totals.fuel_split`? Yes — `fuel_split` is summed across services per `source`. Confirmed in §3 / §6.
- **Recovery credit composition:** the rule in §3.2 (sum kWh, not %) matches CIBSE TM38 conventions. Confirmed.

---

## §12. DHW demand basis — refinement during Part 2

Part 1's original schema specified `demand_litres_per_m2_day` as the sole DHW demand basis. During Part 2 implementation it surfaced that the modern engine's `_calculateState3` (line 3945+) uses a **per-occupant-hour** DHW formula (`dhwKwhPerPersonHour(litres_per_person_per_day, store_temperature_c, cold_mains_temperature_c)` at line 3967), driven by `annual_occupant_hours`. The `DHW_LITRES_PER_M2_DAY = 1.1` constant only fires in two inline-legacy paths (`_calculateDegreeDay` lines 4681 and 5522).

Forcing all projects onto a per-m² basis at migration time would mean translating Bridgewater's per-person-driven DHW into a synthetic per-m² figure — a number change that conflates the per-person-vs-per-m² basis switch with the tap-mix correction. Principle 6 (no calibration) requires *one* number-change at a time so the falsifiable verification is clean: pre-Brief-40 DHW × `hot_fraction` = post-Brief-40 DHW.

**Resolution (option B, authorised chat-form 2026-05-19):** the schema gains `demand_basis: 'per_m2' | 'per_person'` with the corresponding `demand_litres_per_m2_day` or `demand_litres_per_person_per_day` field populated. The tap-mix correction (§4.1) is basis-independent — `hot_fraction` multiplies `total_tap_litres_per_day` regardless of how it was computed.

Migration policy:
- Bridgewater (hotel) → `demand_basis: 'per_person'`, `demand_litres_per_person_per_day` populated from pre-Brief-40 engine value (80 default). Preserves pre-Brief-40 DHW shape modulo the tap-mix correction.
- New projects: building-type-driven default at creation (hotel → `per_person`, office / other → `per_m2`).
- User can switch basis post-creation; the engine treats the switch as a schema change (not a migration) and the resulting DHW figure reflects whatever was set.

This refinement does not require re-doing Part 1's commit. The CLAUDE.md "Module scopes" Systems section already says "DHW point-of-use η" generically and doesn't specify the demand basis. The audit doc above (§2.3 + §4 + §7) captures the per-basis schema; Part 2's commit message documents the schema change.

Reasoning logged for the brief archive: keeping basis-where-the-engine-is preserves the tap-mix correction as the only DHW change at migration, so Principle 6 (no calibration) can be honoured cleanly. Bridgewater post-Brief-40 DHW thermal = Bridgewater pre-Brief-40 DHW thermal × `hot_fraction`; that's the falsifiable verification target for Part 5.
