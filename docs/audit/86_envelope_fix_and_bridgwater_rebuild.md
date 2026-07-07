# Audit — Brief 86: Envelope-Only Heat-Balance Fix + HIEX Bridgwater Rebuild + Persistence

Branch: `feat/envelope-fix-bridgwater-rebuild` (cut from `feat/energyplus-validation` tip `7b9b252`).

## Part 2 — Envelope-only heat-balance 500: DIAGNOSIS (no assembler change required)

**Brief premise:** "the envelope-only epJSON assembler simply isn't requesting [Zone Mean Air
Temperature]... Fix the assembler." **Finding: the premise does not hold for this codebase.**

### Evidence
1. `nza_engine/generators/epjson_assembler.py:1719` emits `"Output:Variable": _output_variables()`
   **unconditionally** — for every `mode`, including `envelope-only`. No mode guard.
2. `_output_variables()` (line 658) already lists `Zone Mean Air Temperature` **and**
   `Zone Operative Temperature` at Hourly. `key_value: "*"`.
3. Git: that request was added **2026-05-12** in Brief 26 Part 6 (`a5f16ef`). `assemble_epjson`
   is the **only** epJSON builder — there is no separate envelope-only assembler missing it.

### Actual cause of the 500
The `GET /api/projects/{id}/simulations/{run_id}/balance?mode=envelope-only` endpoint
(`api/routers/projects.py:788`) does **not** run a sim — it reads an **existing** run's
`eplusout.sql` and re-interprets it. The only completed run on disk for the HIEX Bridgwater
project (`12cf7cc4…`) is **`683c1509`, dated 2026-04-04** — a *full-mode VRF* run created a month
**before** the temp-output feature existed. Its `input.epJSON` requests **0** temperature
variables; its SQL contains none (20 vars, all energy/flux). There are **zero** envelope-only
runs for the project. `_get_heat_balance_state1` (`sql_parser.py:1539`) therefore correctly raises
— the temperature genuinely isn't in that stale SQL.

**Conclusion:** the parser is correct; the assembler is correct; the SQL is stale. The fix is to
produce a **fresh envelope-only run** with the current assembler — which requires the project's
geometry/fabric, lost in the machine migration and rebuilt in Parts 3–5. Part 2's "re-run → 200"
verification is thus **gated on the rebuild**; the assembler edit the brief describes is a no-op.
Re-sequenced (Chris, 2026-06-25): rebuild first, verify envelope-only 200 after.

### JSX half (buildingSections.jsx ~line 990)
No stray `>` found on this branch; the file already contains escaped `&gt;` occurrences and
`npm run build` is **clean** (exit 0, no JSX warnings). Considered already-resolved; line numbers
have drifted since the brief was authored.

## Part 3 — Rebuild geometry + fabric — DONE; also closes Part 2 verification

Source of truth: Chris's **HIX Static Model** (`26002-…-5000_P02`) — the canonical first-principles
validation spreadsheet — plus the BRUKL Apr-2019 fabric schedule. Decisions confirmed with Chris
(2026-06-25): area-weighted single glazing; GIA 4,215; geometry chosen to honour GIA under NZA-Sim's
hard `GIA = L×W×num_floors` rule (no manual-GIA override exists — `sql_parser.py:563,580`).

### Inputs written (DB — project `12cf7cc4…`)
| Field | Value | Source |
|---|---|---|
| Geometry | L 58.8 × W 14.34 × **5 floors** × h 3.2 → **GIA 4,216 m²** | static model footprint; 5 floors to hit GIA 4,215 |
| Orientation | 42° CW from N | static model |
| WWR N/E/S/W | 0.55 / 0.10 / 0.38 / 0.11 | static model |
| U-values | wall 0.14, roof 0.15, ground 0.13, glazing 1.4 (g 0.55) | BRUKL Apr-2019 area-weighted |
| Infiltration | permeability 4.64 ÷20 → **0.232 ACH** | CIBSE n50/20 (static model) |
| Comfort band | 21 / 24 °C | static model |
| Shading | overhang 0.5 m, fins 0.5 m all façades | static model |
| Openings | `{}` (sealed) | brief — capability left intact |
| Weather | Yeovilton TMYx (on disk) | brief/static model |

Note: building is genuinely **5 storeys** — 4 floors of bedrooms over an all-communal ground floor
(confirmed by Chris with site photo, 2026-06-25). So 5 floors is the real geometry and GIA 4,216 is
legitimate; the static model's "4 floors" counted only the room floors. The GF being communal (not
bedrooms) is a Part-5 loads nuance, not a geometry one.

### Fabric build-ups (new library constructions)
Added `bridgwater_ext_wall` / `_roof` / `_ground_floor` / `_glazing` to **both**
`nza_engine/library/constructions.py` (EnergyPlus build-ups — the assembler reads this module, and
**ignores `u_value_override`** per `epjson_assembler.py:130`) **and** the DB `library_items` (parser
`_u_value` + frontend). Opaque build-ups = precast-concrete mass layer INSIDE a tuned NoMass
insulation layer, so thermal mass couples to the zone (relevant to the Brief 84b/85 mass work).
Nominal U (incl. ISO 6946 films) verified exact: 0.140 / 0.150 / 0.130; glazing U1.4/SHGC0.55.

### Verification (falsifiable)
- Fresh **envelope-only** EnergyPlus run succeeds; SQL now contains `Zone Mean Air Temperature`
  (5 zone entries) → **Part 2's 500 cause removed**.
- **Live HTTP**: `GET …/balance?mode=envelope-only` → **200** (run `2e9d639f`); full-mode → 200 (no
  regression). state=1, heating 113.0 MWh / cooling 141.7 MWh.
- Per-element losses (MWh): wall 20, roof 13, ground 11, glazing 128, fabric-leakage 102 — right
  order of magnitude and scale correctly vs the static model's 4-floor engine column
  (16.5 / 11.1 / 15.3 / 83 / 59) given the larger 5-floor envelope. Cooling > heating with
  free-running summer max 38.9 °C reproduces the "envelope runs hot" finding.

**Not yet version-controlled:** the geometry/fabric assignment lives only in the DB (gitignored).
The committable artifact is `constructions.py`. Persisting the full input set is Part 6.

### Infiltration correction (during Part 4)
Part 3 first used the static model's **0.232 ACH** (= q50 ÷ 20). The canonical seed + current engine
(`deriveOperationalACH`, `instantCalc.js:386`) derive it correctly from q50: `n50 = q50 × A_env/V`,
then ÷20 — the static model's q50÷20 treats a per-area number as per-volume. Chris's call
(2026-06-25): use the engine-derived value. Set `building.fabric.air_permeability_q50 = 4.64`; for
this geometry A_env 4,026.9 m² / V 13,491 m³ → n50 1.385 → **operational 0.0692 ACH**. Also wrote
`infiltration_ach = 0.0692` so the EP State-1 parser (reads ACH directly) stays consistent with the
static engine. Re-verified envelope-only: fabric-leakage 102 → **42 MWh**, heating 69 / cooling 162 MWh.

## Part 4 — Rebuild systems — DONE (schema); fuel split verified in Part 5

Restored the canonical Bridgewater systems (lost in migration — the v25→v40 migration had found "no
systems_config_v25"). Source: `scripts/seed_bridgewater_v25_systems.mjs` (BRIDGEWATER_V25) +
`systemTemplatesLibrary.js`. Wrote `building.systems_config_v25` (verbatim from the seed), then ran the
tested `40_bridgewater_systems_migration.py` + `42_systems_ux_migration.py` to produce
`systems_config_v40` (schema_version 2). Kept Part 3's real constructions — NOT the seed's
`u_value_override` fabric (the EP assembler ignores overrides; Part 3's build-ups are strictly better).

| Service | Systems (v40) |
|---|---|
| Heating | VRF heat-recovery **SCOP 5.12** (95%) + electric panel 1.0 (5%); setpoint 21 |
| Cooling | VRF **SEER 3.51** (95%) + DX split 5.62 (5%); setpoint 25 |
| DHW | 60% ASHP (SCOP 3.0) + 40% gas (0.90); 80 L/p/day, store 60 °C, mains 10 °C |
| Ventilation | MVHR 1425 l/s 80% HR SFP 1.4; bedroom extract 2208 l/s no-HR SFP 0.4; public-WC extract 210 l/s SFP 0.4 — all 8760 h |

Verified: v40 produced with correct sources/shares/efficiencies (table above).
**Fuel-split note:** ~70% elec / 30% gas only emerges *after* Part 5 adds small power (~186 MWh elec).
Systems-only, gas (40% of DHW) dominates a small denominator — the 70/30 is a Part-5 verification.
Config is DB-only (Part 6 persists it).

### v40 schema-drift bug (resolved)
First calibration run returned **0 delivered energy for heating/cooling/DHW** (demand computed fine:
heating 91.5, cooling 121.6 MWh). Cause: the Python `40_bridgewater_systems_migration.py` (Brief 40)
produces a v40 whose DHW-demand + setpoint fields sit on the **per-system** entries, but the current
(Brief 85) `systemsEngine.js` reads them at **service-level** (`dhw_demand_litres_per_person_per_day`,
`heating_setpoint_c`, …) — Brief 42's reorg. The Python `42_systems_ux` chain wouldn't lift them
headlessly (schema_version stamping inconsistent — 3 attempts). **Fix:** built the v40 service-level
fields directly (DHW per-person 80 L/day, store 60, mains 10; setpoints follow-comfort 21/24;
schema_version 2) and stripped the stale per-system fields. Engine then computes all services.

## Part 5 — Loads + calibration — DONE (gap reported, NOT forced)

Loads written to `building_config.gains`: LED lighting **LPD 2 W/m²** (daylight 0.7); small
power/equipment baseload **5.04 W/m²** → **186.1 MWh** (brief's ~186 ✓); occupancy 138×2 @ 75 W/p.

### Bottom-up result (static engine, full mode)
| End use | Delivered MWh |
|---|---|
| Heating (VRF 5.12 + panel) | 21.5 |
| Cooling (VRF 3.51 + DX) | 34.0 |
| Fans (MVHR + 2 extracts) | 25.9 |
| DHW | 57.2 elec + **124.8 gas** |
| Lighting (LED) | 14.0 |
| Small power | 186.1 |
| **Total** | **463.6** → **EUI 110 kWh/m²** |

Targets met: **fuel split elec 73% / gas 27%** (≈70/30 ✓); **gas 124.8 MWh** (≈ brief anchor 134.8 ✓);
small power 186 MWh ✓.

### The 110 → 180 gap — reported from first principles, not forced (Chris, 2026-06-25)
Closing to metered 180 needs **~295 MWh (70 kWh/m²) of inferred base load — larger than every modelled
end-use combined.** Two first-principles reasons forcing it is wrong (brief escalation clause):
1. **It would break the validated fuel split.** The inferred base load is electricity (auxiliary). The
   model *already* reproduces 73/27 and the 125 MWh gas DHW at EUI 110. Adding 295 MWh elec drives the
   split to ~84/16 — distorting exactly what's currently correct. So EUI-180 and 70/30 are mutually
   inconsistent under a pure-electricity base load: the metered 180 is not explained by more auxiliary.
2. **Heating looks under-counted.** Heating is only 21.5 MWh, yet the bedroom extract (2208 l/s, no HR,
   8760 h ≈ 230 MWh loss) is meant to *drive* heating (the report's headline finding). The 186 MWh of
   internal gains offsets most of it. If real internal gains are lower / extract-heating higher, heating
   (and the gap) shift. **Candidate gap sources to confirm against sub-metering:** extract-driven
   heating; DHW demand (280 MWh modelled vs static 336); unmodelled hotel loads (kitchen, lifts,
   external lighting, IT, laundry). **Recommendation:** confirm the metered elec/gas split and the
   extract-heating against measured data before any base-load addition.

**Verification status vs brief:** fuel split ✓, gas anchor ✓, small power ✓; **EUI ±2% of 180 NOT met
by design** — gap reported per the escalation clause. Calibration harness: `scripts/_brief86_calibrate.mjs`.
Config is DB-only (Part 6 persists it).

## Part 6 — Input persistence — DONE (closes the failure this brief exists for)

The whole rebuild lived only in the gitignored DB. Part 6 makes it recoverable from one committed file
so a machine migration can never lose it again.

- `scripts/export_project_inputs.py <id>` → a single JSON capturing the full input set: all project
  columns (building_config incl. geometry/fabric/`systems_config_v25`+`v40`/loads/schedules,
  construction_choices, comfort band, weather) **plus the per-project custom constructions** (so the
  snapshot is self-contained — parser U-values + frontend resolve without relying on DB seed state).
- `scripts/import_project_inputs.py <snapshot> [--id --name]` → recreates the project + constructions
  (upsert). The recovery path: empty DB + one committed file → fully-configured project.
- Committed snapshot: **`projects/snapshots/bridgewater_hotel.json`** (tracked dir, not gitignored).

**Round-trip verified (falsifiable):** imported the snapshot to a throwaway id, re-exported, and the
`building_config`, `systems_config_v40`, constructions, and comfort/weather are **byte-identical**;
running the engine on the restored project gives **EUI 110 — identical to the original**. Throwaway
project deleted.
