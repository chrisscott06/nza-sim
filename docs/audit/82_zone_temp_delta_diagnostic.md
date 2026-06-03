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

_(to be written at P2)_

EnergyPlus side: confirm IDF requests `Zone Mean Air Temperature` Hourly; capture
`bridgewater_box_v1_hourly_temps.csv`. NZA-Sim side: surface `result.demand.hourly_zone_air_c` through
the extract path into a matching CSV. Document hour-indexing convention (hour-beginning vs
hour-ending) for both. Falsifiability: 8760 rows each, both starting hour 0 of 1 Jan, 10-hour
hand-spot-check.

---

## §3 — P3: Temperature trace comparison + divergence regime analysis

_(to be written at P3)_

`validation/zone_temp_diagnostic.py`: hour-by-hour delta (T_NZA − T_EP), annual + monthly stats,
divergence-regime classification, and the five evidence questions (constant vs conditional; vent
correlation; gains correlation; heating/cooling/free-float mode asymmetry; setpoint-transition
exaggeration). Report → `validation/reports/zone_temp_diagnostic_{ts}.md`.

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
