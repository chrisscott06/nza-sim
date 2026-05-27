# Brief 60 — Finish line: in-tool calculation trail (panel redesign) + auxiliary energy + baseline/intervention parity guard

**Author:** Claude Chat (architect). **Authorised by:** Chris.
**Type:** Tier 3, multi-part. ONE brief, sequenced parts, each independently shippable, one commit per sub-part.
**Repo:** github.com/chrisscott06/nza-sim. **Verification DB:** port 8003, walkthrough :5178. Back up the DB before starting.
**Why this brief exists (Chris, verbatim intent):** "I want to see it in the tool. Get it all wrapped up with the nice new user interface we planned. A single brief that gives us what we've been talking about this whole time."

This is the wrap-up brief. It turns the things that already work in the engine into things you can SEE and TRUST in the tool, finishes the last parked demand feature, and installs the permanent guard that stops the whole class of bug we hit this week.

Three parts:
- **Part A — Redesigned breakdown panel (the in-tool calculation trail).** The three-band demand→delivered→fuel table with the arithmetic shown inline, live, as you tweak. This is the "see how it's calculated in the tool" thing.
- **Part B — Auxiliary energy in Internal Gains (Brief 58 Part D, folded in).** External lighting / catering / pumps / small power as gain-coupled loads.
- **Part C — Baseline-vs-intervention parity guard.** A permanent test: any change applied as a baseline edit AND as the equivalent intervention must give identical demand/fuel/EUI. The guard that would have caught the vent-flow bug on day one.

**Anchor:** Bridgewater clean **110.30** EUI (current, post Brief 58 Part C). Each part states whether it moves the anchor. UI parts (A) MUST show 0-line engine diff. Engine-touching parts hand-calc first.

---

## BEFORE DOING ANYTHING
1. Read this brief in full. Confirm receipt by quoting the title + the three-part list.
2. Read CLAUDE.md / STATUS.md / current.md. Confirm Brief 58 state — Parts A/B/C are done, Part D (auxiliary energy) is folded into THIS brief as Part B. Confirm Brief 59 closed (vent-flow fix + calc-trace harness).
3. Back up the verification DB.
4. Land this brief at docs/briefs/active/60_finish_line.md as Part A1's first commit.
5. Read before touching: the existing BreakdownPanel component (the current demand/delivered/fuel table); the Internal Gains module + how gains feed State 2; `scripts/trace_calc.mjs` (the Brief 59 harness — Part C extends it).

---

## PART A — Redesigned breakdown panel (the in-tool calculation trail)

### What it is
The current breakdown panel shows demand/delivered/fuel rows but hides the arithmetic between them and shows misbehaving/duplicate rows. The redesign makes it a clear, scannable, self-verifying calculation trail — IN THE TOOL, live, no command line. It is the on-screen equivalent of the Brief 59 trace harness.

### Design (locked with Chris — prototype already reviewed and approved)
A single table, all systems and demands always present (unchanged rows dimmed — completeness builds trust), three visually-grouped bands plus headline:

**Top summary cards** (3): the headline deltas — Heat demand Δ, Cooling Δ, Electricity Δ — colour-coded (green saving / red increase) so the result reads at a glance before any rows.

**Band 1 — DEMAND · what the building needs** (baseline / after / Δ):
- Heat needed, Cooling needed, Hot water needed.
- Ventilation's recovery effect surfaces here (it's the reason heat demand moves) — but ventilation does NOT need a forensic per-stream breakdown; "present and accounted for" is enough.
- CUT the broken/duplicate rows: remove "After heat recovery" (duplicate of Heat needed post-fix); DEMOTE "Heat recovered by MVHR" out of the default view (it reads non-monotonically when stacked — show only as an optional informational line clearly labelled "airstream recovery (informational)", never as a headline row).

**Band 2 — DELIVERED ÷ EFFICIENCY = FUEL** (the self-verifying arithmetic, per service):
- One row per system: Heating, Cooling, Hot water, Ventilation/fans, Lighting, Small power, Auxiliary (once Part B lands).
- Each row shows the inline arithmetic: e.g. heating `5.1 ÷ 2.37 = 2.1` — delivered ÷ efficiency = fuel, with the EFFICIENCY value rendered full-strength while the rest of the sub-line is muted, so a changed divisor stands out. Each system names its own carrier (gas for the boiler, electricity for the heat pump).
- Fan energy (SFP × flow) shown as ventilation's fuel row — this is currently NOT displayed; add it.
- Unchanged systems present but dimmed with em-dashes.

**Band 3 — FUEL TOTALS** (by carrier): Total electricity, Total gas — summed.

**Headline:** EUI, Carbon — baseline / after / Δ.

A short plain-English footnote stating the story (e.g. "Heat demand fell X, cooling rose Y — MVHR retains heat the building wants to dump; SCOP unchanged so heating fuel tracks the demand drop").

### Principle
Showing the arithmetic IN the panel is what makes the tool self-verifying: a wrong divisor, a stuck input, a boundary mismatch all become visible on screen, live, while tweaking — the same job the Brief 59 trace does on the command line, now in the UI. Use the frontend-design skill for styling tokens; match the prototype's three-band layout.

### Parts
- A1: panel-redesign audit (read-only) + confirm the data for every row (demand, delivered, efficiency, fuel, fan energy) is already available from the engine output (it is — the trace harness proves it). Map each row to its engine field. Commit: `Brief 60 A1: breakdown-panel redesign audit (read-only)`.
- A2: build the three-band table (demand / delivered÷eff=fuel / fuel totals + summary cards + headline), all systems always shown, unchanged dimmed, broken rows cut/demoted, fan energy added. Commit: `Brief 60 A2: redesigned breakdown panel — three-band calculation trail`.
- A3: inline arithmetic + efficiency-highlight + footnote story line. Commit: `Brief 60 A3: inline delivered÷efficiency=fuel arithmetic + narrative footnote`.

### Falsifiability (Part A)
- Engine git diff = 0 lines (UI-only; all data already computed).
- Every displayed `delivered ÷ efficiency` equals the displayed `fuel` to rounding, every service (the identity must hold on screen — if not, a boundary is wrong and now VISIBLE).
- All systems present; unchanged ones dimmed, not hidden.
- Fan energy row present and equals SFP × flow.
- Reducing a ventilation flow shows heat demand falling in Band 1 AND fan fuel falling in Band 2, live (the Brief 59 fix, now visible in the redesigned panel).
- 110.30 anchor unchanged.

### IN-SCREEN WALKTHROUGH (Chris, browser, :5178) — REQUIRED, do not close Part A without it
For each item: what to do / what to check / pass-fail.
1. Open the redesigned panel on Bridgewater → three bands visible (DEMAND / DELIVERED÷EFF=FUEL / FUEL TOTALS) + 3 summary cards + headline. ✓/✗
2. All systems present in Band 2 (heating, cooling, hot water, ventilation/fans, lighting, small power); unchanged ones dimmed with em-dashes, not hidden. ✓/✗
3. Each Band 2 row shows the inline arithmetic `delivered ÷ efficiency = fuel`; the efficiency value is full-strength, the rest muted. ✓/✗
4. Pick heating: read its arithmetic on screen, check by hand that delivered ÷ efficiency = the displayed fuel. ✓/✗
5. Fan energy row is present under ventilation and equals SFP × flow (sanity-check the number). ✓/✗
6. The "After heat recovery" duplicate row is GONE; "Heat recovered by MVHR" is NOT a headline row (only an optional informational line, if shown at all). ✓/✗
7. Add an intervention, reduce a ventilation flow → in the SAME panel, watch Band 1 heat demand fall AND Band 2 fan fuel fall, live. ✓/✗
8. Summary cards update (heat/cooling/electricity Δ) and colour correctly (green saving / red increase). ✓/✗
9. Footnote states the plain-English story matching the numbers. ✓/✗
10. No-change baseline still reads 110.30 EUI. ✓/✗

---

## PART B — Auxiliary energy in Internal Gains (Brief 58 Part D, folded in)

### What (Chris's spec, confirmed)
A new sub-section WITHIN Internal Gains for loads that fill the gap to the metered total: external lighting, catering (electric), pumps, other small/equipment power. Each load is ONE entity with an electrical consumption AND a first-class `gain_fraction`.

### Open decisions (Chris to confirm at the A-stage walkthrough or inline here)
1. **Module rename?** Internal Gains now holds occupancy + auxiliary loads + gains. Keep "Internal Gains" or rename (e.g. "Gains & Loads")? Default: keep, unless Chris says otherwise.
2. **Load types** to ship: external lighting, catering, pumps, small power. Confirm the list.
3. **Default gain fractions:** auxiliary default ~8%; external lighting ≈0%; catering partial (~50% sensible, rest exhausted); pumps/internal small power mostly internal (~100%). Confirm.

### Architecture (Option 1, decided — preserves the chain)
The load is a GAIN with a fuel carrier. Data lives in the GAINS layer (preserves envelope→gains→demand→systems→fuel). The Internal Gains auxiliary sub-section is the editing surface, writing back to gains. Does NOT invert the chain. Same coupled-load machinery as Brief 58 Part C (lighting/gains) — reuse it.

### Parts
- B1: auxiliary-energy audit (read-only) + the three decisions above settled. Commit: `Brief 60 B1: auxiliary-energy audit + load-type/gain-fraction decisions`. Hard stop for Chris's sign-off on the three decisions.
- B2: auxiliary load data model + Internal Gains sub-section UI (add/edit loads, each with consumption + gain_fraction). Commit: `Brief 60 B2: auxiliary-energy loads in Internal Gains`.
- B3: wire gain_fraction into the heat balance (gain_fraction × consumption raises cooling / lowers heating) + electricity into fuel totals. Commit: `Brief 60 B3: auxiliary gain-coupling into demand + fuel`.

### Falsifiability (Part B)
- Adding an auxiliary load adds electricity AND adds gain_fraction × consumption to the heat balance (raises cooling / lowers heating). Hand-calc first per representative load.
- External lighting at gain_fraction 0 adds electricity but NOT gain.
- Toggling an auxiliary load moves BOTH consequences (same discipline as Part C lighting).
- Auxiliary loads appear as a row in the redesigned panel (Part A) — the two parts integrate.
- 110.30 anchor unchanged when no auxiliary loads are present.

### IN-SCREEN WALKTHROUGH (Chris, browser, :5178) — REQUIRED
1. Internal Gains module shows the new Auxiliary energy sub-section. ✓/✗
2. Add a catering load (electric, partial gain fraction) → electricity rises AND the heat balance shifts (cooling up / heating down by the gain fraction). ✓/✗
3. Add an external-lighting load at gain_fraction 0 → electricity rises, heat balance UNCHANGED. ✓/✗
4. Toggle an auxiliary load off → both its electricity AND its gain disappear together. ✓/✗
5. The auxiliary load appears as its own row in the redesigned breakdown panel (Part A), with its arithmetic. ✓/✗
6. With no auxiliary loads present, baseline EUI still 110.30. ✓/✗
7. Change one auxiliary load's gain_fraction → the heat-balance effect scales with it, electricity unchanged. ✓/✗

---

## PART C — Baseline-vs-intervention parity guard (the permanent safety net)

### Why (Chris's insight)
"Change the ventilation flow in the model, add it as an intervention — it should do the exact same thing." The vent-flow bug existed because the baseline path (writes v25, demand reads v25 → works) and the intervention path (writes v40, demand read v25 → broken) silently diverged. A parity test makes that divergence impossible to ship: applying a change as a baseline edit and as the equivalent intervention MUST yield identical demand/fuel/EUI, because it's the same physics.

### What to build
Extend the Brief 59 trace harness (`scripts/trace_calc.mjs`) with a **parity mode**: given a change (e.g. a vent flow, a SCOP, a lighting control), apply it (a) as a baseline edit and (b) as the equivalent single intervention, run both, and assert demand/fuel/EUI are identical (to rounding). Commit a permanent fixture covering the change types that have a baseline AND an intervention path: ventilation flow/SFP/HRE, heating SCOP, cooling SEER, lighting control. This is the ventilation/systems analogue of the Brief 55 order-independence fixture — a standing regression guard.

### Parts
- C1: parity-mode design + the change-type list (which inputs have both a baseline and an intervention path). Commit: `Brief 60 C1: baseline/intervention parity-mode design`.
- C2: implement parity mode in trace_calc.mjs + the permanent fixture (assert identical results across both paths for each change type). Commit: `Brief 60 C2: baseline/intervention parity guard + fixture`.

### Falsifiability (Part C)
- For each change type, baseline-edit result == equivalent-intervention result (demand, fuel, EUI), to rounding.
- The fixture FAILS if re-run against the pre-Brief-59 code (it would catch the vent-flow divergence) — i.e. it genuinely guards the bug class.
- New change types can be added to the fixture as the model grows.

### IN-SCREEN WALKTHROUGH (Chris, browser, :5178) — REQUIRED
The parity guard is a fixture, but it MUST be demonstrable in-screen (the Dev Bible's in-screen verification applies even to test infrastructure — Chris confirms the parity holds where he can see it, not only in a script):
1. Set a ventilation flow to value X in the BASELINE (Systems page) → note heat demand, cooling, EUI. ✓/✗
2. Reset baseline; apply the SAME flow X as an INTERVENTION → note heat demand, cooling, EUI. ✓/✗
3. The two sets of numbers are IDENTICAL (the parity the guard asserts, seen on screen). ✓/✗
4. Repeat for a heating SCOP change (baseline vs intervention) → identical. ✓/✗
5. The committed fixture passes for every change type and is wired to run in the verification suite. ✓/✗

---

## Global rules
- One commit per sub-part; hard stop at each PART boundary for Chris's sign-off.
- Part A is UI-only → engine git diff = 0 lines (hard check). Part B touches gains/demand → hand-calc first, then match. Part C is harness/test → no engine change.
- Don't calibrate; derive every anchor move.
- Each part independently shippable — Chris can stop after any part and the work is complete.
- Part A and Part B integrate: auxiliary loads (B) must appear as a row in the redesigned panel (A). Build A first so B's row slots into it.

## What MUST NOT happen
- Part A must not change any engine number (UI-only). If a number looks wrong in the new panel, that's a real bug to surface, not to mask with display logic.
- Don't keep the broken "After heat recovery" / non-monotonic "Heat recovered" rows as headline rows — cut/demote per the design.
- Part B must not invert the chain (Option 1 only — load is a gain with a carrier).
- Part C parity guard must use the real engine paths, not reimplement them.

## When to escalate
- A2: a panel row's data isn't actually available from the engine output (A1 should have caught this; if not, surface).
- B3: wiring gain_fraction moves the anchor when no auxiliary loads exist (it shouldn't).
- C2: the parity assertion FAILS on a current change type (means a live baseline/intervention divergence exists — STOP and report, it's a real bug like the vent-flow one).
- 3 approaches per failure, then stop.

## Final report
- Part A: panel screenshots/description; engine diff 0; the delivered÷eff=fuel identity holds on screen; fan energy shown; vent-flow change visibly moves demand + fan fuel.
- Part B: auxiliary loads add electricity + gain; hand-calc vs engine; anchor held with none present; loads appear in the Part A panel.
- Part C: parity holds across all change types; fixture committed; confirmation it would catch the vent-flow-class divergence.
- Update the Notion diagnostics note: redesigned panel live (in-tool calc trail), auxiliary energy live, baseline/intervention parity guard installed.

## After this brief
Brief 58 formally closes (Part D delivered here as Part B). Remaining queue: Brief 51 (panel surfacing — likely now fully satisfied by Part A, re-read and probably delete); the chart/graph SVG+PNG export brief (still parked, your earlier ask); the harness-fixture discrepancy (129.60/131.90) pin. Then the demand-honesty cluster is complete and the tool is self-verifying end to end.
