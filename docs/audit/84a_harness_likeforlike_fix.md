# Brief 84a — Harness like-for-like comparison fix (mech-vent on coil-run hours) — audit

**Branch:** `feat/energyplus-validation` (continuation of Briefs 81 + 82 + 83). **NEVER merged to `main`.**
**Brief:** [`docs/briefs/active/84a_harness_likeforlike_fix.md`](../briefs/active/84a_harness_likeforlike_fix.md).
**Design note:** [`docs/design-notes/84a_harness_likeforlike_fix.md`](../design-notes/84a_harness_likeforlike_fix.md).
**Companion:** Brief 84b (Finding A characterisation) — separate, parallel.

---

## §0 — Context and receipt

Brief 83 closed diagnostic-only: there is **no MVHR recovery-booking bug.** The "+92.9 % mech-vent net
loss" gated FAIL in Brief 81 is a **comparison-framework domain mismatch**, not an engine defect:

- NZA-Sim `losses.mech_ventilation` = a **zone-balance loss-at-setpoint** term, `ventUA·(21 − T_out)`
  accrued over *every* heating-degree hour (`ventUA = flow·ρCp·(1 − HRE)`, with the nominal 75 % HRE
  folded in).
- EnergyPlus = a **coil OA load** (`oa_sensible − heat_recovery`) accrued only over coil-run hours.

Brief 83 P4's per-hour data is decisive: in the **4426** hours EnergyPlus's heating coil actually runs,
NZA agrees with EP to **3.7 %** (NZA 0.914 vs EP 0.882 MWh; per-hour recovery ~75 % both sides). The
+92.9 % decomposes (Brief 83 §4.3): **59 %** NZA books a vent loss in free-float hours EP's coil is off,
**36 %** EP's HX warms incoming OA in cooling-season hours (negative net), **5 %** shared-hour ΔT
reference. **100 % of the excess lives in free-float hours** (Finding A territory).

**Brief 84a's job:** make `compare.py` pair the mech-vent metric like-for-like (coil-run hours, or
NZA's demand-domain number) so the gated comparison reads honestly (~+3.7 % PASS) — **harness only, no
engine/IDF change, no tolerance change.**

**Hard-STOPs:** no engine/IDF code; no tolerance re-tuning; only the mech-vent comparison; no merge to
`main`; escalate after 60 min on any sub-problem; if P4 mech-vent doesn't land near +3.7 %, one P2
refinement then STOP.

---

## §1 — P1: Brief + design note landing + branch verify

- Branch: `git branch --show-current` → `feat/energyplus-validation`. ✓
- Branch tip at landing: `b955d22` (Brief 83 P8 close). ✓ (brief expected `b955d22` or later)
- `main`: `d8a6207` (local and `origin/main`) — **unchanged since the branch cut.** ✓
- Brief landed at `docs/briefs/active/84a_harness_likeforlike_fix.md` (verbatim from authorised source).
- Design note landed at `docs/design-notes/84a_harness_likeforlike_fix.md` (verbatim; matches the
  canonical sibling). New `docs/design-notes/` directory created.
- This audit stub opened.

Commit: `Brief 84a P1: brief + design note landing`.

---

## §2 — P2: Like-for-like definition choice + implementation plan

### §2.1 — The current (mis-paired) comparison

`compare.py` is JSON-only. The gated mech-vent row (L147-157) reads two **annual** scalars from the
normalised result JSONs:

```python
nza_mv    = g(nza, "mech_ventilation_mwh", "loss")                       # 1.282 MWh, ALL heating-degree hours
ep_mv_net = (ep_oa_h - ep_hr_h) + (ep_oa_c - ep_hr_c)                    # 0.665 MWh, coil-domain, ALL hours
d = pct_delta(nza_mv, ep_mv_net)                                         # +92.9 %  -> FAIL
```

The two scalars are different accounting objects over different hour domains (Brief 83 §3.4 / §5.2).

### §2.2 — Which option is cleaner: option 1 (coil-run hours), decisively

The brief offers two like-for-like definitions:

- **Option 1 — coil-run hours.** Sum each engine's net mech-vent over the hours **EnergyPlus's coil
  actually runs**, then compare. This is a **cross-engine per-hour join**: NZA's per-hour loss gated by
  EP's per-hour coil-run flag. The join can only live in `compare.py` (the only component that sees
  both engines' per-hour series).
- **Option 2 — demand-domain field.** Use a NZA "State-3 demand-domain" mech-vent scalar instead.

**Option 2 is rejected.** There is no clean pre-existing NZA scalar for "net mech-vent over EP's
coil-run hours." The normalised JSON carries only `mech_ventilation_mwh.loss` (1.282, all hours) and
`mech_ventilation_mwh.recovery_offset` (1.531, State-3 display-capped — not a net loss). A NZA
State-3 number would be summed over *NZA's* coil hours, not *EP's*, so it would not reproduce the
Brief 83 §7.2 like-for-like agreement and would need a new engine-output field. Option 1 reuses the
Brief 83 P4 per-hour CSVs already on disk, needs **no new fields and no engine/extractor change**, and
reproduces §7.2 exactly. The brief itself points here ("The opt-in MVHR diagnostic outputs from Brief
83 P4 should already provide everything needed — verify").

### §2.3 — The exact definition (verified to reproduce +3.7 %)

Per-side, over **EnergyPlus coil-run hours**:

- **heating side:** sum `net_mech_vent_heating_kwh` (both engines) over hours where EP
  `supply_air_heating_kwh > 0`.
- **cooling side:** sum `net_mech_vent_cooling_kwh` (both engines) over hours where EP
  `supply_air_cooling_kwh > 0`.

Per-side gating drops EP's −0.222 MWh free-float/shoulder negative-net tail (heat-recovery warming OA
with no OA coil load — non-coil hours) and NZA's +0.368 MWh free-float booking — the two pieces that
made the all-hours numbers diverge (Brief 83 §4.3). Verified directly from the P4 CSVs (read-only):

| Metric | NZA-Sim | EnergyPlus | Delta |
|---|---|---|---|
| Net mech-vent, **all hours** (current gated) | 1.287 | 0.665 | **+93.6 %** |
| Net mech-vent, **EP coil-run hours (per-side)** | 0.919 | 0.887 | **+3.6 %** |
| — heating side (4426 h) | 0.9139 | 0.8816 | +3.7 % |
| — cooling side (1173 h) | 0.0051 | 0.0052 | −1.9 % |

The +3.6 % matches Brief 83 §7.2 (+3.7 %, heating-side-only framing); the 0.1 % difference is the
small cooling side now folded in. 4426 heating-coil hours matches Brief 83 §4.3 exactly.

### §2.4 — Implementation plan (P3)

A single new helper in `compare.py`, used only by the mech-vent gated row:

```python
def mech_vent_like_for_like(fixture):
    """Sum net mech-vent over EP coil-run hours, per-side, from the Brief 83 P4 CSVs.
       Returns (nza_mwh, ep_mwh, n_heat_hours, n_cool_hours) or (None, None, 0, 0) if absent."""
    ep_csv  = EP_RESULTS  / f"{fixture}_mvhr_hourly.csv"
    nza_csv = NZA_RESULTS / f"{fixture}_mvhr_hourly.csv"
    if not (ep_csv.exists() and nza_csv.exists()):
        return None, None, 0, 0
    # join by hour_index; gate by EP supply_air_heating/cooling > 0; sum net_mech_vent_*_kwh both sides
    ...
```

- Gated row: when the helper returns values, the gated `nza_mv` / `ep_mv_net` become the like-for-like
  MWh (label updated to note "EP coil-run hours"); a one-line comment references the design note.
- **Graceful degradation:** if the CSVs are absent, fall back to the existing all-hours JSON metric and
  add an explicit note in the report that the like-for-like CSVs were not found.
- **Honesty (Rule 9 spirit):** the old all-hours framing (1.282 vs 0.665, +93 %) is **kept as an INFO
  row** labelled "heat-balance domain / all heating-degree hours", so the original number and its
  meaning are preserved, not hidden.
- **Untouched:** every other gated/info row, all tolerances, all engine/IDF code. Only the mech-vent
  comparison changes.

**CSV dependency note.** The like-for-like row reads the P4 `*_mvhr_hourly.csv` files. These are
opt-in (Brief 83: off by default) and committed at `b5129f8`; P4 of this brief regenerates them fresh
(`extract.mjs --mvhr-hourly` + `extract_mvhr_hourly.py`) before the verification run. If they are
missing, the row degrades to the all-hours metric with a visible note (never a silent +93 % FAIL).

Commit: `Brief 84a P2: like-for-like definition choice + impl plan`.

---

## §3 — P3: Like-for-like mech-vent comparison (the diff)

**File:** `validation/compare.py` only. **No engine/IDF/tolerance change.** The diff has four parts:

1. **`import csv`** (stdlib) added.
2. **New helper `mech_vent_like_for_like(fixture)`** — reads the two Brief 83 P4 `*_mvhr_hourly.csv`
   files, joins by `hour_index`, and sums each engine's net mech-vent over EP coil-run hours per side
   (heating where EP `supply_air_heating_kwh > 0`; cooling where `supply_air_cooling_kwh > 0`). Returns
   `(nza_mwh, ep_mwh, n_heat_hours, n_cool_hours)`, or `(None, None, 0, 0)` if the CSVs are absent. A
   docstring + the gated-row comment cite Brief 83 §3.4/§5.2/§7.2 and the design note.
3. **Mech-vent gated row rewritten.** It still computes the all-hours scalars (`nza_mv_all` 1.282,
   `ep_mv_all` 0.665) but the **gated** value now uses the like-for-like sums when the CSVs are present
   (label "Mech-vent loss (net, EP coil-run hours)"), appending a Note with the coil-hour counts. If
   the CSVs are absent it falls back to the all-hours scalars (label flags this) with a Note telling the
   user how to regenerate them. The old all-hours number is **retained as an INFO row** ("all
   heating-degree hours, heat-balance domain") — CLAUDE.md Rule 9: the all-hours vent loss is a real
   zone-balance term, so it stays visible. The gross/recovery info rows are unchanged (gross still uses
   the all-hours NZA loss + recovery offset).
4. **`notes` threaded through** `build_rows(ep, nza, fixture)` → `render(..., notes, ts)` → a "**Notes**"
   block under the verdict. The mech-vent interpretation bullet was updated to describe the like-for-like
   pairing.

No other gated/info row, no tolerance, and no engine/IDF code was touched.

### §3.1 — Smoke-test (read-only, existing JSON + committed P4 CSVs)

`python validation/compare.py --stdout` (P4 does the full fresh re-run):

| Gated metric | NZA | EP | Delta | Result | vs Brief 81 |
|---|---|---|---|---|---|
| EUI | 160.4 | 166.6 | −3.7 % | PASS | unchanged |
| Heating demand | 2.492 | 3.278 | −24.0 % | FAIL | unchanged (Finding A) |
| Cooling demand | 1.407 | 0.677 | +107.9 % | FAIL | unchanged (Finding A) |
| Fabric conduction (total) | 5.454 | 4.909 | +11.1 % | PASS | unchanged |
| **Mech-vent (net, EP coil-run hours)** | **0.919** | **0.887** | **+3.6 %** | **PASS** | **was +92.9 % FAIL** |
| Monthly heating r | — | — | 0.9933 | PASS | unchanged |
| Monthly cooling r | — | — | 0.9446 | PASS | unchanged |

**Verdict 5/7 gated (was 4/7).** Mech-vent flipped FAIL→PASS; every other metric byte-identical. The
all-hours framing shows as an info row (1.282 vs 0.665, +92.9 %); the Note records 4426 heating / 1173
cooling coil hours. The remaining heating/cooling FAILs are Finding A — correctly out of 84a scope
(Brief 84b).

Commit: `Brief 84a P3: like-for-like mech-vent comparison`.

---

## §4 — P4: Post-fix harness re-run + verification

Full fresh re-run (all inputs `compare.py` consumes regenerated, not stale artifacts):

```
python validation/energyplus/run.py                       # EP re-run: heating 3.2775, cooling 0.6768, EUI 166.6
python validation/energyplus/extract_mvhr_hourly.py       # EP MVHR CSV: net heat 0.6596, cool 0.0052, recovery ratio 0.821
node   validation/nza_sim/extract.mjs                      # NZA JSON: heating 2491.7, cooling 1407.0 kWh
node   validation/nza_sim/extract.mjs --mvhr-hourly        # NZA MVHR CSV: net heat 1.2820, cool 0.0051 (HRE 75%)
python validation/compare.py                               # -> validation/reports/bridgewater_box_v1_2026-06-08T09-49-07Z.md
```

Report: `validation/reports/bridgewater_box_v1_2026-06-08T09-49-07Z.md`. **Verdict FAIL, 5/7 gated**
(was 4/7). All upstream numbers identical to Brief 81/83 (no engine/IDF change), confirming the only
movement is the mech-vent comparison basis.

### §4.1 — Row-by-row: Brief 81 vs Brief 84a

| Gated metric | Brief 81 (all-hours) | Brief 84a (like-for-like) | EnergyPlus | Result |
|---|---|---|---|---|
| EUI (kWh/m²) | 160.4 (−3.7 %) | 160.4 (−3.7 %) | 166.6 | PASS (unchanged) |
| Heating demand (MWh) | 2.492 (−24.0 %) | 2.492 (−24.0 %) | 3.278 | FAIL (unchanged — Finding A) |
| Cooling demand (MWh) | 1.407 (+107.9 %) | 1.407 (+107.9 %) | 0.677 | FAIL (unchanged — Finding A) |
| Fabric conduction total (MWh) | 5.454 (+11.1 %) | 5.454 (+11.1 %) | 4.909 | PASS (unchanged) |
| **Mech-vent net loss (MWh)** | **1.282 (+92.9 %)** | **0.919 (+3.6 %)** | 0.887 / 0.665 | **FAIL → PASS** |
| Monthly heating r | 0.9933 | 0.9933 | — | PASS (unchanged) |
| Monthly cooling r | 0.9446 | 0.9446 | — | PASS (unchanged) |
| **Gated within tolerance** | **4 / 7** | **5 / 7** | | **+1** |

The mech-vent **EP reference** changes from 0.665 (all-hours coil-domain incl. the −0.222 free-float
negative tail) to 0.887 (coil-run hours only); the **NZA value** changes from 1.282 (all
heating-degree hours) to 0.919 (coil-run hours). Delta +92.9 % → +3.6 %.

### §4.2 — Hard-STOP checks (all clear)

- **Mech-vent lands near +3.7 %?** Yes — +3.6 % (the 0.1 % vs Brief 83 §7.2's heating-only +3.7 % is
  the cooling side now folded in). No P2 refinement needed.
- **Any other metric move from the Brief 81 baseline?** No — EUI, heating, cooling, fabric, all three
  correlations, and every info row are identical. The implementation did not leak.
- **Honesty preserved?** The Brief-81 all-hours framing is present as an info row (1.282 vs 0.665,
  +92.9 %), and a Note records the coil-hour counts (4426 heating / 1173 cooling). Nothing hidden.
- **Regenerated result JSONs** differ only by their `captured_at` timestamp (verified) — left unstaged
  (not a 84a deliverable); the MVHR CSVs regenerated byte-identical.

Commit: `Brief 84a P4: post-fix harness re-run + verification`.

---

## §5 — P5: Close summary + STATUS update

_(to be written at P5)_
