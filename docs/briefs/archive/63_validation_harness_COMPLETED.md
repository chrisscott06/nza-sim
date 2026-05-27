# Brief 63 — Autonomous engine validation harness: build it, run it, diagnose it, fix it, keep it. One report.

**Author:** Claude Chat (architect). **Authorised by:** Chris.
**Type:** Tier 3, autonomous. Build + run + diagnose + FIX + permanent regression guard. Chris is removed from the loop except for (a) reading the final report and (b) deciding the handful of genuinely-ambiguous MODELLING judgements that physics alone can't settle.
**Repo:** github.com/chrisscott06/nza-sim. Verification on the running model. Back up the DB before starting.
**Canonical note:** Notion `367d645e-05cc-81af-93d7-fc57bfc45faf`. The standing rules apply throughout and are NOT restated per-test: gate on CONSISTENCY not baseline EUI; "drift" is not a failure; every number must stack up; "complete" means gates RUN with numbers shown, never assumed.

## Chris's mandate (verbatim intent)
"This is not hard physics. There is an engine that needs to be tested thoroughly, and there are very simple building-physics tests we can do. Stop doing it bit by bit — it needs to be a clean sweep. There are a hundred tests we could give it. I don't want to have to look at this. It should diagnose absolutely every issue and fix it, because we're not making it up — the numbers should add up, and they should work when we know the ordering of things that change. Remove me from the design and the verification as far as you can: lay it out, review it, and fix it in one go. That may mean plugging gaps in showing the working and visualising how the engine works."

## What this brief delivers
1. **An introspection layer** — the engine exposes every intermediate quantity a physics test needs to assert on (total gains, hours-in-each-regime, per-path bidirectional flows, recovery, the heat-balance components). This is the "show the working" Chris asked for; it also makes the engine legible going forward. Tests that can't be written because a quantity isn't exposed → expose it. No test is skipped for lack of introspection.
2. **A comprehensive physics assertion battery** — 100+ first-principles assertions across every input and every output relationship (categories below). Each is a building-physics law with a known-correct answer Claude Code derives itself — NOT something Chris supplies or adjudicates.
3. **Autonomous run → diagnose → fix → re-run loop** — Claude Code runs the battery, and for every FAIL: traces the root cause, fixes it (engine or display as appropriate), re-runs, and continues until the battery is green or a failure is a genuine modelling-judgement question (the only thing escalated).
4. **A permanent regression harness** — the battery stays in the repo and runs on every future change. This class of bug cannot silently return.
5. **One report** — final document: every test, expected vs actual, pass/fail; the fixes applied with their root causes; and the (ideally empty, at most short) list of genuine modelling-judgement questions for Chris.

---

## BEFORE DOING ANYTHING
1. Read this brief; confirm receipt by quoting the mandate's first line + the five deliverables.
2. Read CLAUDE.md / STATUS.md / current.md and the canonical Notion note (esp. the Brief 61 audit findings, the governing principle, the every-number-stacks-up rule). Brief 61's consistency sweep and `scripts/_brief61_consistency_sweep.mjs` are the seed pattern — extend, don't restart.
3. Confirm Brief 62 (setpoint single-source) is landed — the battery assumes it. If not, note it; setpoint tests will fail and that's a known pending fix, not a new finding.
4. Back up the DB.
5. Land this brief at docs/briefs/active/63_validation_harness.md.

## Authority and autonomy (the point of this brief)
- Claude Code DECIDES and FIXES every failure whose correct answer is determined by physics or by the standing rules. It does not ask Chris about these. Examples that are NOT questions for Chris: "should demand rise when the setpoint rises?" (yes — physics), "should the parts sum to the total?" (yes — rule), "should bypass-on ever cost more than bypass-off in genuine cooling hours?" (no — physics).
- The ONLY things escalated to Chris are genuine MODELLING JUDGEMENTS where physics doesn't dictate one answer — e.g. "should DHW default to peak-every-day or apply an occupancy rate?", "is 8% the right default auxiliary gain fraction?". These are design choices, not correctness. Collect them into a short list at the end; do not stop the sweep for them.
- If a fix would change behaviour Chris has previously ruled on (e.g. share_pct retirement, inherit/override), follow the ruling in the Notion note; if none exists and it's physics, decide it; if it's a judgement, add it to the escalation list.
- 3 approaches per individual fix, then mark that test BLOCKED with the reason and move on — never stall the whole sweep on one test.

---

## PART 1 — Introspection layer (expose the working so tests can assert on it)
Audit what intermediate quantities the tests below need, and expose any not already emitted. At minimum, the engine output must expose (per run, per service where relevant):
- Total annual heat gains (internal + solar + any retained), and each component.
- Hours in each regime: heating-direction, cooling-direction, shoulder, comfort.
- Per-path flows in BOTH directions (wall, glazing, roof, floor, ventilation, infiltration, thermal bridging): gross loss AND gross gain, not just the loss-direction accumulation. (This is the Sankey gross-vs-net question — the engine must expose both directions so the heat balance can be shown honestly and tested for balance.)
- Recovery (MVHR) pre- and post-recovery demand.
- The resolved setpoints actually used (heating/cooling), and their source (inherit vs custom).
- Bypass: hours fired, classified by regime.
Commit: `Brief 63 P1: engine introspection layer (expose gains, regime-hours, bidirectional path flows, recovery, resolved setpoints, bypass-hours)`. Engine diff is expected (additive output only — must not change any existing number; assert that).

## PART 2 — The physics assertion battery (100+ tests)
Claude Code writes these as code, deriving each expected answer from first principles. Categories (write as many concrete tests per category as the inputs allow — aim 100+ total):

**A. Monotonicity / direction** (one per input × affected output):
- Heating setpoint ↑ → heating demand ↑. Cooling setpoint ↓ → cooling demand ↑.
- Insulation (U-value) ↓ → heating demand ↓, cooling demand direction per gains.
- Glazing area ↑ → solar gain ↑, heating demand ↓ (winter offset), cooling demand ↑.
- Infiltration/ACH ↑ → heating demand ↑.
- Ventilation flow ↑ → vent heat loss ↑ AND fan power ↑.
- SFP ↑ → fan power ↑, demand unchanged.
- HRE ↑ → vent heat loss ↓ (post-recovery), by ~(1−HRE) scaling.
- SCOP ↑ → heating fuel ↓ (∝ 1/SCOP), demand unchanged. SEER ↑ → cooling fuel ↓.
- Lighting/equipment power ↓ → electricity ↓ AND internal gain ↓ (Brief 58 C coupling) → heating demand ↑ slightly, cooling ↓.
- Occupancy (people) ↑ → internal gain ↑, DHW demand ↑.

**B. Bounds / sanity** (physical limits that must never be violated):
- Cooling demand ≤ total annual heat gains. (The vent-off 400 MWh question becomes this test.)
- Heating demand ≤ total fabric+vent+infiltration loss.
- Fuel ≥ delivered ÷ (max plausible efficiency); fuel = delivered ÷ efficiency exactly.
- No demand, fuel, or EUI negative.
- Post-recovery demand ≤ pre-recovery demand (recovery can't increase the load it recovers from).
- Delivered = demand (a system delivers exactly the demand; if not, that's the Root-Cause-A class).
- Bypass-on EUI ≤ bypass-off EUI in genuine cooling hours (if violated, classify the bypass-firing hours — the Brief 53/63 decompose).

**C. Conservation / balance**:
- Heat balance closes: Σ gains + heating delivered = Σ losses + cooling delivered + storage Δ (annual storage Δ ≈ 0). The Sankey must BALANCE — if loss terms are gross-directional and gains are net, it won't; expose both directions (Part 1) and assert closure.
- Σ per-service fuel by carrier = total fuel by carrier = consumption.total. (The carrier-vs-EUI 0.3 gap becomes this test — find and close the missing term.)
- EUI = total fuel ÷ reported_gia, exactly, from the same fuel the carrier rows sum to.

**D. No-op invariance**:
- Changing an input moves ONLY what it should: SFP change doesn't move DHW; cooling setpoint doesn't move heating fuel (except via genuine band interaction); a noop edit changes nothing.

**E. Ordering / parity** (Chris's "when we know the ordering of things that change"):
- Two interventions stacked: final state identical regardless of order (Brief 55 order-independence, as a permanent test).
- Same change applied as a baseline edit == applied as the equivalent intervention (Brief 60 Part C parity, as a permanent test) — demand, fuel, EUI identical.

**F. Reconciliation (every number stacks up)**:
- On every panel/output: every Δ = after − baseline; parts sum to totals; same quantity in two places matches. (Catches the +714, +9, 0.3-gap classes.)

Commit the battery: `Brief 63 P2: physics assertion battery (NNN tests across monotonicity/bounds/conservation/invariance/ordering/reconciliation)`.

## PART 3 — Run → diagnose → fix → re-run (autonomous)
- Run the full battery. Produce the initial pass/fail matrix.
- For each FAIL: trace root cause (read the engine; identify whether it's a source-mismatch, a missing term, a display-aggregation bug, a sign/direction error, etc.), GROUP failures by shared root cause, and FIX — engine fix or display fix as appropriate, hand-calc-anchored, one commit per root-cause group.
- Re-run after each fix group; continue until green or BLOCKED-with-reason or escalated-as-judgement.
- Do NOT calibrate to make a test pass — fix the cause. A test that passes only by tweaking a tolerance to hide a real gap is a violation.

## PART 4 — Permanent wiring
- Wire the battery to run as a single command (e.g. `node scripts/validate_engine.mjs`) and as part of the standard verification suite, so it re-runs on every future change.
- A red assertion must fail loud (non-zero exit / clear report), so this bug class can't silently return.
Commit: `Brief 63 P4: wire validation harness as permanent regression guard`.

## Deliverable — ONE report
`docs/audit/63_validation_report.md`:
1. The full matrix: every test, expected, actual, PASS/FAIL/BLOCKED.
2. Fixes applied, grouped by root cause, with the hand-calc that anchored each.
3. The short list of genuine MODELLING-JUDGEMENT questions for Chris (ideally empty; these are the only things needing his input).
4. Confirmation the battery is green (or the explicit list of what remains and why).
5. The permanent-run command + how it's wired.

## IN-SCREEN WALKTHROUGH (Chris, browser, :5178) — REQUIRED, non-negotiable
The harness tests engine OUTPUT. It does NOT prove the DISPLAYS are correct — the engine can reconcile while a panel renders a stale or wrong number (exactly what happened this week: engine reconciled but the panel showed +714; engine correct but the Sankey read a stale source). So a green harness is NECESSARY BUT NOT SUFFICIENT. Chris's walkthrough is the only thing that catches display-vs-engine divergence, and it ALSO validates the harness itself against reality (a harness that's green but doesn't match the screen is a broken harness).

This walkthrough is a SPOT-CHECK that the harness verdict matches the live tool — NOT a re-run of all 100 tests by hand. In the report, Claude Code must NOMINATE ~8–10 representative PASS results spanning the categories (one monotonicity, one bound, one conservation/balance, one ordering/parity, one reconciliation) AND the specific things Chris hit by eye (the vent-off cooling bound, the carrier-vs-EUI reconciliation, the Sankey balance, a setpoint→demand move). For each nominated test, the report states the exact in-tool action and the expected on-screen result.

Chris's checklist (built from Claude Code's nominations):
1. For each nominated test: perform the stated action in the tool, confirm the on-screen number matches the harness's "actual" value. ✓/✗ per test.
2. Sankey / heat-balance / energy-flows: confirm they BALANCE on screen (gains = losses + cooling + storage) and move correctly when an input changes — the conservation PASS must be visible in the diagram, not just in the data. ✓/✗
3. Every-number-stacks-up panels: change an input, confirm the consistency banner stays green and the totals reconcile on screen. ✓/✗
4. Any test where the harness says PASS but the screen disagrees = a DISPLAY bug the harness missed → surface it; the harness must be extended with a display-layer assertion so it would catch it next time. ✓/✗

If the screen disagrees with the harness anywhere, the harness is incomplete (testing output but not the render) — that's a finding, and the harness gets a display-layer assertion added. Chris signs off only when the spot-checked screen matches the harness verdict.

## What MUST NOT happen
- Do NOT escalate physics-determined or rule-determined questions to Chris — decide and fix them. Only genuine modelling judgements escalate.
- Do NOT treat a green harness as "done" — the in-screen walkthrough is required; a harness green while the screen is wrong means the harness is INCOMPLETE, not that the tool is correct.
- Do NOT calibrate/tweak tolerances to pass a test — fix the cause.
- Do NOT gate on baseline EUI or use "drift" — gate on consistency. The introspection layer must not change any existing number (additive only).
- Do NOT stall the whole sweep on one stubborn test — mark BLOCKED with reason, continue.
- Do NOT report "complete" — report the matrix with numbers; green or explicitly-listed-remaining.

## When to escalate (the ONLY things for Chris)
- A genuine modelling-judgement default (DHW basis, auxiliary gain fractions, comfort-band defaults) where physics permits more than one defensible answer.
- A finding that the engine is architecturally unable to satisfy a physics law without a large redesign (surface it; don't silently work around).
- Otherwise: decide, fix, move on.

## Final note
This is the clean sweep. After it: the engine has a permanent, comprehensive, self-checking physics guard; the working is exposed (introspection layer); the diagrams can be shown honestly (bidirectional flows); and the recurring source-mismatch / reconciliation / ordering bug classes are caught automatically forever. The remaining product work (Brief 60 Part B auxiliary energy, Part C parity guard — now partly subsumed, Brief 64 diagram verification — now partly subsumed by Parts 1+2C) sequences after, in a frame that's finally trustworthy.
