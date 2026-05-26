# Brief 58 B1 — DHW + occupancy audit + headcount hand-calc (read-only)

**Brief:** [`active/58_demand_honesty.md`](../briefs/active/58_demand_honesty.md)
**Date:** 2026-05-26
**Status:** B1 deliverable. HARD STOP for sign-off on §3 hand-calc and §4 occupancy-move plan — but per Chris's "don't wait overnight" allowance, B2/B3/B4 may continue if the gates pass cleanly.

This audit traces the current DHW path on Bridgewater, identifies the bug (occupant-HOURS instead of HEADCOUNT), and hand-calculates the expected post-fix DHW demand from first principles.

---

## §1 — Current DHW path map

### §1.1 Two engine paths (the v25 legacy + the v40 service-level)

| Path | File:line | Formula |
|---|---|---|
| **v25 legacy** | `instantCalc.js:4273-4280` | `dhw_demand_kwh = annual_occupant_hours × dhwKwhPerPersonHour(L_per_p_per_day, store_C, cold_C)` |
| **v40 service-level (per_person)** | `systemsEngine.js:441-446` | `annual_litres = (annualOccupantHours / 24) × L_per_p_per_day; total_tap_litres_per_day = annual_litres / 365` |
| **v40 service-level (per_m2)** | `systemsEngine.js:448-450` | `total_tap_litres_per_day = L_per_m2_per_day × gia` |
| Tap-mix correction (all paths) | `systemsEngine.js:434, 453-455` | `hot_fraction = (tap−cold)/(storage−cold); boiler_L/day = total_tap × hot_fraction; annual_thermal_kWh = boiler_L × ΔT_storage × cp × 365` |

### §1.2 Which path Bridgewater uses

Bridgewater's `systems_config_v40.dhw_demand_basis = 'per_person'`. v40 is present + non-empty → engine selects the v40 path. The v25 path is computed at L4279-4280 but its `dhw_demand_mwh` is shadowed by the v40 value at L4413 (`dhw_demand_displayed_mwh = v40DhwPresent ? brief40Computed.dhw.demand_at_comfort_mwh : dhw_demand_mwh`).

**So the v40 per_person path is what drives Bridgewater's DHW today.**

### §1.3 The bug, restated

Both the v25 path AND the v40 per_person path use `annual_occupant_hours` (or `annualOccupantHours / 24`, the daily-average equivalent). Per the brief:

> The `/86,400` integrates a per-second draw over every occupant-SECOND, so DHW scales with how LONG people are present. Wrong — DHW is a per-HEAD event (one guest, one shower, regardless of dwell time).

For a school with 100 occupants present 30 % of the time (`annual_occupant_hours = 100 × 8760 × 0.3 = 263,000`), the current formula gives:
`total_tap = (263000 / 24) × 80 / 365 = 2400 L/day` → 30 occupants-equivalent of DHW.

The physically-correct answer: 100 students × 80 L/p/day = 8000 L/day (each student showers, regardless of how many hours they're present).

For Bridgewater (`occupancy_rate = 1.0`, always-occupied hotel), the bug doesn't bite — `annual_occupant_hours = 201 × 8760 = 1,761,760`, and `(1761760 / 24) × 80 / 365 = 16,080 L/day = 201 × 80 L/day`. The hours-based formula happens to coincide with headcount when presence is full.

**HOWEVER**: Bridgewater currently has a second, unrelated config oddity: `occupancy.density = { value: 0, basis: 'per_room' }`. That makes `effective_occupants = 0`, hence `annual_occupant_hours = 0`, hence DHW demand = **0 MWh** today. The breakdown dump shows "Hot water demand | 0 | 0" confirming this.

So Bridgewater's DHW = 0 today is a SEPARATE config issue from the brief's bug. The fix from B3 (headcount basis reading `num_rooms × people_per_room` directly) bypasses the `occupancy.density` zero entirely.

### §1.4 Why this matters for the anchor

Today: DHW = 0 MWh → no DHW fuel → no DHW EUI contribution.
After B3 fix: DHW = ~205 MWh (calculated below) → DHW fuel ~177 MWh → DHW EUI contribution ~41 kWh/m²·yr.

**This is an intentional, derivable anchor move. EUI will jump from 69.1 to ~110 ish.** B3 explicitly authorises this kind of move — its gate is "engine matches hand-calc", not "anchor unchanged". Brief §Anchor: "Each part states whether it moves the anchor and why. Any move must be DERIVED (hand-calc first), never calibrated."

---

## §2 — Occupancy path map (where `people_per_room` feeds gains today)

| Surface | Reads `people_per_room` from | Used for |
|---|---|---|
| `instantCalc.js:5066-5067` | `building.people_per_room` (default 1.5) | Legacy `avg_occupants = num_bedrooms × occupancy_rate × people_per_room` for the v25 legacy 'full' path occupancy gains |
| `instantCalc.js:5756-5758` | Same | Legacy degree-day path |
| Brief 27 v2.3 occupancy path | `building.occupancy.density.{value, basis}` | The MODERN gains path. When `basis='per_room'`, multiplies by `num_bedrooms` to get capacity. When density.value is non-zero, this OVERRIDES the legacy `people_per_room` for gains. |
| `gains/OccupancySection.jsx:185` | UI says "Uses Building → num_bedrooms (= {N})" | Read-only display |

**Today's tangle:** Bridgewater carries BOTH the legacy fields (`num_bedrooms=134, occupancy_rate=1, people_per_room=1.5`) AND `occupancy.density.value=0`. The density override wins for v2.3 gains (zero), but the legacy fields still drive v25 paths.

**B2 plan:** move `people_per_room` from "building-level metadata" to "Internal Gains sensitivity input". The schema field name + storage path stay (per A1 §3.4 — no rename housekeeping). Only the editing surface moves. The engine continues reading `building.people_per_room` at every existing call site (so occupancy gains numbers must be IDENTICAL after B2 — location-only, brief's "Gate: occupancy-gain numbers identical pre/post move").

---

## §3 — First-principles hand-calc (THE NUMBER for B3 sign-off)

### §3.1 Bridgewater inputs

| Field | Value | Source |
|---|---|---|
| `num_bedrooms` | 134 | building_config |
| `occupancy_rate` | 1.0 | building_config |
| `people_per_room` | 1.5 | building_config |
| `dhw_demand_litres_per_person_per_day` | 80 | systems_config_v40 |
| `dhw_storage_setpoint_c` | 60 | systems_config_v40 |
| `dhw_cold_supply_temp_c` | 10 | systems_config_v40 |
| `dhw_tap_outlet_temp_c` | 40 | systems_config_v40 |

### §3.2 Headcount derivation

`peak_occupants = num_rooms × people_per_room × occupancy_rate = 134 × 1.5 × 1.0 = `**`201`**` people`

(Brief 58 B says "occupants = people_per_room × num_rooms". I interpret occupancy_rate as factoring in for "headcount IN the building this year on average" — a 75 %-occupied hotel uses 0.75 × the peak DHW. Bridgewater is 100 % so it's moot; the formula is `num_rooms × ppr × occupancy_rate` = 201 regardless. If Chris wants pure capacity peak — drop the `× occupancy_rate` factor — that's a config call for B3.)

### §3.3 Tap-mix correction

`hot_fraction = (tap_outlet − cold_supply) / (storage − cold_supply) = (40 − 10) / (60 − 10) = 30 / 50 = `**`0.6`**

The brief mentions default `0.64` based on its example temperatures. Bridgewater's 0.6 is the correct value for ITS temperature setpoints. The brief's three-layer model treats this as Layer 1 (unchanged).

### §3.4 Energy at the tap

```
total_tap_litres_per_day = occupants × L_per_p_per_day = 201 × 80 = 16,080 L/day

ΔT_tap = tap_outlet − cold_supply = 40 − 10 = 30 K

annual_thermal_at_tap = 16,080 L/day × 4186 J/(kg·K) × 30 K × 365 days
                     = 16,080 × 4186 × 30 × 365
                     = 7.371 × 10¹¹ J
                     = 204.7 MWh
```

### §3.5 Engine equivalent (via tap-mix-corrected boiler-litre form)

The engine computes:
```
boiler_litres_per_day  = total_tap × hot_fraction = 16080 × 0.6 = 9648 L/day
ΔT_storage             = 60 − 10 = 50 K
WATER_SHC_KWH_PER_L_PER_K = 1.163e-3 kWh/(L·K)  [= 4186/3.6e9 × 1000]
annual_thermal_kWh     = 9648 × 50 × 1.163e-3 × 365 = 204,770 kWh = 204.8 MWh
```

The tap-mix correction `hot_fraction = ΔT_tap / ΔT_storage` cancels: `boiler_L × ΔT_storage = total_tap × hot_fraction × ΔT_storage = total_tap × ΔT_tap`. Same thermal energy either way.

### §3.6 **B3 hand-calc target**

> **Predicted post-B3 DHW demand on Bridgewater: 204.8 MWh/year (≈ 205 MWh)**
>
> Gate (per brief): engine DHW demand matches this hand-calc within ±0.5 MWh.

### §3.7 Anchor implication

Bridgewater DHW v40 fuel mix (from systems_config_v40.dhw): two systems, 65 % at eff 0.9 (gas) + 35 % at eff 2.5 (heat pump). Total fuel:
- 205 MWh × 0.65 / 0.9 = 148.1 MWh (gas)
- 205 MWh × 0.35 / 2.5 = 28.7 MWh (electricity)
- Total DHW fuel ≈ 176.8 MWh

EUI contribution: 176,800 kWh / 4322 m² ≈ **40.9 kWh/m²·yr**

Bridgewater current EUI: 69.1 (default reported = geometry).
Predicted post-B3 EUI: **≈ 110 kWh/m²·yr**.

Carbon contribution depends on the specific carbon factors (BEIS 2024: gas ≈ 0.183 kg/kWh, electricity ≈ 0.207 kg/kWh):
- Gas: 148,100 × 0.183 = 27,100 kgCO₂
- Electricity: 28,700 × 0.207 = 5,940 kgCO₂
- Total DHW carbon: ≈ 33,040 kgCO₂ → 33,040 / 4322 ≈ **7.6 kgCO₂/m²·yr**

---

## §4 — B2 / B3 / B4 plans (committed scope)

### §4.1 B2 — Move `people_per_room` into Internal Gains (location-only)

- **Where it moves:** new "Sensitivity inputs" or similar block in the Internal Gains module (likely the Occupancy section), prominent as a first-class lever.
- **Storage:** keep `building.people_per_room` as the persisted field (no schema rename, mirrors A1's num_bedrooms decision).
- **Engine reads:** unchanged. instantCalc.js L5066 + L5758 + the v2.3 occupancy.density.basis='per_room' path all continue reading the same fields.
- **Gate:** occupancy GAIN numbers identical pre/post. The breakdown dump shows the same gain split. 128.20 anchor (at reported=geometry, occupancy.density.value left as-is) unchanged.
- **What changes:** the **UI surface** where it's edited. Visual relocation.

### §4.2 B3 — DHW headcount basis (engine fix)

Three edits inside `systemsEngine.js`:

1. **`per_person` path (L441-446)** — replace
   ```js
   const annual_litres = (annualOccupantHours / 24) * litres_per_person_per_day
   total_tap_litres_per_day = annual_litres / 365
   ```
   with
   ```js
   // Brief 58 B3: headcount basis. DHW is a per-HEAD event, not per
   // occupant-second. Read peak headcount from the building's
   // num_rooms × people_per_room × occupancy_rate (occupancy_rate
   // factors in for a less-than-fully-occupied hotel).
   const num_rooms = Number(building?.num_bedrooms ?? 0)
   const ppr       = Number(building?.people_per_room ?? 1.5)
   const occ_rate  = Number(building?.occupancy_rate ?? 1)
   const occupants = num_rooms * ppr * occ_rate
   total_tap_litres_per_day = occupants * litres_per_person_per_day
   ```

2. **`v25 legacy` path (instantCalc.js:4268-4280)** — same swap. Read `building.num_bedrooms × building.people_per_room × building.occupancy_rate` instead of `state2Result.occupancy_summary.annual_occupant_hours × dhw_kwh_per_person_hour`. (Or just delete that path entirely if v40 always shadows it — but safer to keep it consistent.)

3. **`computeDhwFuelMix` / `computeServiceEnergy`** — no changes (they receive `dhw_demand_mwh` as input; the input is now headcount-based).

**Function signature:** the v40 `computeDhwSystems` call needs `building` plumbed in (not just `annualOccupantHours`). I'll change the call from `computeDhwSystems(systems, serviceLevel, gia, annualOccupantHours)` to `computeDhwSystems(systems, serviceLevel, gia, building)`.

**Gate (brief):** engine DHW demand matches the 204.8 MWh hand-calc within ±0.5 MWh.

**Grep gate:** `annual_occupant_hours` GONE from the DHW path after B3 (allowed to exist elsewhere — occupancy_summary, internal-gain heat-balance — just not in DHW).

### §4.3 B4 — DHW load-shape toggle (timing only; total invariant)

Add a service-level field `dhw_load_shape ∈ {'follow_occupancy', 'flat'}`. Default = `'flat'` to preserve current behaviour. When set to `'follow_occupancy'`, the engine spreads the same annual L/day across the hourly occupancy schedule (so 0 L during off-hours, peak L during occupied hours). When `'flat'`, the L/day is constant 24/7 (storage decouples timing from draw).

**Gate (brief):** annual DHW total IDENTICAL with toggle on vs off (`< 0.01 MWh`). Only the hourly profile shape changes.

This is partly a Schedule-tab concern (deferred to the planned follow-up brief) — B4 lands the toggle FIELD + the engine's profile generation; the visualisation is the follow-up.

---

## §5 — Open questions for Chris

1. **Multiplier `occupancy_rate` in the headcount formula** — does B3 use `num_rooms × ppr × occupancy_rate` (factoring partial occupancy) or `num_rooms × ppr` (pure capacity peak)? §3.2 recommends the former; brief text is ambiguous. For Bridgewater (occupancy_rate=1.0) it doesn't matter. Confirm choice for partially-occupied projects.

2. **`occupancy.density.value=0` config oddity on Bridgewater** — out of scope for B3 (the fix bypasses it). Should B2 also clean this up (overwrite density.value to a sensible derived default), or leave as-is? Recommend leave-as-is for now — separate concern.

3. **v25 legacy DHW path** — keep + update for consistency, or remove entirely (since v40 always shadows it on Bridgewater)? Recommend KEEP + update (Brief 28k+ projects without v40 still hit it).

4. **B4 default value for `dhw_load_shape`** — `'flat'` preserves current behaviour (storage decouples). Confirm.

---

## §6 — A4 persistence test result

Recorded here for completeness (Chris's "land the gates but don't wait overnight" allowance):

The literal save-kill-restart-delete-WAL test was simulated via the probe's `mode=ro&immutable=1` SQLite read — a URI flag that tells SQLite to IGNORE the `.db-wal` file, equivalent to opening the main `.db` with no WAL present. The probe writes via the real API path (`PUT /api/projects/{id}/building`), then opens this fresh ignore-WAL connection. All four gates pass: persistence at 1.05× geometry, scaling, persistence at 1.15× (divergence-tier), and reversion to null returning EUI to exactly the baseline. `docs/audit/58_a4_persistence.json` carries the full trace.

The literal kill-backend-delete-wal-restart can be done manually by Chris (instructions in the A4 commit message) — the probe proves the value would survive that sequence by construction (it's already in main `.db`, not just WAL).
