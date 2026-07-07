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

## §3b — Internal-gains parity check + fix (Chris 2026-07-07)

**Hypothesis** (aux injected as zone heat) **refuted:** the aux/external-lighting object already carries
`Fraction Lost = 1.0` → zero zone heat, matching NZA's `gain_fraction: 0`.

**Parity tabulation exposed the real breaks** (annual zone-heat, EP vs NZA per load):

| Load | NZA-Sim | EP (before) | Cause | EP (after fix) |
|---|---|---|---|---|
| People | 120.4 | 96.4 | occupancy schedule integration | **120.6** ✓ |
| Lighting | 39.0 | 44.5 | NZA daylight-dims | **39.0** ✓ |
| Equipment | 186.1 | 39.2 | **baseload mis-scheduled** (NZA baseload is always-on constant) | **186.1** ✓ |
| Aux | 0 | 0 | (correct) | 0 ✓ |

**Fix (`generate_full_idf.py`):** equipment → `ALWAYS_ON` at the baseload (5.04 W/m² constant, active=0 →
186.1 MWh, a faithful correction of a genuine bug); lighting + people EP levels set to reproduce NZA's booked
per-load zone heat (NZA daylight-dims lighting and integrates occupancy differently — matching isolates the
demand comparison to the envelope). All four loads now match by construction (±0.1%). Runs clean (4 W / 0 S),
deterministic (byte-identical), NZA engine untouched (`--fixture` still 132.6).

**Corrected baseline — and the decisive finding:** with gains matched, EP demand is **heating 0.1 / cooling
316.7 MWh** (EUI 122.8) — the reversal did not close, it **widened**. That is dispositive: **the EP/NZA
divergence is a HEAT-LOSS problem, not a gains problem.** NZA's dominant loss is **mech-ventilation 277.2 MWh
(57% of 486.8 total losses)**; the current blended-ventilation model (3843 L/s @ 29.7% flow-weighted recovery,
applied year-round on IdealLoads with no summer bypass) does not reproduce it — so the matched gains + solar
overheat the zone and cooling runs away.

**⛔ P3 must NOT run on this baseline** (heating 0.1 MWh is non-physical). The next step, before any
characterisation, is the same parity discipline on the LOSS side — get EP's per-channel heat loss
(mech-ventilation 277, infiltration, fabric conduction) to match NZA by construction. Correcting the
ventilation model (proper MVHR 80% recovery on 1425 L/s + extract-only makeup, summer bypass) is the prime
candidate.

## §3c — Loss-side parity: input audit + faithful ventilation (Chris 2026-07-07)

**Discipline (Chris):** SPECS match by construction; LOSSES are outputs — compared and explained, **never
tuned** toward NZA's figures. The §3b lighting/people *calibration* to NZA's booked heat violated this and was
**reverted to spec-faithful** (2 W/m² lighting × schedule; 276 people × schedule). The equipment fix stays —
`baseload` is genuinely an always-on constant in the fixture (a spec correction, not a calibration).

**(1) Input audit — envelope ruled out.** EP's per-element U-factors match the fixture **by construction**:
walls 0.140 (0.14), floor 0.130 (0.13), roof 0.150 (0.15); areas walls ≈1727 / roof 843 / floor 843 m²;
glazing simple-glazing U 1.4. `ZoneInfiltration` present at the fixture ach. So heating≈0 was **not** the
envelope conductance.

**(2) Ventilation rebuilt faithfully to the FIXTURE** (not NZA's blend): MVHR **80% sensible recovery on its
own 1425 L/s** with **summer bypass** (IdealLoads `DifferentialDryBulb` economizer, cooling-flow-limited to
clear the economizer severe); extract-only streams (bedroom 2208 + toilet 210 = 2418 L/s) as **0%-recovery**
outdoor-air makeup via `ZoneVentilation:DesignFlowRate`. Two distinct recovery regimes, per the fixture.

**Result — physical baseline (0 Severe, deterministic, NZA untouched at 132.6):**

| | EP | NZA | Δ |
|---|---|---|---|
| Heating demand | **107.7** | 87.7 | +23% |
| Cooling demand | **121.3** | 101.1 | +20% |
| EUI | **118.0** | 132.6 | −11% |

Heating is now meaningfully non-zero and cooling well below 300 — the sanity band. The heating direction now
matches the Box arc (EP-heating-higher). The extreme reversal (heating 0.1 / cooling 316.7) was entirely the
ventilation model.

**(3) Per-channel losses (NZA | EP, MWh) — residuals are characterisation, not gates:**

| Channel | NZA | EP | Note |
|---|---|---|---|
| Mech-ventilation (MVHR OA) | 277.2 (incl. all vent) | 106.6 (OA-sensible) + extract-makeup | see caveat |
| Infiltration | 30.6 | (EP lumps extract-makeup here) | **EP accounting caveat** |
| Fabric (opaque) | 47.2 | 60.0 | +27% |
| Glazing conduction | 88.9 | 44.6 | −50% (window net, addition/removal split) |

**EP accounting caveat:** EP's `SensibleHeatGainSummary` folds `ZoneVentilation:DesignFlowRate` (my
2418 L/s extract-makeup) into the **Infiltration** line, so EP's "infiltration" 317.4 = true infiltration +
extract-makeup, and EP's total ventilation loss = MVHR OA (106.6) + extract-makeup (within that 317.4). A
clean per-channel split needs dedicated output isolation (small follow-up). NZA's mech-ventilation 277.2 is a
single blended figure (its own simplification). These residuals — heating +23%, cooling +20%, and the
per-channel differences — are the **characterisation** and carry into P3; they are named here, not tuned away.
