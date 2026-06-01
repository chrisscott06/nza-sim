<!-- ARCHIVED 2026-06-01 — SUPERSEDED BEFORE LANDING.
Code (this agent) ran a read-only premise check at Chris
's request and disagreed with this draft. See docs/audit/76_premise_check.md.
The architect placed the bug at the State 3 dispatch gate (line 6668). The actual bug is at `_calculateState2:2921` — the ventSystems builder
's base iteration is still v25. Bridgewater already reaches State 3 (SystemsModule.jsx:187 passes `engine: 'v2.5'`). Extending the dispatch gate would be a no-op.

The re-scoped Brief 76 that actually shipped lives at `docs/briefs/archive/76_v40_ventsystems_base_iterator_COMPLETED.md` (post-close) — its working copy was `docs/briefs/active/76_v40_ventsystems_base_iterator.md`. -->





# Brief 76 — Route v40 projects to State 3 (close inline-legacy dispatch gap)

**Author:** Claude Chat (architect)
**Authorised by:** Chris (2 June 2026, after architect read engine source directly)
**Provisional number:** 76. Numbering rolls: previously-Brief-75 (vent heat modelling) is superseded by this; door bug becomes Brief 77; interventions diagnostic harness becomes Brief 78; WWHR becomes Brief 79.
**Design note (canonical):** https://www.notion.so/372d645e05cc8107812dd75f330517ed — "Brief 76 design note: Route v40 projects to State 3 (close inline-legacy dispatch gap)". Where this brief and the note disagree, the note wins.
**Lineage:** Supersedes the unexecuted P3-P5 of Brief 75. Brief 75 P1 (anchor capture) and P2 (read-only diagnostic) stay valid and are referenced as input. Brief 75 stays open with status "P2-only — superseded by Brief 76" and is archived when this brief closes.

---

## BEFORE DOING ANYTHING

1. **Confirm receipt.** Quote this brief's title and first paragraph. State tip of `main` SHA.
2. **STATUS.md** — confirm reconciled at Brief 74 close. Note Brief 75 status as "P2-only, superseded by Brief 76."
3. **Land this brief** on disk at `docs/briefs/active/76_v40_state3_dispatch.md` as P1's first commit. Open audit stub at `docs/audit/76_v40_state3_dispatch.md`.
4. **Capture current Bridgewater anchor.** Full table: EUI, electricity total, gas total, per-service demand (heating, cooling, DHW), Heat Balance Σ gains + Σ losses + Net residual, every per-system ventilation rollup, mech vent ribbon value. This is the "before" — every Part 3 gate compares to it.
5. **Read the engine source yourself, line numbers as cited below.** Brief 75 went wrong because the architect previously advised from Code's summaries without reading the engine. Don't repeat that.

---

## Scope

One mechanical change: extend the State 3 dispatch gate at `instantCalc.js:6668` to recognise v40-shape projects, routing them to State 3 (which wraps State 2's hourly loop). Bridgewater and other v40 projects move from the annual-scalar inline-legacy path to honest hour-by-hour physics.

**The actual code change is roughly one line.** The brief's work is in the testing, anchor recapture, and verification that no regressions land for v25-shape projects.

**Out of scope:** retiring inline-legacy (separate follow-up brief); tuning Bridgewater's gains (assess after fix lands); MVHR recovery ribbon as separate IN flow (likely handled by State 3's existing Heat Balance already — verify in P3); door bug; harness; WWHR; DHW load-shape toggle.

---

## Principles

1. **Diagnose before fix; read code, not summaries.** The architect has confirmed by direct read that State 3 supports v40 input via existing `v40VentilationToV25List` synthesis (line 5079) and siblings. Code must verify this independently in P2 before P3.
2. **Anchor: capture, document, don't fudge.** Bridgewater's numbers WILL change. EUI rises (probably 5-15 kWh/m²·yr) because ventilation heat loss is now honestly counted. Heating demand rises from 0 to 60-150 MWh. Document movements from first principles; never tweak the engine to preserve old numbers.
3. **v25 projects must stay byte-identical.** This brief only changes dispatch for v40-shape inputs. Any project running v25→State 3 today must continue to produce the same output.
4. **No quiet scope expansion.** If P3 verification reveals secondary issues (e.g. MVHR recovery still not surfacing on the Sankey despite State 3 routing), log them in audit §future for follow-up briefs, don't add commits to this brief.
5. **Inline-legacy stays alive.** Don't touch its code. It remains the fallback for projects with neither v25 nor v40 config. Retirement is a follow-up brief once we're confident State 3 handles every active project shape.

---

## Parts (each = one commit unless noted)

**Part 1 — Precondition + anchor capture.**
Land brief on disk. Open audit stub. Run Bridgewater clean. Record full pre-fix anchor in audit §1. Capture every number you can — this is the regression target for everything that follows.

Anchor must include:
- EUI (kWh/m²·yr)
- Σ electricity (MWh), Σ gas (MWh)
- Heating demand, cooling demand, DHW demand (MWh)
- Heat Balance Sankey: Σ gains, Σ losses, Net residual
- Mech ventilation ribbon value (currently 0 per Brief 74 close)
- Each ventilation system's fan electricity
- Lighting + Equipment + Small Power totals
- Internal gains breakdown

Commit: `Brief 76 P1: STATUS reconcile + pre-fix Bridgewater anchor + brief landing`.

---

**Part 2 — Verify the dispatch reading (read-only).**

Read engine source directly. Confirm in audit §2:

- **Dispatch gate location and current logic.** Read `instantCalc.js:6660-6680`. Confirm:
  - Line 6667: `const hasV25Config = building.systems_config_v25 && Object.keys(building.systems_config_v25).length > 0`
  - Line 6668: `const hasV25Library = Array.isArray(libraryData?.system_templates) && libraryData.system_templates.length > 0`
  - Line 6669: `if (mode === 'full' && (options.engine === 'v2.5' || (hasV25Config && hasV25Library))) { return _calculateState3(...) }`
- **State 3 reads v40 input.** Read `instantCalc.js:5079` (`const v25ListFromV40 = v40VentilationToV25List(v40VentBlock)`) and `5138-5140` (`v40ServiceBlockToV25Shape` calls for heating/cooling/DHW). Confirm these read v40 input and produce v25-shape data internally.
- **State 2 reads v40 ventilation natively.** Read `instantCalc.js:2860-2960`. Confirm State 2 iterates `building?.systems_config_v25?.ventilation` AND overrides with v40 values per system via `v40VentMap`. **Critical question to answer in audit §2**: if `systems_config_v25.ventilation` is empty but `systems_config_v40.ventilation` has entries, does State 2 see the v40 ventilation systems? If no, an extra v25 mirror synthesis is needed at dispatch.

If State 2 does NOT see v40 ventilation when v25 is empty:
- Find existing helpers (`v40VentilationToV25List` in `systemsEngine.js`, similar siblings) and identify where to wire a v25-shape mirror in before State 2 is called.
- Document the precise location and shape in audit §2 before any code changes.

If State 2 DOES see v40 ventilation (because State 3 wraps the call and synthesises mirror first):
- Confirm and document path. The dispatch change is then truly one-line.

Commit: `Brief 76 P2: dispatch + state3 v40 read-path verified (read-only)`.

---

**Part 3 — Dispatch gate change.**

Per P2's findings, make the change. Two possible shapes depending on P2's result:

**Shape A (if State 3 synthesises v25 mirror cleanly when v40 input arrives):**

Edit `instantCalc.js` around line 6667-6669:

```javascript
const hasV25Config = building.systems_config_v25 && Object.keys(building.systems_config_v25).length > 0
const hasV40Config = building.systems_config_v40 && Object.keys(building.systems_config_v40).length > 0
const hasV25Library = Array.isArray(libraryData?.system_templates) && libraryData.system_templates.length > 0
if (mode === 'full' && (options.engine === 'v2.5' || (hasV25Config && hasV25Library) || hasV40Config)) {
  return _calculateState3(
    withMode(building, mode),
    constructions, libraryData, weatherData, hourlySolar,
    options.comfortBand,
  )
}
```

Note: `hasV40Config` does NOT require a library because v40 carries efficiency metrics inline. Library requirement is preserved for the v25 path for back-compat.

**Shape B (if State 2 needs v25 mirror synthesis before State 3 will work for v40):**

Same dispatch change as Shape A, PLUS wire `v40VentilationToV25List` (and any other necessary synthesis) inside `_calculateState3` before the State 2 call. The architect's read suggests this is already happening at `instantCalc.js:5079` but P2 must confirm.

**Gates:**
- (a) Bridgewater dispatches to State 3 (not inline-legacy). Verify via instrumented run or audit log line.
- (b) Engine completes without errors on Bridgewater.
- (c) Output schema matches what the UI consumes (no field-shape regression).

Commit: `Brief 76 P3: extend State 3 dispatch to v40-shape projects`.

---

**Part 4 — Bridgewater post-fix anchor capture + reconciliation.**

Run Bridgewater clean. Capture full post-fix anchor. Document deltas vs P1 anchor from first principles.

**Expected movements** (predict before measuring; honesty check):
- EUI: rises by an estimated 5-15 kWh/m²·yr. The inline-legacy `vent_kWh` calculation under-counts vent loss for v40-shape input; State 2 reads three real systems and accounts for their flow/HRE per hour.
- Heating demand: rises from 0 to an estimated 60-150 MWh. The State 2 hourly loop will find hours where outdoor temp is below the heating setpoint AND gains can't compensate. UK climate guarantees these hours exist.
- Cooling demand: changes shape — possibly drops modestly (gains-saturation in summer is now offset by State 2's honest accounting).
- DHW: roughly unchanged.
- Mech ventilation ribbon on Heat Balance Sankey: rises from 0 to a real value reflecting `Σ_hours (UA_eff × dT_heat_out)` across three vent systems.
- Σ losses on Heat Balance: rises by the mech vent contribution.
- Net (gains − losses) residual: moves toward zero (was +16 MWh in Brief 73 close — the +16 was the hidden vent loss that's now surfaced).
- Σ electricity, Σ gas: shifts based on heating demand becoming real (small increase in either electricity or gas depending on heating system fuel split).

After capture, write up the comparison table in audit §4 with first-principles explanation for every movement. Any movement that doesn't match expectation is a finding — investigate before closing.

Commit: `Brief 76 P4: post-fix Bridgewater anchor + reconciliation`.

---

**Part 5 — Regression check on v25 projects.**

If any v25-shape projects exist in the local DB (not Bridgewater), run them through the engine and confirm byte-identical output before vs after this brief. The dispatch change for v25 is `(hasV25Config && hasV25Library)` → same logic, so they should be byte-identical, but verify.

If no v25 projects exist locally, document the absence in audit §5 and skip the byte-equality check. The dispatch logic is conditional in a way that v25 should be unaffected, but absence of evidence isn't evidence of absence.

Commit: `Brief 76 P5: v25 regression check` (may be a no-op commit with just audit notes if no v25 projects exist).

---

**Part 6 — Walkthrough + close. [HARD STOP for Chris's walkthrough]**

Code self-verifies via MCP browser tools and logs results in audit §6. Then Chris's walkthrough at :5176:

1. EUI on Bridgewater is different from pre-fix anchor (movement documented in §4). ✓/✗
2. Heating demand on Bridgewater is non-zero AND sensible for a 4,125 m² UK hotel (rough range 60-150 MWh). ✓/✗
3. Internal Gains → Heat Balance Sankey: Mech ventilation ribbon visible and non-zero on OUT-Losses side. ✓/✗
4. Σ losses on Heat Balance has risen vs P1 anchor by the vent ribbon contribution. ✓/✗
5. Net (gains − losses) residual has moved toward zero. ✓/✗
6. Systems → Energy Flows Sankey: Auxiliary row still renders (Brief 74 fix preserved). ✓/✗
7. Systems → right strip: Auxiliary entry still present. ✓/✗
8. Heating share validation still works (drag a slider, warning fires). ✓/✗
9. DHW share validation still works. ✓/✗
10. No ventilation share slider/warning (Brief 73 fix preserved). ✓/✗
11. Per-system ventilation fans show real numbers (~42 MWh total across three systems). ✓/✗
12. Disabling all three vent systems collapses both vent fan electricity AND mech vent loss ribbon; heating demand rises (less loss compensation needed); restore. ✓/✗

Commit: `Brief 76 P6: close + walkthrough + archive`.
Archive both Brief 75 and Brief 76: `git mv docs/briefs/active/75_*.md docs/briefs/archive/75_*_SUPERSEDED.md` and `git mv docs/briefs/active/76_*.md docs/briefs/archive/76_*_COMPLETED.md`. Update STATUS.md. Repoint `current.md`.

---

## What MUST NOT happen

- **Inline-legacy code being modified or deleted.** Leave it alone. Retirement is a follow-up brief.
- The Bridgewater anchor being "preserved" by editing engine parameters to match old numbers. The numbers will change; document the change honestly.
- v25 projects' output changing as a side effect. The dispatch logic for v25 is unchanged. If P5 finds byte-drift on v25 projects, STOP and diagnose.
- New helpers being written for v40 synthesis. The existing `v40VentilationToV25List`, `v40ServiceBlockToV25Shape`, `v40ThinBlockToKwh` already exist. Reuse them.
- Adding a "v40 → use State 3" override that bypasses the existing State 3 v40 synthesis logic — that path is already wired and tested.
- A new MVHR recovery ribbon being added in this brief. If State 3's Heat Balance Sankey doesn't already show MVHR recovery cleanly, log it in audit §future and address in a follow-up.
- Tuning Bridgewater's input parameters to "get nicer numbers." The new numbers ARE the numbers. If Bridgewater turns out to have wonky lighting/equipment defaults (Brief 73 P6 outcome-(a) follow-on), address in a separate brief.
- The Brief 75 anchor file being deleted. It's input to this brief.
- Quiet scope expansion.

---

## Escalation triggers

- **P2 reveals State 2 cannot read v40 ventilation when v25 is empty AND no synthesis happens upstream** → STOP, raise to Chris. We may need a deeper fix than one-line dispatch.
- **P3 dispatch change causes engine errors on Bridgewater** → STOP and diagnose. Probable cause: v40 input shape edge case the synthesis helpers don't handle.
- **P4 movements wildly different from predictions** (e.g. heating demand jumps to 500 MWh, or stays at 0) → STOP. Either there's a deeper bug we haven't found, or the prediction was wrong. Diagnose before continuing.
- **P5 finds v25 projects byte-drift** → STOP. The dispatch logic shouldn't affect v25, but if it does, the fix has a hidden side effect.
- **Three approaches tried on any single issue** → escalate.

---

## Final report (at close)

Commit SHAs per part. Before-vs-after anchor table with first-principles explanations for every movement. P2 verdict on whether Shape A or Shape B applied. Walkthrough ✓/✗ table. v25 regression check outcome. Any Tier-3 items surfaced for future briefs (especially candidates for inline-legacy retirement, lighting/equipment baseline tuning, etc.).
