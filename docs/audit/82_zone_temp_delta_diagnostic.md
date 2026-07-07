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

## §4 — P4: Counterfactual re-booking test (the load-bearing test)

**Script:** `validation/nza_sim/counterfactual_rebook.mjs` (pure-Node, read-only).
**Report:** `validation/reports/zone_temp_counterfactual_2026-06-03T09-48-35Z.md`.
**Prediction (locked in §3.5 before measuring):** outcome **(b) — partial** (heating gap largely
closes; cooling gap does not).

### §4.0 — Method correction (and why the brief's literal recipe is unusable here)

The brief's literal recipe — "subtract 0.49 °C from every hour and re-book heating/cooling against
EnergyPlus setpoint logic" — needs a demand model to turn a shifted temperature into kWh. The
obvious choice is NZA's *own* law (instantCalc.js L3679/3694):

```
heating_Wh = max(0, −C_coef · (21 − T_air_free))
cooling_Wh = max(0, −C_coef · (T_air_free − 24))
```

I built this first. It **explodes**: shifting the free-float trace down by just 0.25 °C drives
heating from 2491.7 → 9307.9 kWh (**+184 %**); at 0.49 °C it reaches 17 147 kWh (**+423 %**). The
δ=0 round-trip still passes exactly (it is an algebraic identity), so the round-trip sanity check is
*necessary but not sufficient* — it cannot catch the extrapolation error.

Root cause of the explosion (CLAUDE.md Rule 10 — diagnose, don't hand-wave): the recovered slope is
constant at **−C_coef = 8.793 kWh/°C ≈ 8793 W/K** (std 0.0007 across all conditioned hours). That is
~100× any physical UA for a box this size. The engine's own comment (L3659) names it: `C_coef` is the
implicit-Euler one-step coefficient `C_thermal/Δt + Σ(UA)`, **dominated by thermal capacitance**
(C_thermal/Δt ≈ 8793 W/K ⇒ C_thermal ≈ 31.7 MJ/K). The gap `(21 − T_air_free)` in a conditioned hour
is therefore *tiny* (median ≈ 0.11 °C — the zone barely moves from its previous temperature in one
hour because of its mass), and demand = huge coefficient × tiny gap. Multiplying a **persistent**
0.49 °C offset by a **capacitance** coefficient fabricates a perpetual thermal-mass recharge *every
hour* — physically a zone being re-chilled and re-heated 8760 times. The per-hour `−C_coef` cannot be
used to extrapolate a standing offset. (This is preserved as Appendix A in the report — it is itself
a finding: NZA's per-hour demand is a one-step implicit solve, not a steady-state degree-hour.)

**Deviation from the literal recipe, justified.** Because the engine exposes no steady-state
conductance and engine changes are forbidden, the only honest post-hoc test is a **mode-crossing
reconciliation**: shift NZA's free-float trace down by δ, re-classify each hour against EP's setpoint
logic, and reconcile demand using *EnergyPlus's own hourly demand* for recoverable heating (Rule 1:
EP is the source of truth) and *NZA's own booked cooling* for removable cooling. No magnitude is ever
extrapolated through `−C_coef`. This answers the brief's actual question — "does correcting the
temperature delta close the demand gaps?" — without the artifact.

### §4.1 — Baseline decomposition (per-hour join cross-check)

The hourly join reproduces Brief 81 exactly (heating −24.0 %, cooling +107.9 %) and the P3
decomposition exactly — confirming calendar alignment and correct mode classification:

| Gap | Total | Mode-divergence portion | Same-setpoint magnitude portion |
|---|---|---|---|
| Heating shortfall (EP−NZA) | 785.8 kWh | **624.8 kWh** (1912 h: EP heats, NZA floats >21) — 80 % | 161.0 kWh (2514 h: both heat, NZA books less) — 20 % |
| Cooling excess (NZA−EP) | 730.2 kWh | 100.3 kWh (212 h: NZA cools, EP floats <24) — 14 % | **654.4 kWh** (1022 h: both cool, NZA cools harder) — 86 % |

The asymmetry *is* the answer: cooling the float can only address the **mode-divergence** portion of
each gap. That portion is **80 %** of the heating shortfall but only **14 %** of the cooling excess.

### §4.2 — Mode-crossing reconciliation sweep

Shifting NZA's free-float down by δ, recoverable heating = EP demand in hours that flip
EP-heat/NZA-free → agree; removable cooling = NZA demand in hours that flip NZA-cool/EP-free → agree:

| δ (°C) | Reconciled heating | vs EP | Reconciled cooling | vs EP |
|---|---|---|---|---|
| 0.00 (baseline) | 2491.7 | −24.0 % | 1407.0 | +107.9 % |
| 0.49 (Brief nominal) | 2941.5 | **−10.3 % ✓** | 1306.8 | +93.1 % |
| 1.057 (P3 free-float mean) | 3037.8 | **−7.3 % ✓** | 1306.8 | +93.1 % |
| 3.00 (ceiling) | 3116.5 | **−4.9 % ✓** | 1306.8 | +93.1 % |

The free-float of the 1912 mode-divergent heating hours clusters just above 21 °C (min 21.00, median
**21.26**, mean 21.52, max 23.46). That tight clustering is *why* a modest downshift recovers so much:
δ=0.49 recovers 449.8 of the 624.8 kWh (72 %), δ=1.057 recovers 546.0 (87 %).

**Ceilings (every mode-divergent hour flipped):**

- **Heating → 3116.5 kWh = −4.9 % of EP → WITHIN ±15 %.** Residual is the 161.0 kWh same-setpoint
  gap (NZA books slightly less while both heat) — directionally also helped by a downshift but a
  magnitude effect, not quantified here. Heating is **closeable** by correcting the float.
- **Cooling → 1306.8 kWh = +93.1 % of EP → OUTSIDE ±15 %.** All 100.3 kWh of mode-divergent cooling is
  removed by δ=0.25 (those hours sit within 0.25 °C of 24), but the dominant 654.4 kWh — NZA cooling
  **~2× harder than EP at the same 24 °C setpoint** — is structurally immune to any temperature shift.
  Cooling is **not closeable** by correcting the float.

### §4.3 — Mech-vent (directional only)

The mech-vent net-loss gap (EP 665 vs NZA 1282 kWh, +92.9 %) behaves like cooling, not heating: a
directional proxy (net vent UA 14.85 W/K over shifted heating-mode hours) is 576 kWh at δ=0 and
**rises** to 811 kWh at δ=0.49 — cooling the float *adds* heating hours, moving the proxy *away* from
the lower EP value. The mech-vent over-loss is the same-setpoint-magnitude family, consistent with the
MVHR effective-recovery discrepancy flagged in P3 (NZA net/gross ≈ 54 % vs EP ≈ 82 %, both nominally
75 %). Read the trend; the absolute does not reconcile because the engine bundles recovery inside
`C_coef`.

### §4.4 — Outcome and prediction assessment

**OUTCOME (b) — hypothesis PARTIALLY confirmed.** Correcting the zone-temperature delta closes the
**heating** gap (a free-float-crossing phenomenon: 80 % of the shortfall is hours NZA floats just
above 21 °C while EP heats — reconciled to −5..−10 % of EP) but does **not** close the **cooling** gap
(86 % of the excess is NZA cooling ~2× harder at the same setpoint — a magnitude difference no
temperature shift can re-book). Mech-vent tracks cooling, not heating.

- **Demand-prediction: CORRECT.** §3.5 predicted (b) — heating closes, cooling does not. Confirmed.
- **Methodology-error: ACKNOWLEDGED.** My *first* re-booking method (NZA's own `−C_coef` law) was
  wrong and produced a non-physical +423 % explosion. I caught it on the physical smell test
  (CLAUDE.md Rule 3), diagnosed it as a capacitance-coefficient artifact (Rule 10), and replaced it
  with the mode-crossing method. The explosion is documented as Appendix A, not buried.

**Hard-STOP check:** Brief 82 says STOP if re-booking makes the gaps *worse*. Under the **correct**
(mode-crossing) method, re-booking moves both gaps *toward* EP (heating −24 %→−10 %; cooling
+108 %→+93 %) — neither is made worse, so no STOP. (The discarded naive method *appeared* to worsen
heating, but that was the documented artifact, not a real divergence.)

**What P4 hands to P5:** the divergence is **two findings, not one.** (i) A free-float warmth that
makes NZA settle ~1 °C above EP in unconditioned hours — loss-side/ΔT-driven per §3.3, and the sole
driver of the heating gap and the small cooling-mode-flip portion. (ii) A same-setpoint cooling (and
mech-vent) *magnitude* difference — NZA removes/loses ~2× the energy EP does at an agreed 24 °C — that
is independent of zone temperature. Brief 83 cannot be a single fix.

---

## §5 — P5: Candidate root cause verdict + evidence

### §5.0 — The hypothesis under test

Brief 82 opened with the hypothesis that the four Brief-81 divergences (heating −24.0 %, cooling
+107.9 %, mech-vent net loss +92.9 %, zone air +0.49 °C) are **one finding**: a zone free-floating
~0.5 °C warmer in NZA than EnergyPlus. P3 + P4 settle this.

**The strong-form hypothesis is REJECTED.** P4 proves the divergence is (at least) **two findings**:

- **Finding A — free-float warmth (~+1 °C in unconditioned hours).** Accounts for *all* of the heating
  gap and the small (14 %) cooling-mode-flip portion. Signature (P3): loss-side (free-float delta vs
  indoor−outdoor ΔT r = +0.52), night-heavy (+1.28 unoccupied vs +0.77 occupied), anti-correlated with
  outdoor temp (r = −0.60), **not** gains-driven. Closeable by cooling the float (P4 §4.2).
- **Finding B — same-setpoint magnitude difference (cooling + mech-vent).** NZA removes ~2× the
  cooling energy and loses ~2× the ventilation heat that EP does *at an agreed 24 °C setpoint*. 86 % of
  the cooling excess and all of the mech-vent gap. **Not** closeable by any temperature shift (P4
  §4.2–4.3).

This also refines Brief 81's guessed investigation order (§10.3): Brief 81 expected heating to be
"coupled, understood last." The opposite is true — **heating is the simplest** (a pure float-crossing
effect) and **cooling + mech-vent are the hard problem** (a same-setpoint magnitude difference).

### §5.1 — Candidate 3 (setpoint deadband handling) — REJECTED as a primary driver

Both engines use 21/24 °C; the IDF was authored to match the fixture (P1 premise-check D-series), so
this is not a config mismatch. The warmth is broad-spectrum across *all* free-float hours, not a
transition spike: transition |delta| 0.654 vs 0.491 °C elsewhere (P3 §3.4 Q5) — a minor boundary
effect, not the mechanism. **Confidence it is a material driver: low.**

### §5.2 — Candidate 2 (zone heat-balance solver convention) — best fit for Finding A

P4 surfaced new, quantified evidence: NZA's per-hour demand is an **implicit-Euler one-step solve**
whose coefficient `−C_coef = C_thermal/Δt + Σ(UA) ≈ 8793 W/K` is **dominated by thermal capacitance**
(lumped `C_thermal ≈ 31.7 MJ/K`; engine comment instantCalc.js L3659; P4 §4.0 / Appendix A). A
heavily mass-damped single-node implicit scheme anchors the free-float near its running mean and
resists nighttime cooling (the lumped mass releases stored heat overnight). That is *precisely* the
night-heavy, ΔT-driven, broad-spectrum warmth of Finding A — and it changes nothing in conditioned
hours (both engines pin to setpoint), matching the observed mode-asymmetry (delta ≈ 0 when
conditioned, ≈ +1 °C in free-float). EnergyPlus solves the zone balance with conduction transfer
functions and sub-hourly timesteps against *distributed* surface mass; a lumped-vs-distributed mass +
timestep-convention difference is the strongest single explanation for the free-float warmth.

**Discipline note (CLAUDE.md Rule 10 — no unquantified mass-artefact hand-waving).** This is offered
as the **best-fitting hypothesis**, not a proven cause. I have one quantified anchor (`C_thermal ≈
31.7 MJ/K` from the recovered `−C_coef`) but have **not** measured EnergyPlus's effective thermal mass
to confirm a mismatch, nor shown the +1 °C magnitude follows quantitatively from a mass/timestep
difference. Confirming or rejecting this requires a Brief 83 side-by-side mass/timestep comparison.
**Confidence: moderate, and explicitly contingent.**

### §5.3 — Candidate 1 (MVHR recovery coupling) — implicated for Finding B, but in tension for Finding A

The mech-vent accounting differs structurally and materially. Net vent loss: NZA 1.282 vs EP
0.665 MWh (+92.9 %). Effective sensible recovery: **EP 82.1 %** (heat-recovery sensible 3.0286 / OA
sensible heating 3.6882 MWh) vs **NZA 54.4 %** (recovery offset 1.531 / gross 2.813 MWh) — *both
nominally 75 %* (Brief 81 §6/§8). That is a real divergence in how each engine books
ventilation + recovery (NZA: single net loss + recovery offset; EP: OA-load-minus-recovery split),
and it sits squarely in Finding B (the magnitude/accounting family). It is the highest-signal Brief
83 target, echoing Brief 81 §10.3 item 1.

**But the sign is in tension for Finding A.** A naive "NZA over-recovers ⇒ retains more heat ⇒ floats
warmer" story is *contradicted by the numbers*: NZA's net vent **loss is higher** (1.282 > 0.665 MWh),
i.e. NZA loses *more* ventilation heat, which should make it **colder**, not warmer. So MVHR coupling
does not straightforwardly produce the free-float warmth — it is the leading explanation for the
mech-vent *magnitude* gap, not (on its face) for Finding A. **Confidence: high for the mech-vent
booking divergence; low that it directly causes the free-float warmth.**

### §5.4 — The same-setpoint cooling magnitude — partly unattributed (honest ambiguity)

The dominant 654.4 kWh (86 %) of the cooling excess is NZA cooling ~2× harder than EP while *both*
agree the zone is at 24 °C. No candidate cleanly explains this. Two non-exclusive possibilities: (i) a
cooling-side manifestation of the same vent-recovery accounting (with `summer_bypass: false`, sensible
recovery warms incoming supply air in summer — a recovery-*against*-you penalty whose magnitude
depends on the 54 % vs 82 % recovery difference), or (ii) a heat-balance gain term NZA books into the
cooling load that EP distributes differently. **This is genuinely ambiguous** and is flagged for Brief
83 rather than forced into a candidate.

### §5.5 — Verdict (confidence stated honestly)

| Finding | Best-fit candidate | Confidence | Note |
|---|---|---|---|
| A — free-float warmth (→ heating gap) | **2 (solver/mass convention)** | Moderate, contingent | Needs Brief 83 mass/timestep comparison; candidate 1 contradicted by loss sign |
| B-vent — mech-vent net loss +92.9 % | **1 (recovery booking)** | High | NZA 54 % vs EP 82 % effective recovery; structural booking difference |
| B-cool — same-setpoint cooling 2× | 1 or heat-balance gain term | Low / ambiguous | Summer recovery-against-you or gain attribution; unresolved |
| (deadband config) | 3 — **rejected** | n/a | Setpoints match; warmth is broad-spectrum, not a transition spike |

**The single-root-cause framing is wrong.** The evidence is *coupled and partly ambiguous* — exactly
the case Brief 82 said to report rather than manufacture certainty around. Candidate 2 best explains
the float warmth (heating gap); candidate 1 best explains the mech-vent booking; the same-setpoint
cooling magnitude is the genuinely open question. Brief 83 cannot be a single fix.

---

## §6 — P6: Close summary + Brief 83 recommendation

**Status: Brief 82 CLOSED 2026-06-03.** Diagnostic-only; no engine / IDF / DB change. All work on
`feat/energyplus-validation` (cut from `main` tip `d8a6207`); the branch was **never merged or pushed
to `main`** — `git branch --show-current` was verified before every commit, and `main` stayed at
`d8a6207` throughout.

### §6.1 — What Brief 82 delivered

| Part | Deliverable | Commit |
|---|---|---|
| P1 | Brief landing + branch verify + premise-check + audit §0/§1 | `89668d0` |
| P2 | Hourly zone-temp extraction, both engines (CSV ×2, opt-in extractor flag) | `a788be6` |
| P3 | Zone-temp trace comparison + divergence-regime analysis + report | `6a5992f` |
| P4 | Counterfactual re-booking test (mode-crossing reconciliation) + report | `9f2dace` |
| P5 | Candidate root-cause verdict + evidence | `090e832` |
| P6 | This close + STATUS update + Brief 83 recommendation | _(this commit)_ |

Reproduce: `node validation/nza_sim/extract.mjs --hourly-temps` (NZA trace),
`python validation/energyplus/extract_hourly_temps.py` (EP trace),
`python validation/zone_temp_diagnostic.py` (P3 regimes),
`node validation/nza_sim/counterfactual_rebook.mjs` (P4 load-bearing test).

### §6.2 — The finding in one paragraph

Brief 81's four divergences are **not one finding.** They are at least two. **(A)** NZA free-floats
~+1 °C warmer than EnergyPlus in unconditioned hours (loss-side, night-heavy, ΔT-driven, not
gains-driven). This *fully* explains the heating gap: 80 % of the −24.0 % shortfall is hours NZA
floats just above 21 °C (median float 21.26 °C) while EP heats; cooling that float reconciles heating
to −10.3 % at the nominal 0.49 °C shift (−4.9 % ceiling). **(B)** A same-setpoint *magnitude*
difference: NZA removes ~2× the cooling and loses ~2× the ventilation heat that EP does at an agreed
24 °C setpoint. This is 86 % of the +107.9 % cooling excess and all of the +92.9 % mech-vent gap, and
**no temperature shift can re-book it** (P4 §4.2). The counterfactual test is therefore **outcome (b)
— partial**, matching the P3 prediction.

### §6.3 — Recommended Brief 83 scope: MULTIPLE threads, not one fix

The single-fix framing is rejected by the evidence. Brief 83 should be **staged**, highest-signal
first:

1. **Thread 1 — Mech-vent / heat-recovery booking (Finding B-vent).** Reconcile NZA's single net loss
   + recovery offset (54.4 % effective) against EnergyPlus's OA-load-minus-recovery split (82.1 %
   effective), both nominally 75 %. Highest signal, most likely a genuine accounting/definitional bug,
   and may cascade into the cooling magnitude. Echoes Brief 81 §10.3 item 1.
2. **Thread 2 — Free-float warmth (Finding A).** Quantitative side-by-side of NZA's lumped
   implicit-Euler node (`C_thermal ≈ 31.7 MJ/K`, `−C_coef ≈ 8793 W/K`) vs EnergyPlus's CTF /
   distributed-mass treatment at matched timesteps. Confirm or reject candidate 2 (solver/mass
   convention) as the cause of the +1 °C float. This is the heating-gap driver.
3. **Thread 3 — Same-setpoint cooling magnitude.** Re-measure *after* threads 1–2; likely partly
   resolved by the summer recovery-against-you mechanism (Thread 1) and the float (Thread 2). If a
   residual 2× remains, investigate the cooling-side gain attribution in the zone balance.

Confidence: candidate 3 (deadband) rejected; candidate 1 high-confidence for the vent booking but in
*tension* for the warmth (NZA loses more vent heat, which should cool it); candidate 2 the best-fit
but *contingent* hypothesis for the warmth, needing Thread 2 to confirm. The evidence is honestly
**coupled / partly ambiguous** — not forced.

### §6.4 — Brief discipline / safety

No hard-STOP triggered under the corrected method (re-booking moved both gaps *toward* EP, never
worse; the discarded naive `−C_coef` method's apparent worsening was a documented capacitance
artifact, P4 §4.0 / Appendix A). No engine, IDF, or DB changes. Only Brief-82 files were staged at
each commit (pre-existing dirty working-tree files were left untouched). `main` remained `d8a6207`;
branch pushed to origin without merge.
