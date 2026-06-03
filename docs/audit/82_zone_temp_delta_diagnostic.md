# Brief 82 — Zone-temp delta diagnostic (Bridgewater-Box root cause) — Audit

**Branch:** `feat/energyplus-validation` (continuation of Brief 81). **NEVER merged/pushed to `main`.**
**Authority:** Same-day working session. Diagnostic only — no engine code changes.
**Canonical design note:** https://app.notion.com/p/374d645e05cc81f2b19ee7350c46af7d (read in full at P1; where brief and note disagree, the note wins).

---

## §0 — Receipt + premise-check

### §0.1 — Receipt (P1)

**Brief title:** "Brief 82 — Zone-temp delta diagnostic (Bridgewater-Box root cause)".

**Hypothesis (quoted from the brief):**

> **The four divergences are most likely one finding.** A zone that free-floats ~0.5 °C warmer in
> NZA-Sim than EnergyPlus would naturally produce all three booking divergences:
> - Fewer hours below 21 °C heating setpoint → less heating demand booked
> - More hours above 24 °C cooling setpoint → more cooling demand booked
> - Different integration of mech vent loss against heating-mode hours
>
> If true: one engine fix collapses three symptoms. If false: three independent issues, three
> separate briefs.

**Git state at P1 start (verified before any work):**

| Ref | Tip | Expected | OK |
|---|---|---|---|
| `feat/energyplus-validation` | `f03ee13` | `f03ee13` or later | ✓ |
| `main` (local) | `d8a6207` | `d8a6207` (unchanged) | ✓ |
| `main` (remote `origin/main`) | `d8a6207` | `d8a6207` (unchanged) | ✓ |
| `git branch --show-current` | `feat/energyplus-validation` | `feat/energyplus-validation` | ✓ |

The design note was read in full (§ "What Brief 82 produces", three candidates, out-of-scope, decision
log). It is consistent with the brief. **One nuance** the note carries that the brief states more
narrowly: the note's out-of-scope list permits *one* small EnergyPlus IDF change to test candidate 3
(setpoint deadband / config mismatch) "if Code identifies a config mismatch as candidate 3 — then ONE
small IDF change to test that hypothesis is permitted, documented separately". The brief's "What MUST
NOT happen" allows only adding the `Zone Mean Air Temperature` output variable. Both permit the P2
output-variable addition. The note's broader allowance (a single config-test IDF edit) is held in
reserve and will only be exercised if P3/P5 evidence specifically points at candidate 3, and then
documented separately. Default posture: conservative — no IDF model change.

### §0.2 — Brief 81 divergence findings (the numbers this brief acts on)

From `docs/audit/81_energyplus_validation_box.md` §10.2 (FAIL — 4/7 gated):

| Metric | NZA | EnergyPlus | Δ | Gated result |
|---|---|---|---|---|
| EUI (kWh/m²) | 160.4 | 166.6 | −3.7 % | PASS |
| Heating demand (MWh) | 2.492 | 3.278 | −24.0 % | FAIL |
| Cooling demand (MWh) | 1.407 | 0.677 | +107.9 % | FAIL |
| Fabric conduction total (MWh) | 5.454 | 4.909 | +11.1 % | PASS |
| Mech-vent loss net (MWh) | 1.282 | 0.665 | +92.9 % | FAIL |
| Monthly heating profile | — | — | r = 0.993 | PASS |
| Monthly cooling profile | — | — | r = 0.945 | PASS |
| Zone mean air temp (°C) | — | — | +0.49 (NZA warmer) | info |

The +0.49 °C zone-temp delta is the load-bearing quantity for this brief.

### §0.3 — De-risking note (carried from Brief 81 P8)

The NZA-Sim result object already exposes an 8760-length per-hour zone-air-temperature array at
`result.demand.hourly_zone_air_c` (discovered during Brief 81 P8 while writing `extract.mjs`). This
de-risks the P2 hard-STOP ("State 2 doesn't compute hourly zone temperature") — the quantity exists
as an hourly series in the standard result. P2 still verifies provenance (which solver produces it,
hour-beginning vs hour-ending convention) before relying on it. There is also a
`hourly_zone_air_free_c` (free-float) variant to disambiguate.

---

## §1 — P1: Brief landing + branch verify

- Brief landed at `docs/briefs/active/82_zone_temp_delta_diagnostic.md` (verbatim copy of the
  authorised brief).
- This audit stub opened at `docs/audit/82_zone_temp_delta_diagnostic.md`.
- Branch confirmed `feat/energyplus-validation`; `main` confirmed unchanged at `d8a6207` (local +
  remote) — see §0.1.
- Only Brief-82-authored files staged for the P1 commit (the pre-existing dirty working-tree files
  from earlier briefs — `docs/audit/53_*`, `55_*`, `61_*`, `63_*`, `66_*`, `public/`,
  `scripts/_b66_*`/`_b81_dump_schema.py`/`_brief72_*`/`_dhw_*`/`_permvent_*`/`_wallmodel_*`,
  `docs/validation/sensitivity/*` — are NOT staged, per CLAUDE.md discipline).

Commit: `Brief 82 P1: brief landing on feat/energyplus-validation`.

---

## §2 — P2: Hourly zone temperature extraction (both engines)

**Outcome:** Two schema-identical 8760-row hourly CSVs captured. The P2 hard-STOP
("State 2 doesn't compute hourly zone temperature") is **CLEARED** — the quantity already
exists on the standard NZA-Sim result payload, so **no engine code change was made** (not
even the opt-in flag the brief contemplated). The two traces independently sum back to the
exact Brief 81 annual divergences (heating −24.0 %, cooling +107.9 %) and reproduce the
+0.49 °C mean zone-temp delta — confirming both extractions are faithful before any P3/P4
analysis is built on them.

### §2.1 — Output schema (both engines)

Both CSVs share one header, one row ordering, one units convention:

```
hour_index, month, day, hour, zone_mean_air_temp_c, outdoor_drybulb_c,
heating_demand_kwh, cooling_demand_kwh
```

- `hour_index` — 0-based ordinal hour of the year (0 = first hour). Chronological from 1 Jan.
- `month, day, hour` — calendar stamp (hour is 1..24, hour-ending; see §2.4).
- `zone_mean_air_temp_c` — the load-bearing series; the conditioned zone air temperature.
- `outdoor_drybulb_c` — alignment cross-check series (see §2.5 for a definitional nuance).
- `heating_demand_kwh`, `cooling_demand_kwh` — zone sensible demand (pre-systems efficiency),
  the directly comparable load each engine places on its ideal heating/cooling.

### §2.2 — EnergyPlus side: `validation/energyplus/extract_hourly_temps.py`

Pure read-only re-read of the committed Brief 81 P7 run
(`validation/energyplus/runs/bridgewater_box_v1_ep/eplusout.sql`). **No EnergyPlus re-run,
no IDF edit** — the Brief 81 IDF already requests `Zone Mean Air Temperature` and
`Site Outdoor Air Drybulb Temperature` at Hourly frequency (IDF lines 735–738), and the
canonical SQL already holds all 8760 rows. (This was confirmed by probing the SQL directly:
the committed result's monthly zone-temp array was already built from the Hourly series, so
the series must be present — and the probe returned 8760 Hourly rows.)

Stdlib-only (sqlite3 / csv / argparse / pathlib); SQLite opened read-only
(`file:...?mode=ro`). Joins `ReportData` ↔ `ReportDataDictionary` (on
`ReportDataDictionaryIndex`) ↔ `Time` (on `TimeIndex`), filtered to
`ReportingFrequency = 'Hourly'`. EnergyPlus reports the ideal-loads sensible energies in
**Joules**; the script converts to kWh (J / 3.6e6). Variables read:

| CSV column | EnergyPlus Output:Variable |
|---|---|
| `zone_mean_air_temp_c` | `Zone Mean Air Temperature` |
| `outdoor_drybulb_c` | `Site Outdoor Air Drybulb Temperature` |
| `heating_demand_kwh` | `Zone Ideal Loads Supply Air Sensible Heating Energy` |
| `cooling_demand_kwh` | `Zone Ideal Loads Supply Air Sensible Cooling Energy` |

Run summary: **8760 rows, EP zone mean air temp = 21.8140 °C.**

### §2.3 — NZA-Sim side: `validation/nza_sim/extract.mjs --hourly-temps`

**Additive, opt-in, non-breaking.** The default invocation (no flag) is unchanged — it still
writes only the P8 comparison JSON. Passing `--hourly-temps` ALSO writes the hourly CSV. The
hourly zone-air trace is read straight off the standard result payload:

| CSV column | NZA-Sim result field (instantCalc.js) |
|---|---|
| `zone_mean_air_temp_c` | `result.demand.hourly_zone_air_c` (`T_air_hourly[h]`, L3282) |
| `heating_demand_kwh` | `result.demand.heating_demand_hourly_kwh` (L3728) |
| `cooling_demand_kwh` | `result.demand.cooling_demand_hourly_kwh` (L3729) |
| `outdoor_drybulb_c` | `inputs.weatherData.temperature[h]` (raw EPW hourly drybulb) |
| `month, day, hour` | `inputs.weatherData.{month,day,hour}[h]` (EPW row fields) |

`hourly_zone_air_c` is the **post-solve conditioned** zone air temperature — the correct
analogue of EnergyPlus `Zone Mean Air Temperature`. (The sibling
`hourly_zone_air_free_c` / `T_air_free_hourly[h]` (L3287) is the *pre-clamp free-float*
temperature — a DIFFERENT quantity, deliberately NOT used here. It may be useful in P3 to
separate "what the zone wants to do" from "what conditioning forces", but the headline
comparison must be conditioned-vs-conditioned.)

Run summary: **8760 rows, NZA zone mean air temp = 22.3078 °C.**

### §2.4 — Hour-indexing convention (both hour-ending, index-for-index aligned)

- **EnergyPlus = hour-ending.** The `Time` table reports `Hour` in 1..24 with `Minute=60`,
  `Interval=60`. Row `(Month=1, Day=1, Hour=1)` is the mean over **00:00–01:00** on 1 Jan;
  the final row is `(12, 31, 24)` = 23:00–24:00 on 31 Dec.
- **NZA-Sim:** the State-2 loop runs `for (h=0; h<8760; h++)` reading
  `weatherData.temperature[h]`, where row `h` is the (h+1)-th EPW row. The EPW hour field is
  itself 1..24 (hour-ending), so NZA index `h` ↔ EPW row `h` ↔ EnergyPlus `TimeIndex (h+1)`.
- **Net:** both CSVs use `hour_index = 0` for the **first hour-ending interval of 1 Jan**, and
  walk chronologically. They align index-for-index; no offset correction is needed.

### §2.5 — Falsifiability evidence

Recomputed fresh from the two committed CSVs (reproducible):

| Check | Result | Verdict |
|---|---|---|
| Row count (each) | 8760 / 8760 | ✓ |
| Headers identical | true | ✓ |
| Calendar `(month,day,hour)` mismatches | **0** of 8760 | ✓ aligned |
| First row | both `idx 0 → 1/1/1`, zone 21.00 °C | ✓ |
| Last row | both `idx 8759 → 12/31/24` | ✓ |
| Zone delta (NZA − EP) mean | **+0.4938 °C** | ✓ matches Brief 81's +0.49 |
| Zone delta min / max | −0.8588 / +2.6660 °C | conditional, not constant (→ P3) |
| Zone mean EP / NZA | 21.8140 / 22.3078 °C | — |
| Annual heating EP / NZA | 3277.5 / 2491.7 kWh (−24.0 %) | ✓ matches Brief 81 |
| Annual cooling EP / NZA | 676.8 / 1407.0 kWh (+107.9 %) | ✓ matches Brief 81 |

The hourly traces summing **exactly** to the Brief 81 MWh headline numbers (3.278/2.492
heating, 0.677/1.407 cooling) is the decisive faithfulness check: the per-hour extraction is
not a new model, it is the same run resolved to hourly granularity.

**Outdoor-drybulb cross-check — a definitional nuance, NOT a misalignment.** `|EP − NZA|` on
`outdoor_drybulb_c` is max 2.2500 / mean 0.30343 °C — non-zero. This is because EnergyPlus's
`Site Outdoor Air Drybulb Temperature` (Hourly) is its internally processed / sub-hourly
weather value, whereas NZA reads the **raw EPW hourly drybulb**. The calendar match (0
mismatches) and the zone-temp delta exactly reproducing Brief 81 both confirm the hours ARE
aligned; the drybulb gap is a value definition difference between the two engines' weather
intake, documented here so P3 does not mistake it for a clock offset.

### §2.6 — 10-hour hand spot check (fixed indices, reproducible)

```
idx  M/D/H     EP_zT  NZA_zT  dZT     EP_heat NZA_heat  EP_cool NZA_cool
0    1/1/1     21.00  21.00  +0.00    0.854   0.610     0.000   0.000
546  1/23/19   21.00  21.00  +0.00    1.404   1.231     0.000   0.000
1500 3/4/13    21.00  21.00  +0.00    0.646   0.134     0.000   0.000
2565 4/17/22   21.16  22.80  +1.65    0.000   0.000     0.000   0.000
2735 4/24/24   21.00  22.94  +1.94    0.004   0.000     0.000   0.000
4786 7/19/11   24.00  24.00  +0.00    0.000   0.000     1.884   2.522
5000 7/28/9    24.00  23.96  -0.04    0.000   0.000     0.352   0.000
6500 9/28/21   21.17  23.41  +2.24    0.000   0.000     0.000   0.000
8026 12/1/11   21.00  21.00  +0.00    1.132   0.139     0.000   0.000
8759 12/31/24  21.00  21.00  +0.00    1.197   1.292     0.000   0.000
```

Three regimes visible, and they line up with the brief's hypothesis:

1. **Conditioned heating hours** (zone pinned at 21.0 °C in both): NZA books *less* heating —
   idx 1500 (EP 0.646 vs NZA 0.134), idx 8026 (EP 1.132 vs NZA 0.139). Both hold the same
   setpoint, but NZA needs less energy to do so.
2. **Free-floating shoulder hours** (no demand either side): NZA floats *markedly warmer* —
   idx 2565 +1.65, idx 2735 +1.94, idx 6500 +2.24 °C. This is the load-bearing signature.
3. **Conditioned cooling hours** (zone pinned at 24.0 °C in both): NZA books *more* cooling —
   idx 4786 (EP 1.884 vs NZA 2.522).

**Honest counter-example:** idx 5000 (7/28 09:00) — NZA sits at 23.96 °C (just below the
cooling setpoint, books 0) while EP is exactly at 24.0 °C (books 0.352). The divergence is
**not perfectly monotonic**; a handful of cooling-shoulder hours invert. P3 must classify by
regime rather than assume a uniform offset.

### §2.7 — Files / commit

Staged for the P2 commit (own files only; pre-existing dirty working-tree files NOT staged
per CLAUDE.md):

- `validation/energyplus/extract_hourly_temps.py` (new, EP-side extractor)
- `validation/nza_sim/extract.mjs` (additive `--hourly-temps` path)
- `validation/energyplus/results/bridgewater_box_v1_hourly_temps.csv` (8760 rows)
- `validation/nza_sim/results/bridgewater_box_v1_hourly_temps.csv` (8760 rows)
- `docs/audit/82_zone_temp_delta_diagnostic.md` (this section)

(The default `validation/nza_sim/results/bridgewater_box_v1.json` shows a one-line
`captured_at` timestamp change as a benign side-effect of re-running the extractor; it is
NOT a P2 deliverable and is left unstaged.)

Commit: `Brief 82 P2: hourly zone temperature extraction (both engines)`.

---

## §3 — P3: Temperature trace comparison + divergence regime analysis

**Tool:** `validation/zone_temp_diagnostic.py` (stdlib only; read-only; no engine/IDF/DB touch).
Loads the two P2 CSVs, re-asserts alignment (8760 rows, 0 calendar mismatches), computes the
hour-by-hour delta (T_NZA − T_EP), annual + monthly stats, five regime breakdowns, the demand-gap
decomposition, and answers the brief's five evidence questions. **Report:**
`validation/reports/zone_temp_diagnostic_2026-06-03T09-30-40Z.md`.

### §3.1 — Headline finding: the delta is a *free-float phenomenon*

| EP mode | Hours | Mean delta (°C) | Contribution to annual mean (°C) |
|---|---|---|---|
| heating | 4426 | +0.223 | +0.112 |
| cooling | 1173 | −0.002 | −0.000 |
| **free-float** | **3161** | **+1.057** | **+0.382** |

The +0.4938 °C annual mean (median only +0.103; 45.1 % of hours have |delta| < 0.05) is carried
almost entirely by free-float hours. When either setpoint binds, **both engines pin to the same
value and the delta collapses to ~0** (cooling mode delta is −0.002 °C). So the divergence is not a
flat calibration offset — it is "NZA's *unconditioned* zone settles warmer than EnergyPlus's."

### §3.2 — Where the Brief 81 demand gaps actually come from (decomposition)

**Heating −24.0 % (NZA 2491.7 vs EP 3277.5 kWh; shortfall 785.8 kWh):**
- **624.8 kWh** (≈80 %) is hours where EP still heats but NZA has floated above 21 °C and books
  nothing (cross-tab EP-heating × NZA-free = 1912 h).
- 161.0 kWh is NZA heating less while both are in heating mode (2514 h).

**Cooling +107.9 % (NZA 1407.0 vs EP 676.8 kWh; excess 730.2 kWh):**
- only **100.3 kWh** is hours where NZA has floated above 24 °C and cools while EP free-floats below
  it (212 h).
- **654.4 kWh** (≈90 %) is NZA **cooling harder while both engines cool** (1022 h, both pinned at
  24 °C). This is a same-setpoint *load* difference, **not** a temperature-offset effect — a key
  caveat the P4 counterfactual must respect (shifting the conditioned trace down cannot explain
  extra cooling booked while the zone is already held at 24 °C).

### §3.3 — Regime signatures (point at *loss-side*, not gains)

- **Seasonal:** delta concentrates in shoulder months — May +1.39, Sep +1.14, Jun +0.90, Oct +0.70,
  Apr +0.69 °C; deep winter (Dec/Jan/Feb ≈ 0) and high summer are conditioned-dominated so the delta
  collapses.
- **Outdoor band:** peaks at mild outdoor temps ([10,15) °C → +0.90 °C), ~0 at both extremes.
- **Indoor−outdoor ΔT (loss proxy):** free-float delta correlates **positively** with ΔT
  (r = +0.52) and **negatively** with outdoor drybulb (r = −0.60). The bigger the driving
  temperature difference, the more NZA over-warms — the fingerprint of NZA shedding *less* heat than
  EP for the same ΔT.
- **Hour-of-day:** delta is **larger at night** (hours 22–05 ≈ +0.68..+0.71) and **smaller midday**
  (hours 12–16 ≈ +0.28..+0.32); free-float delta is +1.28 °C unoccupied vs +0.77 °C occupied. A
  gains-*retention* fault would do the opposite (peak during solar/occupied hours). Night-heavy,
  ΔT-driven warmth is a **ventilation/fabric loss** signature.

### §3.4 — The five evidence questions (answers)

1. **Constant or conditional?** **Conditional.** Std 0.675 °C, range −0.86..+2.67; near-zero when
   conditioned, large in free-float. r(delta, outdoor) = +0.095 overall but −0.598 within free-float.
2. **Correlate with ventilation activity?** Bridgewater-Box vent is constant 50 L/s (no schedule),
   so there are no scheduled-off hours to contrast from the temperature trace — **deferred to P4's
   mech-vent re-booking.** Proxy: free-float delta vs indoor−outdoor ΔT r = +0.517 (loss-consistent).
3. **Correlate with internal gains?** Hour-of-day proxy: free-float delta is *lower* in occupied
   hours (+0.767) than unoccupied (+1.281) — **gains retention is not the driver.**
4. **Correlate with heating/cooling mode?** **Yes — the headline (see §3.1).** Strongly
   mode-asymmetric; free-float carries the offset.
5. **Exaggerated at setpoint transitions?** Mode-change hours (478): mean |delta| 0.654 vs 0.491 °C
   elsewhere — modestly larger, but the warmth is broad-spectrum across *all* free-float hours, not a
   narrow hysteresis-at-transition spike. EP free-float zone mean 22.14 °C (21.01–24.00), mostly
   hugging the 21 °C heating boundary.

### §3.5 — Preliminary read (NOT the verdict — P4 is decisive)

Evidence leans toward **candidate 1 (loss-side / MVHR coupling):** the free-float warmth is
ΔT-driven and night-heavy (loss-side, not gains), and roughly-constant solver convention
(candidate 2) is contradicted by the delta vanishing under conditioning. Candidate 3 (deadband
hysteresis) is weakly supported at best. **Caveat that complicates a clean candidate-1 story:** the
cooling gap is ~90 % "cools harder at the same 24 °C setpoint" (§3.2), which a downward temperature
shift cannot book away — so even if candidate 1 is upstream of the *free-float* warmth, the cooling
divergence may be partly an independent heat-balance/load difference. **Prediction for P4: outcome
(b) — partial.** Re-booking a shifted trace should largely close the *heating* gap (mostly
free-float-crossing driven) but is unlikely to close the *cooling* gap (mostly same-setpoint load).
No hard-STOP triggered: patterns are physically coherent and fit the candidate set.

---

## §4 — P4: Counterfactual re-booking test

_(to be written at P4 — the load-bearing test)_

Shift NZA trace by the mean offset, re-book heating/cooling against EnergyPlus setpoint logic (heat <
21, cool > 24, deadband between) and mech-vent loss against shifted heating-mode hours; compare to
EnergyPlus totals. Predict before measuring. Classify outcome (a)/(b)/(c).

---

## §5 — P5: Candidate root cause verdict + evidence

_(to be written at P5)_

Map P3 + P4 evidence onto the three candidates (1 MVHR coupling / 2 solver convention / 3 setpoint
deadband). State confidence honestly; permit "coupled / ambiguous" if that's what the evidence shows.

---

## §6 — P6: Close summary + Brief 83 recommendation

_(to be written at P6)_

P2/P3/P4/P5 recap, recommended Brief 83 scope (one fix / multiple / deeper review), confidence
assessment. STATUS.md updated on the branch. Final push to origin. **No merge to `main`.**
