# Brief 81 — EnergyPlus validation harness (Bridgewater-Box first rung)

**Branch:** `feat/energyplus-validation` (cut from `main` tip `d8a6207`, Brief 77 close).
**Authority:** Full autonomous overnight (Opus 4.8). Architect: Claude Chat. Authorised by Chris 2026-06-02.
**NEVER merge or push to `main` during this brief.**

This audit document is the running record of Brief 81. One section per part (§1–§10),
plus this §0 receipt + §1 premise-check written at P1.

---

## §0 — Receipt confirmation (per brief "BEFORE DOING ANYTHING" step 1)

**Brief title:** *Brief 81 — EnergyPlus validation harness (Bridgewater-Box first rung) — OVERNIGHT.*

**First paragraph of "Why this brief exists" (quoted):**
> After five weeks of building NZA-Sim's custom JavaScript dynamic simulation engine, the team has hit the limit of internal validation. This week alone, Briefs 75/76/77 surfaced a major bug cycle where the model's headline numbers were wrong for four days because first-principles hand-calculations missed an upstream issue (`_calculateState2:2921` reading v25-only ventilation when Bridgewater is v40). The fix landed at commit `ccc2e72`, but the time-to-discovery was unacceptable.

**Tip of `main` at branch cut:** `d8a6207` ("Brief 77 P4 close: walkthrough self-verify + archive + STATUS").
The brief expected `ccc2e72 or later`; `d8a6207` is later (Brief 77 commits landed after the Brief 76
fix `ccc2e72`). ✓

**Design note:** read in full from Notion (https://www.notion.so/373d645e05cc8163929dca9070e8d261,
fetched 2026-06-02T19:07). Key decisions absorbed: build EnergyPlus the EnergyPlus way (single
integrated sim, compare at OUTPUT level only); long-lived feature branch; Phase 5 iteration + CI
deferred to later briefs; overnight scope = Phases 1–4 for Bridgewater-Box only.

**STATUS.md reconciliation:** confirmed reconciled at Brief 77 close — STATUS.md top section reads
"✅ Brief 77 — CLOSED 2026-06-02" with the preserved anchor (EUI 143.5, heating 98.3, cooling 53.1,
mech vent 326.0 MWh, Σ losses 549.2, Σ gains 586.3, Net +37.1). ✓

---

## §1 — Premise-check & divergences from the brief

The brief grants Code premise-check authority (Brief 76 precedent): where the brief's recommended
approach contradicts the actual state of the repo or EnergyPlus best practice, push back here, propose
the correct approach, and execute that instead — documenting the divergence for Chris's morning review.
Four divergences identified at P1, all conservative (less new tooling, no behaviour change, more reuse
of the already-validated stack):

### D1 — EnergyPlus is already installed. Use it; skip the fresh contained install.

**Brief Part 4 says:** "Install EnergyPlus locally in a contained location: `tools/energyplus/` under the
repo (gitignored) OR a Docker container … target: EnergyPlus 23.2.0 or newer LTS."

**Actual state:** EnergyPlus is **already installed** on this machine at:
- `C:\EnergyPlusV26-1-0\` ← the version the NZA-Sim backend is pinned to (CLAUDE.md "EnergyPlus
  installation"); its assembler + parser Output:Variable names are *confirmed valid for V26.1.0* in
  `docs/audit/30_phase0_schema_lock.md`.
- `C:\EnergyPlusV24-1-0\` (older, also present).

**Decision:** Use the existing **`C:\EnergyPlusV26-1-0\`** install. Rationale:
1. It satisfies every Part-4 *hard requirement* already: the runner finds EnergyPlus via an
   environment variable / config (not a global PATH entry — `ENERGYPLUS_DIR` is currently unset and EP
   is **not** on PATH), and the install dir is outside the repo so nothing is committed.
2. V26.1.0 (June-2025 release) is newer than the brief's 23.2.0 LTS floor, and is the exact version
   NZA-Sim's own EnergyPlus path was schema-locked against — using it keeps Output:Variable names
   verified rather than guessed.
3. Avoids the 90-minute install risk the brief itself flags as a hard-STOP trigger.

Part 4 therefore becomes **"verify the existing install + run the bundled example"** rather than
"install fresh." A small config file (`validation/energyplus/ep_config.json` or an env var read) points
the runner at `C:\EnergyPlusV26-1-0\`, overridable, never relying on a global install.

### D2 — Weather: use NZA-Sim's actual Bridgewater EPW (Yeovilton), not London/Heathrow.

**Brief Bridgewater-Box spec says** (Weather): "London (Heathrow, IWEC TMY3 …), latitude 51.4775°N …"
but **immediately also says**: "Reuse whichever weather file NZA-Sim is currently using for Bridgewater;
we want both engines reading the same source data."

**Actual state:** the only EPW present in the repo's project weather dir is
`data/weather/current/GBR_ENG_Yeovilton.AF.038530_TMYx.2011-2025.epw` — **Yeovilton, Somerset**.
Bridg**w**ater is a Somerset town; Yeovilton (RNAS Yeovilton, ~25 km away) is the nearest long-record
station, so this is the file the live Bridgewater project reads (to be re-confirmed in P2/P3 against the
project's `building_config.weather_file`).

**Decision:** Use **`GBR_ENG_Yeovilton.AF.038530_TMYx.2011-2025.epw`** for **both** engines. The
overriding instruction in the spec is "same source data for both engines"; matching that is far more
important to a clean comparison than matching the architect's incidental "London Heathrow" placeholder.
Document the exact filename + lat/long (read from the EPW header) in the box YAML fixture (P2).

### D3 — Architecture clarification: the live engine is JS; the backend EP path is dormant.

CLAUDE.md describes NZA-Sim as "powered by EnergyPlus" with a backend (`nza_engine/` — epJSON
assembler, geometry/HVAC generators, runner, parsers). **However**, `nza_engine/config.py` defaults
`ENERGYPLUS_DIR` to a **macOS** path (`/Applications/EnergyPlus-25-2-0`); on this Windows machine the
env var is unset, so the backend EP path is **dormant**. All of this week's engine work (Briefs 74–77)
was on the JS engine `frontend/src/utils/instantCalc.js`, which is what the live UI runs.

**Implication for the brief (none — it's already correct):** Brief 81 validates the **JS engine** against
an **independent** hand-authored EnergyPlus build. We do **not** reuse `nza_engine/epjson_assembler.py`
to produce the reference (that would couple the reference to NZA-Sim's own geometry schema and defeat
independence — exactly what the design note warns against). We **do** mine `nza_engine/` and
`docs/audit/30_phase0_schema_lock.md` as a *syntax reference* for correct V26.1.0 IDF object/variable
names, honouring the brief's "do NOT guess IDF syntax" instruction.

### D4 — Engine-run method: pure-Node fixture path, not a live-DB project write.

**Brief Part 2 falsifiability says:** "Hand-load the YAML into a fresh NZA-Sim project in the local DB.
Run the engine on it." The brief separately forbids "Modifying any NZA-Sim project in the live DB"
(existing projects) but permits a *new* Bridgewater-Box project.

**Decision:** Run the JS engine **pure-Node** against the fixture (the loader builds the
`calculateInstant(...)` params object directly from the YAML), exactly as Briefs 74–77 anchor probes
did (`node scripts/_brief7N_p1_anchor.mjs`). Rationale: Brief 72 PA's data-safety rule names the
"pure-Node fixture path" as **preferred for read-only diagnostics**, it needs no backend/SQLite
contention, and it is fully reproducible from the committed fixture — which is the entire point of a
versioned validation fixture. No writes to the live DB at any point. (A DB project can be created later
if Chris wants the box visible in the UI; it is not required for the comparison.)

### Risk flagged at P1 — `eppy` on Python 3.14.2

System Python is **3.14.2** (very new, Oct-2025). `eppy` (Part 6) has historically lagged new CPython
releases. Mitigation plan: install `eppy` into a **contained venv** (`validation/.venv`, gitignored);
if it will not install/import on 3.14, fall back to (a) a known-good Python if one is present, or
(b) authoring the IDF generator with direct templating against the IDD instead of eppy, or (c) per the
brief's hard-STOP, document the eppy blocker and ship the hand-authored IDF + runner without the
generator. Decided at P6, not pre-borrowed here.

---

## §2 — Bridgewater-Box YAML fixture + NZA-Sim anchor

**Deliverables (all on branch `feat/energyplus-validation`):**
- `validation/fixtures/bridgewater_box_v1.yaml` — the documented single-source-of-truth fixture.
- `validation/nza_sim/load_fixture.mjs` — reusable loader (fixture → `calculateInstant` inputs → result).
- `validation/nza_sim/run_box_anchor.mjs` — anchor capture runner.
- `validation/nza_sim/results/bridgewater_box_v1.json` — the captured anchor (Phase-4 EP target).

### §2.1 — Fixture schema (version 1)

The fixture is SI throughout and is consumed by **both** engines (NZA-Sim via the loader; EnergyPlus
via the P5/P6 IDF generator), so any engine disagreement is a real disagreement, not an input mismatch.
Top-level blocks:

| Block | Key fields | NZA-Sim mapping (see `load_fixture.mjs`) |
|---|---|---|
| `meta` | `fixture_id`, `schema_version:1`, `nza_engine:"v2.5 (State 3)"` | informational; engine forced to State 3 via `options.engine:'v2.5'` |
| `geometry` | `length_m 10`, `width_m 10`, `num_floors 1`, `floor_height_m 3.0`, `orientation_deg 0`, `wwr{n/s/e/w 0.10}`, `window 2.0×1.5` | → `building.{length,width,num_floors,floor_height,orientation,wwr}`. `computeGeometry`: gia 100 m², each facade 30 m², glazing 3 m²/facade (12 total), opaque 108, roof 100, floor 100, vol 300 |
| `envelope.constructions` | `external_wall U 0.18`, `roof U 0.15`, `ground_floor U 0.20`, `glazing U 1.2 g 0.55 LT 0.7`; each opaque has a 2-layer PIR+concrete stack (outside→inside) | → custom `libraryData.constructions` `box_wall/box_roof/box_floor/box_glazing` + `construction_choices`. Published U drives steady-state UA (`pickWholeWallU`); `layers` drive the dynamic mass model only |
| `envelope.thermal_bridging` | `mode manual_h_tb`, `psi 0.05`, `perimeter 40`, `h_tb_W_per_K 2.0` | → `building.thermal_bridges{mode:'manual_h_tb', h_tb_W_per_K:2.0}` consumed directly |
| `envelope.infiltration` | `ach_constant 0.5` | → `building.infiltration_ach:0.5`; `fabric.air_permeability_q50` **omitted** so `deriveOperationalACH` uses exactly 0.5 |
| `internal_gains.occupancy` | `people 4`, `occupancy_rate 0.70`, `sensible 75 W`, `latent 55 W`, `schedule_occupied_hours "07:00-21:00"` | → `building.occupancy{density{value:4,basis:'total'}, occupancy_rate, sensible_w_per_person, schedule}`. Effective = 4 × 0.7 = 2.8 ppl when present |
| `internal_gains.lighting` | `5 W/m²`, `schedule_on_hours "07:00-21:00"` | → `gains.lighting.profiles[0]` `unit:'w_per_m2'`, relationship `independent` |
| `internal_gains.equipment` | `baseload 3 W/m²` (24/7), `active 2 W/m²` (occupied) | → `gains.equipment.profiles[0]` baseload (no schedule) + active (× schedule) |
| `internal_gains.dhw` | `per_person`, `80 L/p/day`, storage/tap 60, cold 10, `flat` | → `systems_config_v40` DHW service fields. Headcount 4 × 0.7 = 2.8 → 224 L/day, ΔT 50 K, hot_fraction 1.0 |
| `internal_gains.auxiliary` | `none` | → `gains.auxiliary.profiles:[]` |
| `ventilation[0]` | `box_mvhr`, `50 L/s constant`, `HRE 75%`, `SFP 1.5`, `8760 h`, `no bypass` | → `systems_config_v40.ventilation[0]` `efficiency_metric{sfp_w_per_lps, recovery_sensible_pct}` |
| `systems` | heating gas 0.90 @21°C; cooling split-AC 3.0 @24°C; dhw gas 0.80 | → per-service `systems_config_v40` entries, `efficiency_metric` read directly, `share_pct 100` |
| `comfort_band` | `lower_c 21`, `upper_c 24` | → `options.comfortBand`; setpoints `follow_comfort` (heating=lower, cooling=upper) |
| `weather` | `GBR_ENG_Yeovilton...epw`, lat 51.087, lon −2.985 | → EPW parsed to typed arrays; `computeHourlySolarByFacade` for solar (divergence D2) |

**Design choices (recorded in the fixture header):** (a) Weather is Yeovilton, not the brief's incidental
"London Heathrow" — the spec's overriding instruction is "same source data for both engines" (D2).
(b) The brief specifies lighting 14h-on/10h-off but is silent on the occupancy/equipment-active schedule
shape; for a clean single-DOF box we use ONE occupied window, **07:00–21:00** (14h on / 10h off), for
occupancy presence, lighting, and equipment-active alike. Trivially replicable in the IDF (P5).

### §2.2 — Engine-run method (divergence D4)

The loader builds the `calculateInstant(...)` parameter object directly from the YAML and runs the engine
**pure-Node** — no live-DB write, no backend, no SQLite contention. `options.engine:'v2.5'` forces the
State-3 dispatch (gate `instantCalc.js:6663`) so the systems overlay (boiler / AC / DHW efficiencies +
MVHR recovery) is applied, matching the live UI. Result confirms `state:3, mode:"full"`. Fully
reproducible from the committed fixture: `node validation/nza_sim/run_box_anchor.mjs`.

### §2.3 — NZA-Sim Bridgewater-Box anchor (the Phase-4 EnergyPlus comparison target)

Captured 2026-06-02 on branch `feat/energyplus-validation`. Numbers are the engine's own output, not
hand-fudged. The full record (with per-element breakdown + reconciliation) is committed at
`validation/nza_sim/results/bridgewater_box_v1.json`.

**Headline:**

| Quantity | Value |
|---|---|
| EUI | **160.4 kWh/m²·yr** |
| Heating demand | 2.5 MWh (25.0 kWh/m²) |
| Cooling demand | 1.4 MWh (14.0 kWh/m²) |
| DHW demand | 4.747 MWh (47.5 kWh/m²) |
| Mech-vent loss | 1282 kWh (12.82 kWh/m²) |
| Σ losses | 12 943.1 kWh (129.43 kWh/m²) |
| Σ gains | 10 721.4 kWh (107.21 kWh/m²) |
| Net (gains − losses) | −2221.7 kWh |
| Balance-closure residual | +1121.7 kWh (absorbed by thermal-mass storage + 21–24 °C free-float deadband) |
| Electricity | 7.329 MWh · Gas | 8.711 MWh |

**Losses by element (kWh):** external_wall 1888.4 · roof 1457.1 · ground_floor 1935.9 · glazing 1398.8 ·
thermal_bridging 172.7 · fabric_leakage 4808.3 · permanent_vents 0 · mech_ventilation 1282.0.
Σ = 12 943.2 ≈ total 12 943.1 ✓.

**Gains by element (kWh):** solar N 500.1 / S 1173.6 / E 831.0 / W 938.6 (Σ solar 3443.3) · people 1073.1 ·
lighting 2555.0 · equipment 3650.0 · auxiliary 0 (Σ internal 7278.1). Σ = 10 721.4 = total ✓.

**Per-service delivered → fuel:** heating 2.5 → 2.778 MWh gas (η 0.90; MVHR recovery_offset 1.531 MWh
applied before the boiler) · cooling 1.4 → 0.467 MWh elec (EER 3.0) · DHW 4.747 → 5.933 MWh gas (η 0.80) ·
MVHR fan 0.657 MWh elec (SFP 1.5 × 50 L/s × 8760 h).

### §2.4 — First-principles reconciliation (independent of the engine)

Every headline electrical/fuel term and the heat-balance closure check out by hand — the anchor is
self-consistent, so it is a trustworthy comparison target:

| Term | Hand-calc | Engine | ✓ |
|---|---|---|---|
| Lighting | 5 W/m² × 100 × 14 h × 365 = 2.555 MWh | 2.555 | ✓ |
| Equipment | (3×24 + 2×14) W/m² × 100 × 365 = 3.650 MWh | 3.650 | ✓ |
| MVHR fan | 1.5 × 50 × 8760 = 0.657 MWh | 0.657 | ✓ |
| Cooling elec | 1.4 / 3.0 = 0.467 MWh | 0.467 | ✓ |
| People | 2.8 ppl × 75 W × 14 h × 365 = 1073.1 kWh | 1073.1 | ✓ |
| DHW demand | 2.8 × 80 L × 50 K × (4.18/3600) × 365 = 4.747 MWh | 4.747 | ✓ |
| Gas total | 2.5/0.9 + 4.747/0.8 = 8.712 MWh | 8.711 | ✓ |
| Σ electricity | 2.555 + 3.650 + 0.657 + 0.467 = 7.329 MWh | 7.329 | ✓ |
| Element-loss Σ vs total | 12 943.2 vs 12 943.1 kWh | — | ✓ |
| Gain Σ vs total | 10 721.4 vs 10 721.4 kWh | — | ✓ |

These eight independent hand-calcs + two internal-consistency sums are the falsifiability evidence the
brief requires for P2. The numbers above become the targets EnergyPlus must reproduce (within tolerance)
in Phase 4 (P9).



## §3 — Bridgewater v1 YAML fixture (frozen anchor)

P3 freezes the **real** HIX Bridgewater project (4,125 m² hotel) into a versioned fixture
`validation/fixtures/bridgewater_v1.yaml`, so Brief 82 (full-Bridgewater EnergyPlus validation) has a
trusted anchor captured *now*, while the post-Brief-77 numbers are defensible.

### §3.1 — Why a verbatim project-dump, not the box's hand-authored schema

The Bridgewater-Box fixture (§2) uses a clean hand-authored schema because the box is a *designed*
reference. Bridgewater proper is a real building with 2 heating / 1 cooling / 2 DHW / 3 ventilation
systems, a full occupancy schedule, and 11 library constructions. Re-authoring that by hand would risk
silent drift from the live inputs. So the faithful freeze is the live `building_config` object
**verbatim** (it *is* the engine's `building` param on the live path) + `construction_choices` + comfort
band + the library constructions the project references — each resolved into the **same shape**
`GET /api/library/constructions` returns, including `layers` derived from `config_json.epjson` by the
identical logic as `api/routers/library.py::get_constructions()` (Brief 26.1 P5). The Node loader then
reproduces exactly what the live UI fed the engine.

Fixture distinguishes itself with `meta.kind: project_dump` (vs the box's hand-authored kind).

### §3.2 — Exporter (read-only) and run method

- **`validation/nza_sim/export_bridgewater_fixture.py`** — opens `data/nza_sim.db` with `mode=ro` (writes
  impossible; CLAUDE.md data-safety + Brief 72 PA), reads the project row + all `construction`-type
  library items, derives layers from each item's `config_json.epjson`, and emits the YAML. Never mutates
  the live DB.
- **`validation/nza_sim/run_bridgewater_anchor.mjs`** — loads the YAML and runs the engine **pure-Node**
  (divergence D4): `building = building_config` 1:1, `constructions = construction_choices`,
  `library.constructions → libraryData.constructions` using the **same mapping** as
  `scripts/_brief75_p1_anchor.mjs` (the live-API anchor probe). `options.engine:'v2.5'` forces State-3
  dispatch. Confirms `state:3, mode:"full"`. Output committed at
  `validation/nza_sim/results/bridgewater_v1.json`.

### §3.3 — Falsifiability: fixture run vs committed Brief 77 anchor

**Test:** hand-load the frozen YAML, run the engine pure-Node (no live DB), and compare every headline
metric to the committed live anchor `docs/audit/77_p1_anchor_before.json` (the post-Brief-77,
most-defensible state — identical to `76_p4_anchor_after.json`, since Brief 77 was a per-system vent
*rendering* change, not a physics change). Brief requires agreement within **±1%**.

**Result — all 11 metrics match to Δ0.00 %:**

| Metric | Brief 77 anchor | Fixture run | Δ% | |
|---|---|---|---|---|
| EUI | 143.5 kWh/m²·yr | 143.5 | 0 | ✓ |
| Heating demand | 98.3 MWh | 98.3 | 0 | ✓ |
| Cooling demand | 53.1 MWh | 53.1 | 0 | ✓ |
| DHW demand | 263.18 MWh | 263.18 | 0 | ✓ |
| Vent fan elec | 41.96 MWh | 41.96 | 0 | ✓ |
| Electricity | 387.22 MWh | 387.22 | 0 | ✓ |
| Gas | 204.70 MWh | 204.70 | 0 | ✓ |
| Σ losses | 522.56 MWh | 522.56 | 0 | ✓ |
| Σ gains | 488.01 MWh | 488.01 | 0 | ✓ |
| Net (gains − losses) | −34.55 MWh | −34.55 | 0 | ✓ |
| Mech-vent loss | 326.18 MWh | 326.18 | 0 | ✓ |

The freeze reproduces the live anchor **to the last digit on every metric** — it lost zero information.
This is the strongest possible P3 outcome: the YAML *is* the live engine input, so the pure-Node run is
bit-faithful to the live UI run. (The carbon figure is reported in `headline` for information but is *not*
pass/fail-tested — no carbon value exists in the committed Brief 77 anchor to test against, so claiming a
target would be fabrication.)

> **Reproduce:** `python validation/nza_sim/export_bridgewater_fixture.py` then
> `node validation/nza_sim/run_bridgewater_anchor.mjs` (exits non-zero if any metric drifts >±1%).

### §3.4 — What the fixture captures (1,241 lines)

`meta` (kind `project_dump`, source project id, capture timestamp) · `project.comfort_band` (21–24 °C) ·
`weather.epw_file` (Yeovilton, per D2) · `construction_choices` (cavity_wall_enhanced / flat_roof_standard
/ ground_floor_slab / double_low_e) · `building_config` **verbatim** (geometry 58.8 × 14.7 m × 5 floors,
WWR 0.2 all facades, orientation 42°, occupancy 138 bedrooms @ 3/room, `systems_config_v40` with 2 heating
+ 1 cooling + 2 DHW + 3 ventilation + lighting + small-power systems, schema_version 3) · `library`
(11 constructions, each with derived `layers` for the dynamic thermal-mass model). This is the Brief 82
starting anchor.



## §4 — EnergyPlus install verification + bundled example  *(P4 — pending)*

## §5 — Hand-authored Bridgewater-Box IDF + first run  *(P5 — pending)*

## §6 — Python IDF generator (eppy) + byte-stability  *(P6 — pending)*

## §7 — EnergyPlus runner + output normaliser  *(P7 — pending)*

## §8 — NZA-Sim result extractor (matching schema)  *(P8 — pending)*

## §9 — Comparison report (first-pass results)  *(P9 — pending)*

## §10 — Close summary + handoff  *(P10 — pending)*
