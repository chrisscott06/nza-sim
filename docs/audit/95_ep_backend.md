# Brief 95 — EnergyPlus Results Backend for Interventions — audit

## §1 — EP version pin + Box-validation gate (Part 1)

**Pin.** `validation/energyplus/ep_config.json` → EnergyPlus **25.2.0-cf7368216c** at
`/Applications/EnergyPlus-25-2-0` (binary + IDD + WeatherData + ExampleFiles). `ENERGYPLUS_DIR` still
overrides. 26.1.0 upgrade is a separate future decision (Decision 7).

### Box gate — 25-2-0 reproduces the reference BYTE-IDENTICALLY

Re-ran the Brief 81–85 Box flow against 25-2-0: `run.py` (EP 25-2-0, box IDF) → `compare.py` vs the NZA-Sim
reference. EP ran clean — **3 warnings, 0 severe**, ~1.5 s. This also **closes Brief 93's deferred EP
smoke-test caveat**.

**Version invariance (the substantive gate):** the fresh 25-2-0 EP result is **byte-identical to the
previously-committed EP reference — 0 of 42 metrics moved** (heating 3.2775, cooling 0.6768, EUI 166.6, all
fabric/solar/infiltration/mech-vent figures unchanged). The version change introduces **zero** divergence; the
pin holds cleanly.

**Gated tolerance table (`compare.py`, NZA-Sim v2.5 vs EP 25-2-0):**

| Metric | NZA-Sim | EnergyPlus | Δ (NZA−EP)/EP | Tol | Result |
|---|---|---|---|---|---|
| EUI | 160.4 | 166.6 | −3.7% | ±10% | ✅ PASS |
| Heating demand | 2.492 | 3.278 | **−24.0%** | ±15% | ❌ FAIL |
| Cooling demand | 1.407 | 0.677 | **+107.9%** | ±15% | ❌ FAIL |
| Fabric conduction (total) | 5.454 | 4.909 | +11.1% | ±20% | ✅ PASS |
| Mech-vent (net, coil-run hrs) | 0.919 | 0.887 | +3.6% | ±15% | ✅ PASS |
| Monthly heating profile r | — | — | 0.993 | ≥0.85 | ✅ PASS |
| Monthly cooling profile r | — | — | 0.945 | ≥0.85 | ✅ PASS |

### Gate reading (Chris-authorised 2026-07-07)

`compare.py`'s literal verdict is FAIL on 2/7 gated metrics — but **heating −24.0% / cooling +107.9% are the
established, documented Brief 81–85 characterisation**, exactly the "heating −24% / cooling +108% territory"
this brief predicts (P3) and the +108% cooling residual Brief 95 exists to investigate. They are NZA-Sim↔EP
divergences deliberately surfaced by the harness ("never tuned away"), **not** version regressions — proven by
the byte-identical version invariance above (25-2-0 = the reference EP numbers exactly).

The P1 gate is therefore read as **"25-2-0 reproduces the established characterisation"** — which it does
exactly — **PASS, proceed**. (A literal all-green reading is impossible: the cooling residual is the reason
for the brief.) Chris confirmed proceeding on this reading (2026-07-07). Reproduction command:
`ENERGYPLUS_DIR=/Applications/EnergyPlus-25-2-0 validation/.venv/bin/python validation/energyplus/run.py`
then `validation/compare.py --stdout`.

_Info rows (not gated) unchanged from the Brief 81–85 record: glazing conduction +58.9%, heat recovery −49.7%
(framing differences documented in Brief 83 §3.4/§5.2); people/lighting/equipment gains 0.0%._

## §2 — ZZ TEST seed + fixture rule

`scripts/seed_test_project.py` creates/replaces the **"ZZ TEST — do not use"** project in the local DB from
`validation/fixtures/bridgewater_anchor_v2.yaml`. Idempotent (delete-by-name then insert = clean recreate on
every run). UI verification for Brief 95 uses ZZ TEST only — never Chris's real projects. CLAUDE.md gains the
two-line fixture rule.

> **Implementer's-choice deviation (documented):** the brief names `seed_test_project.mjs`, but node here has
> neither a YAML parser nor a SQLite driver (no repo node project), while Python has both (stdlib `sqlite3` +
> the harness venv's `pyyaml`). The seed is written in Python for a zero-dependency, robust implementation.

## §3 — Full-project fixture → runnable IDF (Part 2)

**Generator** `validation/energyplus/generate_full_idf.py` consumes the full fixture
(`bridgewater_anchor_v2.yaml`). **Runs clean on EP 25-2-0: `EnergyPlus Completed Successfully — 4 Warning,
0 Severe, 0 Fatal`** (~0.6 s). **Deterministic:** two builds byte-identical (339117 bytes).

**Simulation layer = IdealLoads** (Brief 95 P2 scope decision, Chris 2026-07-07: the full-equipment route —
PTHP/VRF surrogate, DX coils, performance curves, ERV/exhaust-fan network, DHW plant loop — was selected in
error and is **parked** (possible later upgrade, not scaffolded)). EP computes envelope + gains + ventilation
→ **zone demand**; delivered energy is derived in post-processing.

**Modelling decisions:**
- Single zone; footprint L×W (843 m²), height 5×3.2 = 16 m; Zone `Floor_Area` = GIA 4216 m² so loads/EUI
  reference the whole building (matches the anchor's per-element areas: walls = perimeter × 16 m, roof/floor =
  footprint).
- Constructions from U-values → `MATERIAL:NOMASS` (R = 1/U − ISO-6946 film); glazing → simple-glazing (U 1.4,
  g 0.55 from `config_json`). No thermal mass (fixture carries no layers).
- Gains (people 276, lighting 2 W/m², equipment 5.04 W/m² baseload, external-lighting 1.5 W/m² as
  `Fraction_Lost=1`) on `SCHEDULE:COMPACT`s built month-by-month from the fixture's 24 h weekday/sat/sun
  arrays × monthly multipliers.
- **Orientation fixed:** `Coordinate_System=Relative` so the Building `North_Axis=42°` is applied (under World
  coords EP ignored it — that warning is now gone; it moves solar).
- Ventilation (blended): MVHR 1425 + bedroom-extract 2208 + toilet-extract 210 L/s → one OA flow with a
  flow-weighted effective sensible recovery on IdealLoads.

**Warning dispositions (4, all expected):**
1. *No thermal mass* — the U-value NoMass simplification (documented); P3 characterises accuracy.
2. *Ground temperatures not input* — EP default ground temps used; adequate for demand, revisit in P3 if
   ground-floor loss matters.
3. *Floor Area 80% different from geometry* — intended: single geometric zone (843 m²) with `Floor_Area` set
   to GIA (4216 m²) so loads reference the whole building.
4. *Output:Meter NaturalGas:Facility not found* — **kept intentionally**: gas (DHW calorifier) is now a
   post-processing calc, not an EP object (Chris). The meter stays as a documented no-op.

**Post-processor** `validation/energyplus/run_full.py` — runs the IDF, reads IdealLoads zone demand, and
converts **demand → consumption with fixed efficiencies**, writing `results/bridgewater_full_v1.json` whose
`_header.efficiency_assumptions` states every assumption:
- Space heating: demand ÷ proportional split — VRF **SCOP 3 @95%** + electric panel **COP 1 @5%**.
- Space cooling: demand ÷ VRF **EER 3 @100%** (DX split @0%).
- DHW (deterministic, not EP): 55 L·person⁻¹·day⁻¹ × 276 people × 365 d × cp 4.186 × ΔT(42−10)°C = 206.16 MWh;
  split **gas η 0.85 @52%** + **ASHP SCOP 3 @48%**.
- Ventilation fans: Σ SFP × flow × 8760 h (no fan object under IdealLoads).

**EP full-building result (parses to normalised shape):** demand heating **10.7** / cooling **173.6** MWh;
consumption elec **206.2** / gas **126.1** MWh; **EUI 78.8 kWh/m²**. These diverge strongly from NZA-Sim
(heating 87.7, cooling 101.1, EUI 132.6) — that is **P3 characterisation territory**, not a P2 gate (P2 =
clean run + determinism + normalised parse, all met). NB the low EP heating / high EP cooling is consistent
with the Box arc direction and the no-thermal-mass + high-gain single-zone model; P3 reads it honestly.
