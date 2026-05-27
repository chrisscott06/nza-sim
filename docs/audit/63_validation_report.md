# Brief 63 — Engine validation harness: final report

**Status:** HARNESS GREEN — 242 PASS / 0 FAIL / 0 BLOCKED
**Generated:** 2026-05-27 (this report); harness re-runs on every commit going forward.
**Run command:** `node scripts/validate_engine.mjs` (or `npm run validate` from `frontend/`)
**Outputs:** `docs/audit/63_validation_matrix.md` (auto matrix) · `docs/audit/63_validation_report.json` (machine-readable) · this file (narrative)
**Project tested:** HIX Bridgewater (GIA 4322 m²) on Yeovilton TMYx weather. Anchor: EUI 110.30 kWh/m²·yr held.

---

## §1 The matrix

| Category | Description | PASS | FAIL | BLOCKED |
|---|---|---:|---:|---:|
| **A** | Monotonicity / direction (every input × affected output) | 40 | 0 | 0 |
| **B** | Bounds / physical limits | 36 | 0 | 0 |
| **C** | Conservation / balance / same-number-two-places | 30 | 0 | 0 |
| **D** | No-op invariance (no spurious cross-coupling) | 78 | 0 | 0 |
| **E** | Ordering / parity (intervention stack + baseline-edit parity) | 16 | 0 | 0 |
| **F** | Reconciliation (every Δ stacks up across panels) | 42 | 0 | 0 |
| **Total** | | **242** | **0** | **0** |

Every test derives its expected answer from first principles or from the engine's own
declared bookkeeping — no recorded-baseline calibration. Failure modes the brief
specifically called out (carrier-vs-EUI gap, +714 / +9 Δ-column bugs, source-mismatch
class) all have permanent assertions in the battery now and would re-surface as red
on any regression.

Per-test pass/fail detail lives in `docs/audit/63_validation_matrix.md` (matrix) and
`docs/audit/63_validation_report.json` (machine-readable).

---

## §2 Fixes applied during construction (grouped by root cause)

The harness ran 13 RED on first construction-complete run. Every RED was a harness
or P1-introspection wiring bug — the engine's actual computations all PASS. No
tolerances were tweaked. Fix groups:

### §2.1 P1 introspection field correction — `*_setpoint_source` reading wrong source

**Symptom:** C19 RED ("heating_setpoint_source = 'comfortBand' when mode=follow_comfort"
— but field reported `custom_override` on baseline).

**Root cause:** P1's `heating_setpoint_source` / `cooling_setpoint_source` fields
were derived from `opts?.setpointOverride?.heating` — i.e. they detected whether
the engine call carried a numeric override. But after Brief 62 P2, the override is
ALWAYS populated with a resolved number (by `_resolveSetpointForState2`), regardless
of whether the user chose `follow_comfort` or `custom`. So the detection always
read `custom_override`. The field was meaningless.

**Fix:** Read the source from the building config itself —
`building?.systems_config_v40?.heating_setpoint_mode === 'custom' ? 'custom' :
'comfortBand'`. This signal reflects user intent (what the user chose), which is
what tests and UI consumers actually want to know.

**Engine diff:** `frontend/src/utils/instantCalc.js:3741-3747` (P1 amendment in same
commit as P2).

**Anchor preserved:** Bridgewater EUI 110.30 unchanged.

### §2.2 Harness wiring — DHW pump double-count in carrier-sum

**Symptom:** C01-C05 RED (Σ per-service elec exceeded total_elec by exactly 1.05 MWh
across every snap).

**Root cause:** `consumption.dhw.electricity_mwh` already INCLUDES the circulation
pump (engine adds it inside `_computeDhw` before reporting). The harness was adding
`dhw_pump_mwh` separately as if it were a distinct carrier — double-counting.

**Fix:** Removed `dhw_pump_mwh` from the carrier sum. The field stays exposed in
the snap as a diagnostic but is no longer summed.

### §2.3 Harness wiring — `runInterventionStack` callback shape

**Symptom:** E06-E11 RED — intervention-stack tests returned uninterpretable values.

**Root cause:** `runInterventionStack(cfg, list, runEngine, libraryData)` calls
`runEngine(cfg)` with the FULL config quartet `{building, constructions, systems,
libraryData}`, not just `building`. My callback was `runEngine(building)` —
treating the entire cfg as if it were a building.

**Fix:** Introduced `runEngineFromCfg(cfg)` that unwraps `cfg.building` and
`cfg.constructions` and forwards to `runEngine`. Also fixed `runStack(stack)` to
return baseline when no enabled interventions exist (previously crashed on
`interventions[length-1].result` being undefined).

### §2.4 Harness formulation — heating demand reconstruction (C20)

**Symptom:** C20 RED ("heating_demand ≈ losses − ig_offset − solar_beneficial −
recovery_offset" — off by 93.7 MWh, almost exactly recovery_offset).

**Root cause:** My reconstruction formula subtracted `recovery_offset_mwh` on top
of using `los_total_heat_loss_kwh`. But `losses_at_setpoint.ventilation[].heat_loss_kwh`
already has HRE applied — it's the POST-recovery vent loss. Subtracting recovery_offset
again removes the recovery twice.

**Fix:** Drop `recovery_offset` from the formula:
`heating_demand ≈ losses_at_setpoint_total − ig_offset_heating − solar_beneficial`.
Closes within 0.4 MWh (0.16% of 245.6 MWh demand). Same closure verified on hsp_28
sweep point.

### §2.5 Harness setup — parity comparison value mismatch (E06)

**Symptom:** E06 RED — comparing `scop=4.0 baseline edit` against an intervention
that was assembled with `value: 4.0` but labeled `scop=3.5`.

**Root cause:** Cut-paste confusion in the test setup — the comparison was correct
in intent but the variable naming was inconsistent.

**Fix:** Re-built E06 cleanly, comparing `snaps.scop_hi` (scop=4.0 baseline edit)
to an intervention that ALSO sets scop=4.0. Parity holds exactly.

---

## §3 Modelling-judgement escalations for Chris (the only things needing input)

**ESCALATION LIST IS EMPTY.** Every fix was determined by physics or by an existing
ruling. The cooling-clamp question (Chris ratified verbatim) is a queued engine
brief, not a judgement question — the harness documents it via B13/B13b/B13d notes
and remains green under the current bucketed model.

---

## §4 Known queued brief (NOT in scope for Brief 63)

### Cooling-clamp engine brief — queued

**Chris's ratified decision (Brief 62 follow-up):** cooling acts as an active clamp.
If the user sets the room to 18°C, the system delivers 18°C, holding T_air at the
cooling setpoint in every hour the building would otherwise be warmer. This replaces
the current "surplus overspill" model where the cooling setpoint is ignored in
heating-direction hours (T_out < 21).

**How the battery handles it:**
- B11 / B12 / B13 / B13b assert `cooling_demand ≤ Σ gains`. Under the current
  bucketed engine on Bridgewater they pass because the bucketed model doesn't
  produce vast over-shoots on baseline-saved configs. Under the cooling-clamp
  model they'd PASS by construction.
- B13d documents the cooling-setpoint sensitivity in vent-off (Δ small under
  bucketed; Δ large under clamp). The test asserts only direction (cannot
  decrease) — both models satisfy this.
- The 397-vs-198 Energy Flows display doubling is a separate display bug; B22 +
  the broader F-family Δ-reconciliation tests would catch it if it shifted the
  Calc Trail's headline. Chris's walkthrough §5 is the in-tool verification.

When the cooling-clamp brief lands, the battery doesn't need new tests for the
clamp itself — the existing bound assertions become its proof of correctness.
Expect cooling demand on Bridgewater to RISE meaningfully (Chris ratified this is
correct and expected, not drift).

---

## §5 IN-SCREEN WALKTHROUGH — nominated spot-checks for Chris

The harness validates engine OUTPUT. A green harness does NOT prove DISPLAYS are
correct (a panel can render a stale or wrong number while the engine reconciles).
The walkthrough is the spot-check that harness verdict matches the live tool.

**Per the brief: "the harness's verdict must match the live tool — if not, the
harness is incomplete and gets a display-layer assertion added."**

For each item below, perform the action in the running app at :5178, confirm the
on-screen number matches the harness's expected/actual value, tick ✓/✗:

### Spot-check 1 — Monotonicity (A category)
**Test A05:** Heating setpoint 19→28°C raises EUI.
- **In tool:** Systems → set heating setpoint mode = `custom`, value = `28`. Wait for re-run.
- **Harness expected:** EUI rises (snaps: hsp_19 vs hsp_28).
- **Live numbers (harness):** check `docs/audit/63_validation_report.json` for `snaps.hsp_28.eui_kwh_per_m2` vs `snaps.hsp_19.eui_kwh_per_m2`.
- **What to look for:** Home page EUI should climb from baseline (110.30) by roughly the harness's recorded amount. Tick ✓ if it does.

### Spot-check 2 — Bound (B category) — vent-off cooling
**Test B13:** Vent OFF → cooling_demand ≤ Σ gains.
- **In tool:** Systems → toggle ventilation systems to disabled. Wait for re-run.
- **Open:** Energy Flows panel. Read cooling demand. Read Σ gains (lighting + small power + people + solar).
- **Harness expected:** demand ≤ gains.
- **What to look for:** The cooling demand panel value should not exceed the gains panel value. The Brief 62 follow-up "397 MWh vs gains" concern is THIS test — if it ever goes red in the live tool but green in the harness, the display is doubling the cooling number (the suspected separate display bug Chris flagged).

### Spot-check 3 — Conservation (C category) — carrier-vs-EUI
**Test C01:** baseline: total_elec = Σ per-service elec.
- **In tool:** Open Calc Trail panel (Interventions → any view → "calctrail").
- **Read:** Total electricity headline; sum the per-service electricity rows (heating + cooling + DHW + fans + lighting + small power).
- **Harness expected:** sum = headline, exactly (within 0.3 MWh).
- **What to look for:** The fuel-totals band should sum without a "carrier gap". Brief 60 Part A's reconcile gate already runs this on the panel; harness confirms it for every sweep point.

### Spot-check 4 — Conservation (C category) — same number two places
**Test C13:** consumption.total.eui ≈ brief40.totals.eui.
- **In tool:** Compare the EUI shown on Home (consumption.total path) with the EUI shown on Results / Performance (brief40.totals path).
- **Harness expected:** within 0.5 kWh/m².
- **What to look for:** The headline EUI should be the same number on both screens. If they differ, the harness's same-number-two-places assertion needs to extend to that specific display surface.

### Spot-check 5 — Ordering / parity (E category)
**Test E01:** Two interventions stacked are order-independent.
- **In tool:** Create two interventions: A = SCOP 3.5 (heating efficiency), B = SEER 4.5 (cooling efficiency). Enable both. Note total_elec / EUI.
- **Reorder:** Drag B above A. Note total_elec / EUI.
- **Harness expected:** identical to within 0.05 MWh.
- **What to look for:** The Headline shouldn't move when you reorder. Brief 55 P3 already had this as a regression fixture; harness makes it permanent.

### Spot-check 6 — Reconciliation (F category) — Δ stacks up
**Test F03:** baseline → csp_18 Δ_total_elec = Σ Δ_per-service.
- **In tool:** Apply intervention: cooling_setpoint_mode=custom, cooling_setpoint_c=18. Open Calc Trail.
- **Read:** Δ columns for total electricity and for each per-service electricity row.
- **Harness expected:** Δ_total = Σ Δ_per-service.
- **What to look for:** No Δ-row inconsistency. The Brief 60 walkthrough fix (`convertTrioConsistently`) prevents the Δ-unit mismatch class; this test confirms it across all sweep points permanently.

### Spot-check 7 — Heat-balance / Sankey on screen
- **In tool:** Open the Sankey diagram (Systems → Heat balance tab).
- **Read:** Total gains in (lighting + small power + people + solar) and total losses out (envelope + vent + delivered cooling) — heating delivered enters as a source.
- **Expected (physical):** Σ in = Σ out (annual). The harness's C20 closes within 0.4 MWh; the diagram should look balanced.
- **What to look for:** If gains node and losses node diverge visibly, the Sankey is reading a different source than the engine.

### Spot-check 8 — Setpoint→demand move on screen
- **In tool:** Edit heating setpoint 21°C → 24°C. Open Home page.
- **Expected (physical):** demand_heating, fuel_heating, total_elec, EUI all increase.
- **What to look for:** The whole consumption chain moves together. Brief 62 P2 closed the demand-frozen bug; this is the visible proof.

---

## §6 Permanent regression guard

### Run command
```
node scripts/validate_engine.mjs
```
Or from `frontend/`:
```
npm run validate
```

### Exit code
- `0` if all PASS
- `1` if any FAIL (CI-ready)

### Outputs
- `docs/audit/63_validation_report.json` — machine-readable matrix (full snap + per-test record)
- `docs/audit/63_validation_matrix.md` — human-readable matrix (all 242 tests with status)
- `docs/audit/63_validation_report.md` — this narrative report (overwrite manually when re-reporting; the script doesn't touch it)
- Console: pass/fail summary per category + failure detail with diffs

### Performance
~5 seconds for 242 assertions across 30 engine runs on a 4322 m² building × 8760 hours.

### Wiring
- `frontend/package.json`: added `"validate": "node ../scripts/validate_engine.mjs"` to scripts.
- The harness assumes the verification DB is running on `http://127.0.0.1:8003` with the
  Bridgewater project at id `14b4a5b1-8c73-4acb-8b65-1d22f05ec969`. Both can be overridden:
  ```
  NZA_API=http://127.0.0.1:8002 NZA_PROJECT_ID=<id> node scripts/validate_engine.mjs
  ```
- Verification DB setup documented in Brief 53 sidecar (env-var DB override).

### Cooling-clamp brief — re-run expectation
When the cooling-clamp brief lands, expect:
- B13 family to PASS (was already PASS on bucketed)
- B13d to show a LARGER Δ (correct physics — bucketed→clamp inverts the
  cooling-setpoint sensitivity in vent-off)
- A05-A10 setpoint-monotonicity tests to PASS with steeper slopes
- Bridgewater anchor EUI 110.30 → expected to MOVE upward; the harness gates
  on consistency, not on absolute baseline EUI ("drift" is not a failure per
  Brief 61 governing principle)

---

## §7 What this brief delivered

Five deliverables from the brief, all complete:

1. ✅ **Introspection layer** (P1, commit c8320fc + P2 correction in e68f558):
   regime-hour counters, bypass-by-regime, resolved setpoint provenance with
   user-intent source flag. Engine outputs unchanged on existing fields.

2. ✅ **Comprehensive physics assertion battery** (P2): 242 assertions across
   six categories, every expected answer derived from first principles.

3. ✅ **Autonomous run → diagnose → fix → re-run loop** (P3): initial 13 RED
   were all harness wiring / formulation bugs (no engine FAILs); fixed in
   place, re-ran, green. No genuine modelling-judgement escalations needed.

4. ✅ **Permanent regression harness** (P4): wired as `npm run validate` and
   `node scripts/validate_engine.mjs`. Non-zero exit on red. CI-ready.

5. ✅ **One report** (this file + the matrix + the JSON): every test, every
   fix with root cause, the empty escalation list, the walkthrough nominations.

---

## §8 What remains queued (NOT in Brief 63 scope)

| Item | Status | Notes |
|---|---|---|
| Cooling-clamp engine change | Queued | Chris ratified verbatim post-Brief-62. Battery is written to accept the change without rewriting tests. |
| 397-vs-198 Energy Flows display doubling | Queued | Separate display bug; harness's same-number assertions should catch when the display is wired to a doubled source. Walkthrough §5.2 spot-checks it. |
| Brief 60 Part B | Pending | Auxiliary energy in Internal Gains. |
| Brief 60 Part C | Pending | Baseline/intervention parity guard. Partly subsumed by E06-E09c in this harness. |

---

## §9 Anchor confirmation

Bridgewater clean baseline EUI: **110.30 kWh/m²·yr** before and after Brief 63
P1+P2. All introspection fields are additive; no existing number changed.

```
baseline   EUI=110.30  total_elec=329.13  total_gas=147.65  scop=2.57  seer=3.50
```

The breakdown-dump intervention chain (99.70 → 95.70 over Brief 55's test stack)
also held unchanged across P1+P2 — verified by the parity tests in category E.
