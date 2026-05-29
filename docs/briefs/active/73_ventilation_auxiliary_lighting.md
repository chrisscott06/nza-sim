# Brief 73 — Ventilation share rule + auxiliary visualisation + lighting baseline check

**Author:** Claude Chat (architect)
**Authorised by:** Chris (29 May 2026, morning, post-Brief-72 walkthrough)
**Provisional number:** 73 (door-bug placeholder, never written, renumber to 75 when this lands)
**Design note (canonical):** https://www.notion.so/36fd645e05cc81e2a977f0319365402f — "Brief 73 design note: Ventilation share rule + auxiliary visualisation + lighting baseline check". Where this brief and the note disagree, the note wins.
**Lineage:** First brief after Brief 72 close. Builds on Brief 72's auxiliary loads infrastructure (P5 engine rollups, P6 colour token in both palettes) — does not modify them, only consumes them. The ventilation fix is independent and bounded.

---

## BEFORE DOING ANYTHING

1. **Confirm receipt.** Quote this brief's title and first paragraph back to Chris. State the commit SHA at the tip of `main` you're starting from (expected: Brief 72 close commit `3e21f3b` or later).
2. **STATUS.md is fresh** (reconciled at Brief 72 P11). Land this brief on disk at `docs/briefs/active/73_ventilation_auxiliary_lighting.md` as Part 1's first commit. Open audit stub `docs/audit/73_ventilation_auxiliary_lighting.md`.
3. **Capture the current anchor.** Run Bridgewater clean, record EUI / Σ electricity / Σ gas / Heating / Cooling / DHW / Ventilation fan electricity / Lighting / Small Power. This is the "before" against which every part's gates are measured. Expected starting point: EUI ~163.5 kWh/m²·yr, Σ electricity 314.2 MWh, Σ gas 360.3 MWh, Ventilation fan **0 MWh** (the bug), Lighting 56.3 MWh, Small Power 172.1 MWh, DHW 421.1 MWh. If your numbers diverge materially, log it and proceed — same model state at the start of every brief.
4. **Diagnose before fixing; audit before fixing.** Each of the three sub-problems needs source-reading before code changes. See Part 2, Part 3, Part 4 below.
5. **Ports.** Frontend `5176`/`5178`, backend `8002`, started via `go.bat`. Same as always.
6. **Browser verification is Code's job per the Bible addendum.** Use MCP browser tools for any in-browser observation. Chris doesn't paste console output. Hard-stop walkthroughs are the one exception and are explicit below.

---

## Scope

Three findings from the post-Brief-72 walkthrough, bundled into one brief per Chris's request:

1. **Ventilation share rule** — engine is wrongly applying heating/cooling's share-sum-to-100% rule to ventilation; three parallel ventilation systems each showing 100% trips the guard; fan electricity = 0 MWh. Active wrong number, fix first.
2. **Auxiliary visualisation** — Heat Balance Sankey and Energy Flows Sankey don't render the auxiliary ribbon despite Brief 72 P5 producing the rollups correctly. Data is right; visualisation gap.
3. **Lighting baseline check** — Lighting 56.3 vs 128.6 pre-loss, Small Power 172.1 vs 116.7 pre-loss. Read-only investigation; fix only if it's a re-creation error rather than an acceptable rebaseline.

**Out of scope:** door bug (renumber to Brief 75); interventions diagnostic harness + tab redesign (Brief 74, still queued); WWHR (Brief 76); lighting room-vs-communal split (its own future brief); any Sankey redesign beyond adding the missing ribbon; any change to Brief 72's auxiliary engine layer.

---

## Principles

1. **Diagnose before fix.** Each of the three findings gets a source-read part before any code change. Static reading from GitHub raw, per the Bible.
2. **Boundary discipline.** The ventilation share fix must not bleed into heating/cooling/DHW share logic. Different services, different rules. Name the rules per service.
3. **Anchor: capture, don't hardcode.** Bridgewater's EUI will MOVE in Part 5 (ventilation fan electricity restored, +42 MWh). That's expected. The new post-fix Bridgewater is the canonical anchor going forward. Don't tweak the engine to preserve an artefact-of-the-bug number.
4. **Same gain = same colour everywhere.** Auxiliary's `#4B5563` is already registered in both `gainColours.js` and `balanceColours.js INTERNAL_COLOURS` per Brief 72 P6. Both Sankeys MUST read from the existing tokens; no new colour registrations.
5. **`gain_fraction = 1.0` default holds.** If Part 4 finds Lighting/Small Power totals shifted because gain_fraction is somehow not defaulting to 1.0, that's a Brief 72 P5 regression and gets escalated, not patched here.
6. **No quiet scope expansion.** Anything surfaced that isn't one of the three named findings is a Tier-3 note for a future brief.

---

## Parts (each = one commit unless noted)

**Part 1 — Precondition + anchor capture.**
Land brief on disk. Open audit stub. Run Bridgewater clean. Record full anchor in audit §1 (EUI, fuel splits, all per-service demand and delivered numbers, all per-system rollups). The anchor table is the regression target for Parts 2–5 and the rebaseline reference for Part 6.
Commit: `Brief 73 P1: STATUS reconcile + Bridgewater anchor capture + brief landing`.

---

### Findings 1 — Ventilation share rule

**Part 2 — Ventilation share rule diagnostic (read-only).**
Read source to identify:
- Where does the "Σ 300% — engine will not compute" warning live? Likely `ServiceSectionHeader.jsx` or the systems-page validator hook.
- Where does the engine guard refuse to compute ventilation fan electricity when shares ≠ 100%? Likely `systemsEngine.js` `_computeVentilation` or a shared `_validateShares` helper.
- What rule applies to each service: heating (sum to 100% across systems splitting demand), cooling (same), DHW (HP + boiler trim, sum to 100%), ventilation (parallel — no share rule).
- Is the share field on ventilation system rows visible in the UI? If yes, where (which component)?

Report findings in `docs/audit/73_*.md` §2-diagnostic with file + line references. **Do not change code.**
Commit: `Brief 73 P2: ventilation share rule diagnostic (read-only)`.

**Part 3 — Ventilation share rule fix.**
- Remove the share field from the ventilation system row schema (`ProjectContext.jsx DEFAULT_SYSTEMS.ventilation` if it has a `share` field; or remove the share entry from ventilation system entries wherever it lives).
- Remove the share slider/input from the ventilation system UI (`ServiceSectionHeader.jsx` `VentilationServiceFields` or wherever vent rows render).
- Remove the share-validation warning for ventilation specifically — the Σ NN% chip must not appear for ventilation. Keep it for heating, cooling, DHW.
- Engine guard: in `_computeVentilation` (or wherever the refuse-to-compute lives), remove the share check for ventilation. Each system runs at its own configured flow rate, full stop.
- Migration: existing projects with `share` saved on ventilation entries — drop the field; no warning needed (it was meaningless).

**Gates:**
- (a) Bridgewater's three ventilation systems no longer show a share slider or Σ warning.
- (b) Ventilation fan electricity is **non-zero**. Expected ~42 MWh total based on pre-loss numbers (22.6 + 16.0 + 3.4). Exact magnitude depends on current SFP and flow rate values in re-created Bridgewater — sign and order of magnitude are the gate, not exact match.
- (c) Heating share validation still works: drag heating system 1 to 80%, system 2 stays at 10%, Σ = 90%, warning fires, engine refuses (existing behaviour preserved).
- (d) DHW share validation still works similarly.
- (e) Anchor preserved for everything except ventilation: Heat / Cool / DHW / Lighting / Small Power demand and delivered unchanged; only Σ electricity rises by the new fan electricity.

Commit: `Brief 73 P3: remove share concept from ventilation (heating/cooling/DHW unaffected)`.

---

### Findings 2 — Auxiliary visualisation

**Part 4 — Auxiliary visualisation diagnostic (read-only).**
Read source for:
- The Heat Balance Sankey component (likely `HeatBalanceSankey.jsx` or under `internal-gains/heat-balance/`). Which `internal_gains.*_gain_kwh` fields does it currently consume? Where would the auxiliary ribbon insert?
- The Energy Flows Sankey component (likely `EnergyFlowsSankey.jsx` or under `systems/`). Which `internal_gains.*_kwh` fields does it consume on the Demand side? Where would an auxiliary row insert?
- The right-strip per-service breakdown in `SystemsModule.jsx` (image 1, right side: Heating / Cooling / DHW / Ventilation per-system list). Does this list have a section that should include Auxiliary?
- Confirm `internal_gains.auxiliary_kwh` and `internal_gains.auxiliary_gain_kwh` are populated for Bridgewater (Chris has authored Catering + Pumps + External lighting). If the rollups are zero, that's a Brief 72 P5 regression — STOP and report.

Report findings in `docs/audit/73_*.md` §4-diagnostic with file + line refs. **Do not change code.**
Commit: `Brief 73 P4: auxiliary visualisation diagnostic (read-only)`.

**Part 5 — Auxiliary ribbon in Heat Balance Sankey + Energy Flows Sankey.**
- Heat Balance Sankey: add Auxiliary as an IN-Gains ribbon, positioned between Equipment and Lighting (matching the section order in the Internal Gains module). Magnitude = sum of `internal_gains.auxiliary_gain_kwh` across all auxiliary profiles. Colour token `#4B5563` from `balanceColours.js INTERNAL_COLOURS.auxiliary`. The Σ gains figure must rise by the auxiliary heat contribution.
- Energy Flows Sankey: add Auxiliary as a Demand-column row. Magnitude = sum of `internal_gains.auxiliary_kwh` across profiles. Flows through Electricity (all current presets are electricity-only; schema technically allows other carriers but no need to ship that until a non-electric preset exists). Colour `#4B5563` from `gainColours.js`. The Σ elec figure must rise by the auxiliary electricity.
- Right-strip per-service breakdown: add an "Auxiliary" entry showing total electricity (from `auxiliary_kwh`) and total heat gain (from `auxiliary_gain_kwh`).

**Gates:**
- (a) With Chris's existing Bridgewater auxiliary profiles (Catering, Pumps, External lighting): Heat Balance Sankey shows an Auxiliary ribbon in `#4B5563`. Σ gains figure has risen vs Part 1 anchor. The Catering + Pumps heat gain contribution is visible and signed correctly.
- (b) Energy Flows Sankey shows Auxiliary row in `#4B5563` on Demand column. Σ elec has risen vs Part 1 anchor.
- (c) Right-strip per-service breakdown shows Auxiliary entry with non-zero electricity + non-zero heat gain.
- (d) Setting all auxiliary profiles to load 0 returns the model to exact P1 anchor numbers (auxiliary rollups → 0 → ribbons disappear or render at zero width).

Commit: `Brief 73 P5: auxiliary ribbon in Heat Balance + Energy Flows + per-service breakdown`.

---

### Findings 3 — Lighting baseline check

**Part 6 — Lighting + Small Power baseline reconciliation (read-only investigation).**

Pre-loss canonical Bridgewater: Lighting delivered 128.6 MWh, Small Power delivered 116.7 MWh. Post-re-creation: 56.3 MWh / 172.1 MWh.

Investigate without changing engine code:
- Read current `building.gains.lighting` and `building.gains.equipment` profile values in Bridgewater (LPD, EPD, schedules, area_share, gain_fraction).
- Compare against the pre-loss Systems screenshot annotations and the Brief 72 P1 anchor capture (which recorded Lighting 128.6, Small Power 116.7).
- Determine which of:
  - **(a) Re-creation acceptable rebaseline.** Overnight Code worked from anchor numbers, not screenshot-exact LPD. The new totals are internally consistent with whatever LPD/EPD got seeded. Document and accept.
  - **(b) Re-creation setup error.** A specific input value (LPD, EPD, area_share, schedule scaling) is wrong and produces the divergence. Fix Bridgewater inputs to match pre-loss within ~5%. Engine code untouched.
  - **(c) Brief 72 P5 gain_fraction regression.** If gain_fraction is not 1.0 by default on lighting or equipment, or if its application is double-counting somewhere, that's a real engine bug and must escalate as a separate small brief.

If (a): document and move on. Audit doc records the new baseline as canonical.
If (b): correct the relevant Bridgewater profile values via the UI (Code-driven MCP browser flow). Document the change. Re-capture anchor.
If (c): STOP. Open `docs/audit/73_lighting_p5_regression.md`, document the regression with reproduction, escalate to Chris for a Brief 72 follow-on brief. Do not patch in this brief.

Gates:
- (a) outcome: lighting and small power values explained from first principles, accepted as canonical, audit §6 documents the new anchor.
- (b) outcome: lighting and small power now within ~5% of pre-loss (128.6 / 116.7), Bridgewater inputs updated, anchor re-captured.
- (c) outcome: regression documented, separate brief drafted, no code change in this brief.

Commit: `Brief 73 P6: lighting + small power baseline reconciliation`.

---

### Close

**Part 7 — Walkthrough + close. [HARD STOP for Chris's walkthrough]**

Code performs full self-verification using MCP browser tools and logs results in audit §7. Then Chris does the human walkthrough at `:5178` on Bridgewater:

1. Systems → Ventilation panel: no share slider, no Σ warning. ✓/✗
2. Systems → right strip: Ventilation per-system totals non-zero (mvhr_gf_public ~22 MWh, bedroom_extract ~16 MWh, public_toilet_extract ~3 MWh, or whatever the current SFP × flow produces). ✓/✗
3. Systems → Heating panel: share validation still works (drag system 1 to 80%, warning fires, engine refuses). ✓/✗
4. Systems → DHW panel: share validation still works. ✓/✗
5. Internal Gains → Heat Balance Sankey: Auxiliary ribbon visible in `#4B5563` on IN-Gains side, between Equipment and Lighting. ✓/✗
6. Internal Gains → Heat Balance Sankey: Σ gains figure has risen vs pre-Brief-73 (~372 MWh → higher, by the auxiliary heat contribution). ✓/✗
7. Systems → Energy Flows Sankey: Auxiliary row visible in `#4B5563` on Demand column. ✓/✗
8. Systems → Energy Flows Sankey: Σ elec figure has risen vs pre-Brief-73 (~314 MWh → higher, by the auxiliary electricity + the restored ventilation fan electricity). ✓/✗
9. Systems → right strip: Auxiliary entry present with non-zero electricity + heat gain. ✓/✗
10. Internal Gains → Auxiliary profiles: set Catering load to 0 W/m², confirm Heat Balance Σ gains drops by the corresponding amount; restore. ✓/✗
11. Lighting + Small Power totals match the Part 6 outcome (a, b, or c). ✓/✗

If any item fails, treat as Tier-2 within the brief: short diagnostic in audit, bounded fix, re-verify. Don't expand scope.

Commit: `Brief 73 P7: close + walkthrough + archive`.
Archive: `git mv docs/briefs/active/73_*.md docs/briefs/archive/73_*_COMPLETED.md`. Update `STATUS.md`. Repoint `current.md` to a placeholder for Chris's next brief decision.

---

## What MUST NOT happen

- Heating, Cooling, or DHW share validation being weakened or removed. They genuinely need the 100%-sum rule. Only ventilation loses it.
- A new colour token registered for Auxiliary. `#4B5563` is already in both palettes per Brief 72 P6; both Sankeys must read from there.
- Brief 72's auxiliary engine layer (`_aggregateAuxiliary`, `auxiliary_kwh`, `auxiliary_gain_kwh`) being modified. This brief only consumes the rollups; it does not produce them.
- The lighting/small power baseline being "fixed" by adjusting engine code. If (c) applies, escalate. If (b), fix the input data only.
- The DHW volume default being changed off 80 L/p/day.
- Anchor "preserved" by adjusting engine to hit a target. The post-Part-3 Bridgewater EUI will be ~10 kWh/m²·yr higher than pre-Part-3 because ventilation fan electricity is restored. That is the canonical new anchor.
- Any of the four out-of-scope items (door bug, harness, WWHR, lighting split) sneaking in.
- Quiet scope expansion — Tier-3 notes go in audit §future for the next brief.

---

## Escalation triggers

- **Part 4 finds `auxiliary_kwh` or `auxiliary_gain_kwh` is zero or missing for Bridgewater** → STOP, that's a Brief 72 P5 regression. Open a Brief 72 follow-on, don't patch here.
- **Part 6 outcome (c)** → STOP, separate brief for the gain_fraction regression.
- **Ventilation fix turns out to touch heating/cooling/DHW share logic deeply** → that's evidence the share validation is over-shared in code; document and escalate, don't try to untangle in this brief.
- **Three approaches tried on any single failure** → escalate, don't iterate.
- **Anchor drift between parts that you can't reconcile** → STOP, short Tier-2 diagnostic to Chris, don't commit.

---

## Final report (at close)

Commit SHAs per part. Anchor table showing before (P1) and after (P3, P5, P6 if applicable). Walkthrough ✓/✗ table. Part 6 outcome (a, b, or c). Any Tier-3 items surfaced.
