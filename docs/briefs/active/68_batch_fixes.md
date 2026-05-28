# Brief 68 — Batch Fixes (carbon, shading, fan toggle, labels, allowlist drift)

**Status:** active
**Lands at:** `docs/briefs/active/68_batch_fixes.md`
**Owner/reviewer:** Chris (signs off via in-browser walkthrough)
**Architect:** Claude Chat
**Builder/verifier:** Claude Code
**Canonical test buildings:** Bridgewater + Brief66 Test Office (`3cb8cac5-2458-49a8-99f5-ac1eed5b9821`)

This brief clears the confirmed, no-diagnosis-needed bugs found across Briefs 61–66 and the Hidden Assumptions Register v3, so the base is clean before Brief 67 (demand model) lands. **These are FIX briefs — each part is diagnosed already; build the fix, gate it, move on.** One commit per part.

---

## BEFORE DOING ANYTHING

1. Quote this brief's title and first paragraph back as your first action.
2. Read `CLAUDE.md`, `STATUS.md`, the Notion diagnostics note (`367d645e-05cc-81af-93d7-fc57bfc45faf`) — Hidden Assumptions Register v3 section + Brief 66 report (`docs/audit/66_walkthrough_report.md`).
3. **Read each target site in source before editing.** Each part below gives the file:line from the register/report; confirm it matches before changing.
4. Clean tree + origin sync. Land this brief at `docs/briefs/active/` as Part A's first commit.
5. Each part: build fix → run gate with numbers shown → commit. If a gate fails, report "Part X FAILED: [numbers]" and STOP that part; continue to the next independent part.

---

## PRINCIPLES

1. **Gate on consistency.** Some of these move numbers (carbon, shading, fan electricity). That's the point. Gate on: the fix produces the physically-correct direction; hand-calc magnitude matches; the anchor moves only where expected; reconciliation holds.
2. **Single source of truth.** Several of these bugs ARE duplicate-source bugs (carbon factors, frame fraction). The fix is always: one constant, imported everywhere. Never patch one copy.
3. **Every number must stack up.** After each fix, the affected panel must still reconcile (parts sum to total, Δ = after − baseline).
4. **"Complete" is banned.** Report "built, gate RUN with numbers" or "built, gate FAILED."

---

## PART A — Carbon factor single-source (register B1) 🔴

**Bug:** three electricity carbon factors exist — `BEIS_2024_FACTORS.electricity = 0.207` (instantCalc.js:4246), `CARBON_KG_PER_KWH.electricity = 0.193` (systemsEngine.js:43), and `GRID_INTENSITY_2026 = 0.145` (instantCalc.js). A comment at systemsEngine.js:39 falsely claims they match. District-cooling carbon = electricity (systemsEngine.js:48), a placeholder.

**Fix:**
- Create ONE carbon-factors module (or one exported constant object) that is the single source. Both instantCalc.js and systemsEngine.js import from it. No re-declaration.
- Decide the values explicitly (this needs a real number, not a guess — **use the current published UK government conversion factors; if unsure of the exact current value, flag it in the report rather than inventing one**). The three current numbers suggest: a "current grid" factor and a "projected/future grid" factor are BOTH legitimately needed — name them separately and unambiguously (`ELECTRICITY_CURRENT`, `ELECTRICITY_PROJECTED_2030` or similar). Do NOT silently collapse them into one if they serve different purposes — but they MUST each be single-source.
- District cooling: if no real factor is available, keep a placeholder BUT name it `DISTRICT_COOLING_PLACEHOLDER` and comment that it duplicates electricity and needs a real network-specific value. No silent placeholder masquerading as data.
- Fix the false "they match" comment.

**Gate:**
- Bridgewater carbon before/after on every panel that shows carbon (Home, Systems, Energy Flows). They must now all read the SAME number (previously they could differ by 7.3%).
- Report the electricity factor chosen and its source.
- **Hard stop** if panels still disagree after the fix, or if you can't find an authoritative current value (flag for Chris instead of inventing).

---

## PART B — Shading factor floor (register U1) 🔴

**Bug:** `Math.max(0.4, ...)` clips the shading factor so shading can never reduce solar gain by more than 60%, even with deep overhangs or external blinds. Caps the benefit of a real shading intervention.

**Fix:**
- Find the `Math.max(0.4, ...)` clip in the solar-gain path (register U1).
- Determine WHY the 0.4 floor exists — read surrounding code/comments. If it's a guard against a degenerate calculation (e.g. divide-by-zero or a geometry edge case), preserve that guard but at a physically-sensible floor (a real external shade can reach ~0.1–0.15 transmission). If it's an arbitrary cap, remove it and let the shading calc produce its real value, clamped only to the physical [0,1] range.
- **Do NOT simply delete the clamp if it's load-bearing for stability** — understand it first. If you can't tell, report what the clamp does and propose the floor value rather than guessing.

**Gate:**
- Create/configure a shading intervention on the Brief66 office (deep overhang or external shade). Report solar gain and cooling demand before/after with the OLD floor (0.4) vs the NEW floor. The benefit should now be larger and physically sensible.
- Confirm a no-shading case is unchanged.
- **Hard stop** if removing the floor produces NaN, negative solar, or instability — that means it was load-bearing; report and propose a safe floor.

---

## PART C — Fan electricity honours disabled ventilation (register U4 / Brief 66 HIGH-8) 🔴

**Bug:** State 2 mech-vent loss uses an AND-gate (`v25.enabled AND v40.enabled`) — disabling either zeros it. State 3 fan electricity (`systemsEngine._computeVentilation`, ~L599) reads v40-only, so disabling `v25.ventilation[].enabled` alone leaves fan electricity at ~39.4 MWh on Bridgewater, inflating EUI 10.6%. Canonical UI path writes v40-only so new projects are unaffected; Bridgewater (dual v25+v40 from migration) and script/DB paths are affected.

**Fix (register-recommended Option C):**
- Add `&& v25Match?.enabled !== false` guard inside `systemsEngine._computeVentilation` (~L599) so the fan calc honours the same AND-gate State 2 uses. Two-line change.
- Confirm the guard reads the same v25/v40 match the rest of the function uses (don't introduce a new lookup).

**Gate:**
- On Bridgewater: disable `v25.ventilation[].enabled` alone. Confirm fan electricity now drops to 0 (was 39.4 MWh) and EUI drops to the correct ~86.2 (was 95.3). Confirm headline electricity on Home/Systems/Energy Flows all update.
- Confirm vent-ENABLED Bridgewater is UNCHANGED (the guard must not affect the normal case).
- Confirm new v40-only office project still toggles correctly.
- **Plus:** add a regression assertion to `validate_engine.mjs` — "disabling a vent system zeros its fan_electricity_mwh" (register Option D).
- **Hard stop** if vent-enabled numbers change, or other services regress.

---

## PART D — scop_effective label for gas systems (Brief 66 HIGH-4) 🟠

**Bug:** the `scop_effective` field displays 0.92 (the gas boiler efficiency) for gas systems. SCOP is a heat-pump concept; showing it for a gas boiler is a mislabel that reads as a broken COP.

**Fix:**
- This is a LABEL/display fix, not an engine change. Find where `scop_effective` is rendered.
- For non-heat-pump systems, either: (a) relabel the field to "Efficiency" / "Seasonal efficiency" when the system is combustion-based, or (b) suppress the SCOP field for non-heat-pump systems and show efficiency instead. Pick whichever matches the existing component pattern; report which.
- Do not change the underlying number — 0.92 boiler efficiency is correct; only its label is wrong.

**Gate:**
- Show a gas-boiler system and a heat-pump system (if the office or Bridgewater has both, or configure one). Confirm gas shows "Efficiency 0.92" (or equivalent) and heat-pump still shows "SCOP" correctly.
- No engine number changes.

---

## PART E — Internal Gains vs Systems cooling mismatch / allowlist drift (Brief 66 MED-8 / CONS-1, register G9/A7) 🟠

**Bug:** Internal Gains module shows "Cooling demand" 82.5 MWh; Systems shows 75.7 MWh. Root cause: `useStateComparison`'s envelope-gains-mode call goes through `withMode`, which drops `systems_config_v40` (instantCalc.js:570-577) — so the State 2 instance inside Internal Gains sees no ventilation/lighting/setpoint config and computes a different cooling number.

**Fix — choose based on what's correct:**
- The RIGHT fix is to make `withMode('envelope-gains')` pass through `systems_config_v40` so the Internal Gains State 2 sees the same config State 3 does. Read `withMode` (instantCalc.js:469-577) and confirm whether passing v40 through is safe for the envelope-gains diagnostic (it should be — State 2 legitimately uses systems config for ventilation/setpoints).
- **IF** passing v40 through changes other envelope-gains consumers in unintended ways (check `useStateComparison` callers), then FALL BACK to relabelling the Internal Gains number to disambiguate (e.g. "Cooling demand (envelope + gains, pre-systems)") so it's clear it's a different stage, not a contradiction.
- Report which path you took and why.

**Gate:**
- After fix: Internal Gains "Cooling demand" and Systems "Cooling demand" either MATCH (if you fixed the allowlist) or are clearly labelled as different stages (if you relabelled).
- Confirm the allowlist change (if taken) doesn't break State 1 envelope-only (which must still strip systems config) or the harness.
- **Hard stop** if the allowlist change shifts State 1 or breaks harness invariance.

---

## PART F — U2 Jan-1-Monday: INVESTIGATE ONLY, do not fix (register U2)

**This part is read-only.** We don't yet know if the Jan-1-Monday weekday/weekend assumption affects the production path or only inline-legacy.

**Tasks:**
- Find where the sun-position-derived schedules determine weekday/weekend (register U2).
- Determine: does this affect State 2/State 3 (production), or only `calculateInstantDegreeDay` / inline-legacy?
- Read the Bristol EPW currently in use — what day of the week does its Jan 1 actually fall on, and does the engine assume Monday regardless?
- Report: (a) blast radius (production or legacy-only), (b) magnitude (how misaligned could schedules be — full day shift? more?), (c) recommended fix approach.
- **Do NOT fix it in this brief.** If it's production-affecting it gets its own brief; if legacy-only it queues low. Report only.

---

## IN-SCREEN WALKTHROUGH (Chris, browser — REQUIRED)

1. **Carbon (A):** open any two panels showing carbon on Bridgewater. Confirm they now read the same number.
2. **Shading (B):** apply a deep-shading intervention on the office. Confirm cooling-demand benefit is now larger and sensible.
3. **Fan toggle (C):** on Bridgewater, disable ventilation. Confirm fan electricity drops to zero and EUI falls to ~86. Re-enable, confirm it returns.
4. **SCOP label (D):** confirm a gas boiler shows "Efficiency", not "SCOP 0.92".
5. **IG vs Systems cooling (E):** confirm the two cooling-demand numbers match or are clearly stage-labelled.
6. Confirm no consistency-failure banner anywhere; reconciliation holds on all touched panels.

---

## WHAT MUST NOT HAPPEN

- No collapsing the carbon factors into one if they serve different purposes (current vs projected) — single-source each, don't lose a needed distinction.
- No inventing a carbon value — use the authoritative current figure or flag it.
- No deleting the shading clamp without understanding it; no NaN/negative solar.
- No change to vent-enabled Bridgewater numbers from Part C.
- No engine-number change in Part D (label only).
- No State 1 envelope change from Part E.
- No fixing U2 (Part F is investigate-only).
- No tolerance tweaks to pass gates.

---

## WHEN TO ESCALATE (3 approaches then stop)

Per part: if the fix doesn't produce the expected direction/magnitude after 3 approaches, or a gate keeps failing, STOP that part, report the numbers, and continue to the next independent part. Parts A–E are independent; a failure in one does not block the others.

---

## FINAL REPORT

- Title + first paragraph quoted.
- Per part A–E: what changed (file:line), gate numbers (before/after), pass/fail.
- Part A: the carbon factor(s) chosen + source.
- Part C: regression assertion added to validate_engine.mjs (confirm it runs).
- Part F: investigation findings (blast radius, magnitude, recommended approach) — NO fix.
- `npm run validate` PASS/FAIL/BLOCKED after all parts.
- Commits (one per part A–E; Part F is read-only, no commit unless writing findings to an audit file).
- Status per part: "built, gate RUN with numbers" or "built, gate FAILED."
- Walkthrough PENDING Chris.

---

## NOTE

These are the confirmed bugs. Deliberately NOT in this brief (logged elsewhere, not forgotten): Brief 67 demand model; HIGH-1 building-type selector (feature, own brief); inline-legacy harmonisation; share_pct retirement; thermal-mass surfacing (G3); hotel-constants surfacing (H1-H3); round-before-sum (S1); frame-fraction/glazing-absorption duplication (P2/P3); air-heat-capacity unification (P1); Sankey gross-vs-net rebuild.
