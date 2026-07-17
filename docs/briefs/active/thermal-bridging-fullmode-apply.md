# Brief — Thermal bridging: apply H_TB in the full-mode / State-3 demand integral (Rule-14 parallel-path fix)

**Status:** ACTIVE · **Author:** engine audit follow-up · **Opened:** 2026-07-15
**Origin:** E5 finding, `docs/audit/bridgwater-model2-calibrated_close.md` (Part 4 — D3 inert-input trace).
**Branch:** cut a fresh branch off `main` (e.g. `chris/thermal-bridging-fullmode-apply`) **only
after the merge gate clears** — see BEFORE-DOING-ANYTHING step 0. Do NOT build on
`chris/bridgwater-model2-calibrated`.
**GATED:** approved but blocked until the full PR stack (#20, #22, B, C) is merged and P02's numbers
are frozen. Do not start before then.
**RE-GATE (Final-P02, 2026-07-17):** the P02 number-freeze point has **moved to the close of
`final-p02-run`** (branch `chris/final-p02-run`). That run touched engine physics (ventilation
scheduler + per-orientation glazing g, both byte-identical-guarded) and re-authored the measure
stack; Model 2 re-closes at **elec 572,398 / gas 207,700 / EUI 185.1** on its engine. The
`<PRE_FIX_SHA>` this brief records must now be the **final-p02-run close SHA**, not the earlier
stack. Do not start until final-p02-run is merged to `main`. Also note the P03 follow-up logged in
`docs/audit/final_p02_part0_scenario_note.md`: fold GF summer_bypass into the baseline and re-close
the residual — batch it with this TB fix, since both re-size the residual.
**Engine SHA note:** this changes engine physics → the export "Outputs" engine SHA will move. Expected.

---

## BEFORE DOING ANYTHING

0. **MERGE GATE — DO NOT START UNTIL THIS IS SATISFIED.** This brief is **approved but gated**.
   Do not cut the branch, write the probe, or touch any file until **all** of the following are
   true:
   - The full PR stack is merged to `main`: **#20** (Model-1 baseline), **#22** (Model-2 close),
     **Brief B**, and **Brief C**.
   - **P02's numbers are frozen** — the Model-2 close (elec 572.400 / gas 207.700 / EUI 185.1) and
     the P02 report/export are issued and locked on the **pre-fix** engine SHA. Record that SHA now
     (call it `<PRE_FIX_SHA>`); Part 8 references it.
   Branch off `main` **after** the merge, as defaulted. If any stack PR is still open, STOP and wait.
   Rationale: this fix moves the anchor and re-sizes the Model-2 residual (Parts 5–6); starting
   before the stack is frozen would re-open numbers that are mid-review.

1. Read `CLAUDE.md` in full. This brief lives or dies on **Rule 14** (parallel-path parity) and
   **Process rule 9** (integrand-vs-display reconciliation). Read both.
2. Read `docs/audit/bridgwater-model2-calibrated_close.md`, specifically:
   - Part 4 "D3 inert-input trace audit" — the `building.thermal_bridges` ⚠ E5 row.
   - "Thermal-bridging residual caveat (re-quantified)" — the ≈+1.6 MWh net-electricity estimate.
3. Read `docs/audit/39_calculation_flow_map.md` (Pattern C — the four parallel envelope
   implementations and why they exist).
4. Confirm the DB snapshot task is healthy before any scenario re-persist (Part 6):
   `Get-ScheduledTask -TaskName 'nza-sim-db-daily-snapshot' | Select-Object State` → `Ready`.
   Back up the live DB before Part 6 (`…\Backups\nza-sim-db\nza_sim_pre-tb-apply_2026-07-15.db`).
5. Confirm the anchor harness runs green **before** you touch anything, so you have a clean
   baseline to diff against:
   `node scripts/_brief93_anchor.mjs --fixture` (fixture-based; Brief 95 P1 discipline — never
   anchor off the live DB, which Chris edits freely).
6. Reproduce the bug first (falsifiability). Run the Part-1 sensitivity probe (write it first)
   and confirm the **pre-fix** result: full-mode `consumption.space_heating.demand_mwh` is
   byte-identical across `thermal_bridges` = `absent` / `iso14683_auto ×1` / `×2` / `×10` /
   `manual_h_tb 500`. If it already moves, STOP — the premise is wrong, re-diagnose.

---

## Module scope statement (Process rule 10)

This brief modifies **Building module** envelope physics. Thermal bridging (linear + point) is
explicitly in the Building module's **Computes** list ("Thermal bridging losses (linear and
point)"). The change folds an already-computed envelope conductance (`total_H_TB_W_per_K`, from
`computeThermalBridges`) into the demand integral of the code paths that currently omit it. No new
physics, no new inputs, no non-envelope concepts imported. The Model-2 residual re-size (Part 6) is
a **calibration** coordination, not a scope change — it re-sizes an existing named end-use entry so
the metered electricity total still closes after the fix moves demand.

---

## Context — the exact defect

`computeThermalBridges(building, geo, fabric_area_UA)` returns `total_H_TB_W_per_K` (170.23 W/K on
Bridgewater Model-2, `thermal_bridges = {mode:'iso14683_auto', multiplier:2}`). The engine keeps
**four parallel envelope implementations** (CLAUDE.md Rule 14 / Pattern C). Their treatment of
H_TB in the **demand integral** currently diverges — and the reported full-mode result is on the
broken side:

| # | Path | Function (`frontend/src/utils/instantCalc.js`) | Demand model | H_TB in demand? |
|---|---|---|---|---|
| 1 | State 1 (envelope-only, Building page) | `_calculateEnvelopeOnly` (~846) | weather-bucketed: `heating_Wh = hourly_heat_loss_Wh − Q_solar` | ✅ **YES** — `TB_heat_h` summed into `hourly_heat_loss_Wh` at **line 1606** |
| 2 | State 2 (envelope+gains) | `_calculateState2` (~2545) | implicit-Euler (Brief 67/69): `heating_Wh = −C_coef·(setpoint − T_air_free)` | ❌ **NO** — `C_coef`/`D_coef` (**3219–3231**) omit H_TB; TB only hits the display accumulator `acc_heat_loss_thermal_bridging` (**3386**) |
| 3 | State 3 (full — **the reported result**) | `_calculateState3` (~4941) | reads `state2Result.demand.heating_demand_mwh` (**5004**) | ❌ **NO** — inherits State 2's gap |
| 4 | Inline-legacy `full` | `_calculateInstantBaseline` fallthrough (**6717+**) | weather-bucketed: `net_loss = fabric_loss − solar − internal` | ❌ **NO** — never calls `computeThermalBridges`; `fabric_loss` (**6899**) omits TB |
| — | Degree-day fallback (no-weather) | `calculateInstantDegreeDay` (**5971**) | HDD: `total_fabric = Σ U·A·HDD·24/1000` | ❌ **NO** — `total_fabric` (**5988**) omits TB |

The production Bridgewater result routes **State 3 → State 2** (it has `systems_config_v25` +
`system_templates`), so the reported Systems/Results/export heating demand **excludes thermal
bridging entirely**, even though `building.thermal_bridges` is set and the State-1 Building page
reflects it. That is the E5 parallel-path gap.

**Root-cause class (cite this — it's a known pattern):** identical to **Brief 69 Part 1**
(2026-05-28), which fixed "`C_coef` included fabric + glazing + infiltration + permanent-vent UA
but NOT mech-vent" (see the comment at instantCalc.js **3194–3199**). Thermal bridging is the same
omission: a linear conductance to outside air (W/K) that belongs in the zone-air node balance
alongside `UA_leakage`, `UA_permanent`, `UA_mech_vent_h` — but was never added. The fix shape is
the same: one term in `C_coef`, one term in `D_coef`.

**Why this is NOT a hack-inline job (the thing the origin task forbids):** the correct State-2 fix
is a *physically-typed conductance injection into the implicit-Euler node balance*, exactly
mirroring leakage/permanent/mech-vent — NOT bolting `+ TB_heat_h` onto a loss sum (State 2 has no
loss-sum-feeds-demand path; that path was retired by Brief 67). Getting the two paths' physics
right per Rule 14 is the whole point.

**Rule-9 angle:** today State 2's *display* breakdown shows a thermal-bridging loss row while the
*demand integral* omits it — a display term absent from the integrand. This fix restores the
integrand-vs-display invariant for TB.

---

## Physics of the fix (State 2 / State 3)

Thermal bridging is a linear heat-transfer coefficient `H_TB` (W/K) from zone air to outside air,
driven by `(T_air − T_out)`. In the implicit-Euler air-node solve it enters **exactly** as the
other outside-air conductances do (instantCalc.js 3219–3231):

```
C_coef −= total_H_TB_W_per_K                       // conductance to outside (negative term)
D_coef += total_H_TB_W_per_K * T_out               // driven by outside air temperature
```

Consequences (all physically correct):
- Winter free-float `T_air_free` drops (more envelope loss) → more hours cross the heating
  threshold → heating demand rises. Summer: TB also sheds heat → slightly lowers cooling demand
  (the same gains-dominated cancellation the audit documents for U-values).
- During **conditioned** hours `T_air = setpoint`, so TB in demand is `H_TB·(setpoint − T_out)` —
  matching State 1's setpoint-referenced form. During **dead-band/float** hours `T_air ≠ setpoint`,
  so State 2's TB contribution is `T_air`-referenced, not setpoint-referenced.

**Documented Rule-14 divergence (REQUIRED in the commit message):** State 1 (weather-bucketed) and
State 2 (implicit-Euler gains-warmed `T_air` trace) apply H_TB against *different* reference
temperatures in unconditioned hours. This is the same legitimate integrand-shape divergence
Rule 14 already sanctions for every other envelope term in State 2 (leakage, permanent vents,
mech-vent are all `T_air`-referenced in `C_coef` for demand but setpoint-referenced in the display
accumulators). State 1 and State 2 heating demand are **not** expected to be byte-identical for TB —
they already differ for every term. The commit message must state this explicitly (silent
divergence is the failure mode).

**Do NOT touch the display accumulator.** `acc_heat_loss_thermal_bridging` (3386) stays
setpoint-referenced (`total_H_TB_W_per_K * dT_heat_out`), consistent with the sibling display
accumulators (`leakage_h`, `permanent_h`). The demand-side fix is C_coef/D_coef ONLY. Adding TB in
both places would double-count.

---

## Parts

### Part 1 — Falsifiability + acceptance probe (write the test FIRST)

**Files:** new `scripts/_tb_apply_sensitivity.mjs` (model it on
`scripts/_check_28tb_v1_assertions.mjs` and `scripts/_brief93_anchor.mjs --fixture`).

The **acceptance check for the whole brief** is a **mode-vs-mode sensitivity test**. Drive the
committed frozen fixture (`docs/audit/fixtures/model2_base.json`, which carries
`systems_config_v25` → routes State 3) through `calculateInstant` for each `thermal_bridges` block,
in each engine mode, and read heating demand:

- `thermal_bridges` variants: `{mode:'absent'}`, `{mode:'iso14683_auto',multiplier:1}`,
  `{...,multiplier:2}`, `{...,multiplier:10}`, `{mode:'manual_h_tb',h_tb_W_per_K:500}`.
- Modes to sweep:
  - `mode:'full'` + `engine:'v2.5'` → **State 3** — read `consumption.space_heating.demand_mwh`
    AND `demand.heating_demand_mwh`. **This is the reported path — the headline assertion.**
  - `mode:'envelope-gains'` → **State 2** — read `demand.heating_demand_mwh`.
  - `mode:'envelope-only'` → **State 1** — read `demand.heating_demand_mwh` (regression guard:
    must stay sensitive, was already correct).
  - Inline-legacy: a fixture WITHOUT `systems_config_v25`/templates, `mode:'full'` — read
    `demand.heating_demand_mwh` (or the legacy heating field the path exposes).

**Assertions (post-fix):** within each mode, heating demand is **strictly monotonically
increasing** in `total_H_TB_W_per_K` across `absent → ×1 → ×2 → ×10`, and `manual_h_tb 500`
(H_TB=500) exceeds `×2` (H_TB≈170). Report the actual H_TB and demand for every cell.

**Pre-fix expectation (Part 1 deliverable — run and record BEFORE any engine edit):** modes 2, 3,
4 are **flat** (all variants identical) — the reproduced bug. Mode 1 (State 1) already moves. Commit
this recorded pre-fix output into the brief's audit trail so the fix is falsifiable.

Exit 0 PASS / 2 FAIL / 1 error, per the `_check_28tb_v1_assertions.mjs` convention.

**Commit:** `Part 1: TB-apply mode-vs-mode sensitivity probe (records pre-fix flat demand)`
**Verify:** run it; confirm modes 2/3/4 flat pre-fix (bug reproduced), mode 1 already moves.

---

### Part 2 — State 2 fix (the reported-result fix)

**File:** `frontend/src/utils/instantCalc.js`, `_calculateState2`, `C_coef`/`D_coef` at **3219–3231**.
`total_H_TB_W_per_K` is already in scope (computed at 2876).

Inject H_TB into the node balance, immediately adjacent to the `UA_mech_vent_h` terms, with a
comment citing this brief and Brief 69 Part 1:

```js
const C_coef =
  UA_wall_eff  * (stepWall.b_inside_node  - 1) +
  UA_roof_eff  * (stepRoof.b_inside_node  - 1) +
  UA_floor_eff * (stepFloor.b_inside_node - 1) -
  UA_glaz - UA_leakage - UA_permanent - UA_mech_vent_h -
  total_H_TB_W_per_K -               // Thermal bridging (this brief): H_TB conductance to outside.
  C_air_per_dt                       //   Same class as Brief 69 P1 mech-vent injection.
const D_coef =
  UA_wall_eff  * stepWall.a_inside_node +
  UA_roof_eff  * stepRoof.a_inside_node +
  UA_floor_eff * stepFloor.a_inside_node +
  (UA_glaz + UA_leakage + UA_permanent + UA_mech_vent_h + total_H_TB_W_per_K) * T_out +
  C_air_per_dt * T_air +
  Q_to_zone_air
```

Leave the display accumulator (3386) untouched. State 3 needs **no** change — it reads State 2's
`demand.heating_demand_mwh` (5004), so it is fixed transitively.

**Commit:** `Part 2: fold H_TB into State-2 C_coef/D_coef so full-mode demand reflects thermal bridging`
(commit message MUST state the State-1-vs-State-2 reference-temperature divergence per Rule 14 —
see "Physics of the fix").
**Verify:** re-run Part 1. Modes 2 AND 3 now strictly monotonic in H_TB. Record the State-3
`consumption.space_heating.demand_mwh` deltas.

---

### Part 3 — Inline-legacy `full` fix (Rule 14 — same commit family)

**File:** `frontend/src/utils/instantCalc.js`, `_calculateInstantBaseline` fallthrough (6717+).

1. After the UA products are resolved (~6783), compute H_TB once (this path does not yet call the
   helper). Build `fabric_area_UA` from the UA products already present
   (`UA_wall + UA_roof + UA_floor + UA_glaz`) and call
   `computeThermalBridges(building, geo, fabric_area_UA)`; capture `total_H_TB_W_per_K`.
2. In the hour loop, add `const hour_tb = total_H_TB_W_per_K * dT_heat / 1000` and include it in
   `fabric_loss` (**6899**). This path is weather-bucketed → mirror State 1's `+ TB_heat_h` form
   (setpoint-referenced), NOT the C_coef injection. Add a heating-hours accumulator for the
   breakdown so the display gains a TB row too (Rule 9 — parity with the other `acc_*_loss`).

**Commit:** `Part 3: apply H_TB in inline-legacy full path (Rule 14 parity with State 1/2)`
**Verify:** Part 1's inline-legacy sweep now monotonic.

---

### Part 4 — Degree-day fallback fix (no-weather path)

**File:** `frontend/src/utils/instantCalc.js`, `calculateInstantDegreeDay` (5971).

Add `tb_kWh = total_H_TB_W_per_K * UK_HDD * 24 / 1000` to `total_fabric` (**5988**), computing
`total_H_TB_W_per_K` via `computeThermalBridges(building, geo, fabric_area_UA)` with
`fabric_area_UA = walls/roof/floor/glazing UA`. This is the coarse no-weather fallback (used only
when `weatherData`/`hourlySolar` are absent) and never feeds the reported Bridgewater result — but
per Rule 14 we do not leave a fifth parallel path silently divergent. Add the TB line to the
degree-day gains/losses display output for parity.

**Commit:** `Part 4: apply H_TB in degree-day fallback (Rule 14 completeness)`
**Verify:** unit smoke — a fixture run with weather stripped moves with H_TB.

> **All four paths land in THIS brief — no deferrals.** A parallel-path bug half-fixed is how the
> Pattern-C class breeds (Rule 14's own history: Brief 33/34 → State 2/inline-legacy eight briefs
> later). Parts 2, 3, 4 (State 2/3, inline-legacy, degree-day) are non-optional; the brief does not
> close until all five paths consume `total_H_TB_W_per_K`. There is no "legacy paths, fast-follow"
> exit — that exit is exactly what this brief exists to eliminate.

---

### Part 5 — Re-baseline the committed anchor (same commit as Part 2)

The fix intentionally raises State-3 heating demand (≈ +12.8 MWh at H_TB 170 on Bridgewater, per
the audit; net EUI effect after cooling cancellation + ÷SCOP is small). The committed anchor
fixture (`validation/fixtures/bridgewater_anchor_v2.yaml`, checked by
`scripts/_brief93_anchor.mjs --fixture`) will move. This is an **intended physics change, not a
regression** — but the anchor's expected value MUST be re-baselined in the same commit, with the
delta and its cause recorded (Brief 95 P1: fixtures are the regression reference; a number that
moves for a real reason gets re-frozen deliberately, never silently).

**Files:** `validation/fixtures/bridgewater_anchor_v2.yaml` (or wherever the expected anchor value
lives), + the anchor script's tolerance/expected constant if hard-coded.
**Commit:** fold into Part 2's commit (anchor and fix move together).
**Verify:** `node scripts/_brief93_anchor.mjs --fixture` green against the new baseline; record
old→new EUI/demand in the commit message and the audit doc (Part 7).

---

### Part 6 — Coordinate the Model-2 auxiliary residual (re-size after the fix)

Per the audit's re-quantified caveat, injecting H_TB 170 W/K adds ≈ **+1.6 MWh net electricity**
(`12.8/2.8 − 8.8/3.0`, ~1.1% of the 147.75 MWh residual). With the fix live, the previously-omitted
fabric loss is now attributed, so the **`auxiliary_residual_unattributed`** entry (147.75 MWh,
4.001 W/m²) must shrink so the modelled electricity total still closes to the metered 572,400 kWh
(and gas to 207,700).

1. **Recompute the exact delta post-fix** (do NOT hard-code 1.6 — that was an estimate). Run the
   Model-2 scenario through the fixed State-3 engine, read the new heating (and cooling) electricity,
   and compute `new_residual = 572,400 − (new_attributed_elec_kWh)`.
2. Re-persist the Model-2 scenario's residual entry to `new_residual`. **Stop the dev server before
   any DB write** (Process rule 11); back up the DB first (BEFORE-checklist step 4).
3. Full close re-verification + re-export + provenance is **Part 8** (below) — Part 6 ends once the
   residual is recomputed and persisted.
4. Model-1 scenario is **byte-frozen** (read-only) — it does not carry the residual and its
   as-specified EUI 119.2 must be unchanged (asserted in Part 8).

> Sequencing: PR #22 (Model-2 close) is open/unmerged. Confirm with Chris whether this fix lands
> before or after PR #22 merges; the residual re-size assumes the Model-2 scenario exists. If PR #22
> is unmerged, this brief either rebases onto it or waits.

**Commit:** `Part 6: re-size Model-2 auxiliary residual after TB fix (close holds: elec 572,400, EUI 185.1)`
**Verify:** re-run the Model-2 close checks (audit §Verification items 2–4).

---

### Part 7 — Documentation (numbered deliverable, not advisory — Process rule 7/9)

1. **`frontend/src/utils/assumptionsExport.js`** — remove the `TB_NOT_APPLIED` marker (line ~73)
   and its use on the thermal-bridging row (line ~142). TB is now consumed in full-mode; the row
   should read as a live, applied assumption (like the U-value rows). Delete the `E5` explanatory
   comment block (69–71) or update it to "resolved by <this brief>".
2. **`docs/audit/bridgwater-model2-calibrated_close.md`** — update the D3 table row for
   `building.thermal_bridges` from "⚠ E5 … computed but not applied" to "✅ consumed (full-mode
   demand, this brief)"; update the "Thermal-bridging residual caveat" and "Lessons" sections to
   record the actual post-fix residual delta and the new anchor baseline.
3. **`STATUS.md`** — Last completed / Current state / Known issues (E5 closed) / Safety checks.
4. **`docs/briefs/current.md`** — point to this brief; note the anchor re-baseline and residual
   re-size.
5. On close: rename this file to `docs/briefs/archive/thermal-bridging-fullmode-apply_COMPLETED.md`.

**Commit:** `Part 7: docs — close E5 (TB applied in full-mode), remove TB_NOT_APPLIED marker, STATUS/audit`

---

### Part 8 — Re-verify the Model-2 close, re-export both scenarios, record P02 provenance

The fix moves engine numbers, so the close and the exports must be regenerated on the **post-fix**
SHA — and P02's provenance must be recorded so the frozen P02 report is not silently invalidated.

1. **Re-run the full Model-2 close verification** (audit §Verification, items 1–4) on the post-fix
   engine + re-sized residual (Part 6). All must hold **exactly**:
   - Electricity **572.400 MWh** (Δ within ±0.0% of metered 572,400 kWh).
   - Gas **207.700 MWh** (0.0% vs 207.7).
   - **EUI 185.1** (metered) via the re-sized residual — the residual is what absorbs the change;
     the metered close is invariant by construction.
   - Model-1 **EUI 119.2 unchanged** (byte-frozen scenario; no residual).
   If any fails to close exactly, the residual in Part 6 was mis-sized — recompute, do not fudge.
2. **Re-export both scenarios** (Model-1 and Model-2) — 2 sheets each, **new post-fix engine SHA**
   stamped, inert-input markers updated (the TB row no longer carries `TB_NOT_APPLIED`; TB is now a
   live applied assumption). Confirm Model-1's export EUI is still 119.2 and Model-2's is 185.1.
3. **Record P02 provenance in the audit note** (`docs/audit/bridgwater-model2-calibrated_close.md`,
   and a one-line note wherever P02's issue is logged):
   > P02 (Model-2 report/close) was issued on **pre-fix engine SHA `<PRE_FIX_SHA>`** (BEFORE-DOING-
   > ANYTHING step 0), carrying the E5 thermal-bridging footnote (H_TB computed but not applied in
   > full-mode demand). This brief applies H_TB and re-sizes the auxiliary residual so the metered
   > close is preserved. **P02 is NOT reopened** — the issued export's SHA stamp carries its
   > provenance, and the TB footnote is **retired at the next report revision**, not by reissuing
   > P02. Post-fix exports carry the new SHA and no TB footnote.
   This keeps the frozen deliverable auditable: the SHA on each export tells you which engine
   produced it, and the footnote lifecycle (present at P02 → retired at next revision) is explicit.

**Commit:** `Part 8: re-verify Model-2 close on post-fix SHA, re-export both scenarios, record P02 provenance`
**Verify:** close holds exactly (elec 572.400 / gas 207.700 / EUI 185.1); both exports carry the new
SHA + updated markers; audit records `<PRE_FIX_SHA>` provenance + footnote-retirement policy.

---

## Deliverables (summary)

- [ ] Part 1 — `scripts/_tb_apply_sensitivity.mjs` (acceptance test) + recorded pre-fix flat result.
- [ ] Part 2 — State-2 `C_coef`/`D_coef` H_TB injection (fixes State 3 transitively) + Rule-14
      divergence in commit message + Part 5 anchor re-baseline in the same commit.
- [ ] Part 3 — inline-legacy `full` H_TB in `fabric_loss` + display row.
- [ ] Part 4 — degree-day fallback H_TB in `total_fabric` + display row.
- [ ] Part 6 — Model-2 residual recomputed (exact post-fix delta) + persisted.
- [ ] Part 7 — export marker removed; audit D3 row flipped to consumed; STATUS.md + current.md.
- [ ] Part 8 — Model-2 close re-verified exactly on post-fix SHA; both scenarios re-exported (new
      SHA, markers updated); P02 provenance + footnote-retirement policy recorded in the audit.

## Acceptance check (the one that gates the brief)

`node scripts/_tb_apply_sensitivity.mjs` → PASS: full-mode (State 3) `space_heating.demand_mwh`
strictly increases across `absent < iso14683_auto×1 < ×2 < ×10`, and `manual_h_tb 500 > ×2`; State 2
likewise; State 1 unchanged-and-still-sensitive; inline-legacy sensitive. Anchor green on the new
baseline. Model-2 close holds.

## Rule-14 parity checklist (must all be true at commit time)

| Location | Action | Ref |
|---|---|---|
| State 1 `_calculateEnvelopeOnly` | already applies TB in demand — **verify unchanged & still sensitive** | line 1606 |
| State 2 `_calculateState2` | **inject** H_TB into `C_coef`/`D_coef` | lines 3219–3231 |
| State 3 `_calculateState3` | no direct change — **verify** it now moves (reads State 2) | line 5004 |
| Inline-legacy `full` | **add** H_TB to `fabric_loss` | line 6899 |
| Degree-day fallback | **add** H_TB to `total_fabric` | line 5988 |

Structural mirror ✔ AND correlation-correctness ✔ (Rule 14 close): the shared correlation is
`computeThermalBridges` → `total_H_TB_W_per_K`, applied as a to-outside conductance in every path.
Confirm all five paths consume the same helper output.
