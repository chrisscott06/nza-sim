# Brief 48 — Intervention audit-trail / breakdown viewer

**Author:** Claude Chat (architect)
**Authorised by:** Chris Scott
**Status:** Active. Multi-Part brief. Builds on Brief 47 (closed at `5a135f9`).
**Date opened:** 2026-05-25
**Target outcome:** Click an intervention and see — clearly, calmly, not overwhelmingly — the engine's working-out: what the baseline was, what this intervention changed, where in the chain it acted, how much it reduced heat demand, how much it changed electricity and gas, and what its EUI/carbon effect is. An audit trail you can read in real time and sanity-check, so the engine stops being a black box. Edit anything and the trail recomputes from its position in the stack. Doubles as the diagnostic instrument for the open demand-sensitivity findings (A cooling setpoint, C infiltration, D reorder marginals).

After this brief lands: Chris selects MVHR in a stack that already has fabric measures above it, and sees at a glance — "heat demand was 64 MWh after the fabric measures, I take it to 38, that's −26 MWh; electricity goes up 4 MWh from fan power." He can immediately tell whether the engine is counting everything it should. The tool's physics-based credibility becomes visible and checkable.

---

## BEFORE DOING ANYTHING

0. **Session-start documentation reconciliation pass (mandatory).** Per Process Rule 8:
   - `ls docs/briefs/active/` — should be empty (Brief 47 archived at `5a135f9`)
   - `cat docs/briefs/current.md`
   - `tail -50 STATUS.md`
   - `git log --oneline -20`
   - If any check fails, the first commit is the cleanup commit.
1. Read this entire brief.
2. Read CLAUDE.md end to end — particularly Module Scopes (Interventions), the boundary-declaration discipline, and the verification disciplines.
3. Read the diagnostics design note: **NZA-Sim — Visualisation + reactivity audit** (https://www.notion.so/367d645e05cc81af93d7fc57bfc45faf). The whole "boundary-mismatch family" section and Findings A/C/D and the breakdown-viewer-as-audit-trail section are the canonical reference. If anything here disagrees with that note, the note wins.
4. Read the Brief 47 artefacts you build on:
   - `frontend/src/components/modules/interventions/InterventionsModule.jsx`
   - `frontend/src/components/modules/interventions/visualiser/` (the Part 4 view host + switcher)
   - `frontend/src/components/modules/interventions/EUIWaterfall.jsx`, `BeforeAfterBars.jsx`, `PhysicsView.jsx`
   - `frontend/src/components/modules/interventions/ChangeList.jsx`
5. **CRITICAL — the engine audit (this determines the whole brief's size).** Read the engine's intervention pass and establish exactly what per-intervention state is ALREADY computed and what is discarded:
   - `frontend/src/engine/instantCalc.js` — the intervention stack runner (Brief 41 Part 2 `runInterventionStack` / `computeDelta`), and `_calculateState2` / `_calculateState3`
   - For each intervention the engine runs, identify what intermediate quantities exist at the boundaries: raw zone demand, post-MVHR demand, delivered per service, electricity, gas, EUI, CO₂ — both "vs project baseline" and "vs cumulative state above this intervention"
   - **Produce `docs/audit/48_breakdown_data_audit.md` documenting: which of these are already computed and retained, which are computed and discarded, which are not computed at all.** This is read-only — no code changes in the audit.
6. Confirm working tree clean (`git status --short`), `origin/main == local main`.
7. **Part 1's first commit lands this brief at `docs/briefs/active/48_intervention_breakdown_viewer.md`** per Process Rule 7.
8. Do not begin Part 1 proper until checks 0–7 pass and the data audit (§5) is committed.

---

## The core premise — surface, don't recompute

The engine already computes the full before/after state per intervention; it must, to produce the EUI numbers the UI already shows. **This brief is expected to be mostly a surfacing exercise — exposing data the engine computes and discards — NOT a new engine path.** The §5 data audit confirms this. If the audit finds that key quantities (e.g. post-MVHR demand per intervention, or the "vs state above me" framing) are genuinely not computed, escalate to Chris before building — that would change the brief's size and we decide together.

This premise is the reason the brief is worth doing now: high diagnostic value, low engine risk.

---

## Scope statement

**In scope:** a per-intervention audit-trail / breakdown panel that surfaces the engine's working-out, with two baseline framings (vs project baseline; vs cumulative state above this intervention), boundary rows explicit (raw demand / post-MVHR demand / delivered / electricity / gas / EUI / CO₂), live recompute on edit, and a calm, non-overwhelming UX. Optionally (later Part) a whole-stack matrix overview.

**Explicitly OUT of scope (deferred):**
- Any engine recompute or restructure. If the audit says the data exists, this brief only surfaces it. Boundary FIXES (if Findings A/C/D turn out to be real bugs) are a SEPARATE brief — this brief builds the instrument to investigate them, it does not fix them.
- Carbon-trajectory-over-time / CRREM pathways (still its own future brief).
- The whole-stack matrix overview is a later Part, only after the per-intervention panel works.

---

## Operational mode

Checkpoint after Part 2 (the per-intervention panel showing real engine data, browser-verified) before the UX-polish and matrix Parts. Same discipline as Brief 47: the data-correctness core is verified before the presentation is built on top. "Browser verified" = observed in the browser on Bridgewater, reported as observed, or Chris runs it.

---

## Principles

1. **Surface, don't recompute.** The §5 audit governs. Expose existing engine data. No new engine path without escalation.
2. **Boundaries explicit (the Brief 44 discipline made visible to the user).** The whole point is that the panel shows raw-demand vs post-MVHR-demand vs delivered vs fuel as distinct rows. This is the boundary-declaration principle turned into a UI: the user sees the boundaries, which is exactly what catches the boundary-mismatch family. Never collapse two boundaries into one ambiguous "heat" number.
3. **Two baseline framings, both shown.** "vs project baseline" (the original building) and "vs state above me" (cumulative stack above this intervention). The second is the marginal view that answers the reorder question. The engine computes both; show both, clearly labelled.
4. **Calm, not overwhelming (first-class requirement — see UX section).** Clicking an intervention must feel clear and legible, not like opening a spreadsheet. Progressive disclosure: the headline first, the full audit trail on request.
5. **Live recompute from position.** Edit anything → the trail recomputes relative to this intervention's position in the stack, in the same render cycle. Reuses Brief 47's live-update loop.
6. **It's a diagnostic instrument.** Built so that Findings A/C/D can be investigated by reading deltas off the UI. After it ships, the next diagnostic brief uses it instead of isolated hand-calcs.
7. **No engine-number changes.** Bridgewater clean anchor ~121.7 held. UI/surfacing only.

---

## UX & UI — first-class design requirement

**Chris's explicit instruction: this must not be overwhelming to look at when you click an intervention.** It must be really clear what was in the baseline, what this intervention impacted, where in the chain, and what happens downstream — and when anything is changed, it recomputes its relative calculation, presented in a genuinely user-friendly way.

Claude Code: **read `/mnt/skills/public/frontend-design/SKILL.md` and think carefully about this section before building.** This is not a data dump with a stylesheet; the legibility IS the feature. A confusing audit trail is worthless — the entire value is that a human can glance at it and judge "is the engine counting everything it should?"

### Design intent

**Progressive disclosure — three levels, not all at once:**

- **Level 1 — the headline (always visible on selecting an intervention).** One calm line per the few metrics that matter most: what this intervention does. E.g. "Heat demand −26 MWh · Electricity +4 MWh · EUI −5.2 kWh/m²". A reader gets the gist in one second. No boundary jargon at this level.

- **Level 2 — the audit trail (one click / expand).** The before → after → Δ table, with the boundary rows explicit and the two baseline framings. This is the "show the working" level. It should read like a clear statement, not a dense grid: baseline value, this-intervention value, the change, for each quantity. Group sensibly (demand-side together, fuel-side together) with quiet section headers.

- **Level 3 — the chain context (the "where in the chain" view).** Shows this intervention's position in the stack and how the relevant quantity flowed into it and out of it: "heat demand entering this step (after everything above) → heat demand leaving this step (passed to everything below)." This is what makes "where it impacted the chain and what impacts downstream" legible. Could be a small inline mini-waterfall or a simple in/out readout — Claude Code proposes the cleanest form.

### Concrete UX rules

- **Calm by default.** Whitespace, restraint, a clear visual hierarchy. The headline is prominent; the detail is available but not shouting. Use the frontend-design tokens — no hard primary colours competing for attention; reserve colour for meaning (saving vs increase), as the waterfall already does (green saving / red increase).
- **Direction is instantly readable.** A reduction in demand and an increase in electricity should be visually distinguishable at a glance (sign, colour, small arrow) — so "lowers heat demand but raises electricity" reads without parsing numbers.
- **Boundaries labelled in plain language, not engine jargon.** "Heat the building needs" (raw demand), "after heat recovery" (post-MVHR), "delivered by systems" (delivered). A tooltip or small caption can carry the precise term. The user should understand the boundary without knowing the codebase's variable names.
- **The two framings must not confuse.** Make "vs original building" and "vs the step above this one" visually distinct and clearly labelled — ideally the user picks one as primary and the other is secondary, rather than two equal columns competing. Claude Code proposes; default to "vs step above" as primary (it's the marginal/diagnostic one) with "vs original" available.
- **Live edit feedback.** When the user changes a value, the trail updates smoothly and it's obvious which numbers moved. No full-flash re-render that loses the user's place.
- **Empty/zero states.** An intervention that doesn't touch a given metric shows a quiet "no change" not a noisy zero-row. Don't make the user scan rows of zeros to find the one thing that moved.
- **Mobile/narrow not required** (desktop consultancy tool) but the panel must coexist with the Brief 47 left-stack / right-visualiser layout without crowding — likely the breakdown is a view within the right-hand area, or a calm panel that appears when an intervention is selected.

### What "good" looks like (the test)

Show the panel to someone who doesn't know the engine. They should be able to point at MVHR and say, unprompted: "so this lowers the heating the building needs, but adds some electricity for the fans, and overall saves a bit." If they can narrate it correctly without help, the UX has succeeded. If they squint and ask "what's the difference between these two demand numbers?", it needs more work.

---

## Parts

### Part 1 — Engine data surfacing (the plumbing)

**Goal:** Expose the per-intervention working-out from the engine to the UI layer, per the §5 audit. No display yet — just make the data reachable.

**Steps:**
1.1 From the §5 audit, identify the per-intervention quantities to surface: raw demand, post-MVHR demand, delivered per service, electricity, gas, EUI, CO₂ — each in both framings ("vs project baseline", "vs state above"). 
1.2 Where the engine computes and retains these → expose them on the intervention result object (extend the shape `consumption.interventions[]` already carries from Brief 41 Part 2). Where computed-but-discarded → retain them. Where not computed → STOP and escalate per the premise (this would change brief size).
1.3 Boundary-declaring names per the Brief 44 discipline: `heat_raw_demand_*`, `heat_post_mvhr_demand_*`, `*_delivered_*`, `*_source_fuel_*`. No ambiguous `heat_kwh`.
1.4 Unit-test or console-verify on Bridgewater that the surfaced numbers reconcile (e.g. raw demand − MVHR credit = post-MVHR demand; delivered / SCOP ≈ electricity contribution).
1.5 Audit doc §1: what was surfaced, what was already there, what (if anything) needed retaining.

**Commit:** `Brief 48 Part 1: surface per-intervention working-out (boundary-named, both framings)`

### Part 2 — Per-intervention audit-trail panel (Levels 1 & 2) → CHECKPOINT

**Goal:** Selecting an intervention shows the headline (Level 1) and the expandable audit trail (Level 2), reading real engine data, framed vs-step-above by default with vs-original available.

**Steps:**
2.1 `BreakdownPanel.jsx` — Level 1 headline (calm, the few key metrics, plain language, direction-coloured).
2.2 Level 2 expand — before → after → Δ, boundary rows explicit, grouped (demand-side / fuel-side), quiet section headers, zero-rows suppressed to "no change."
2.3 Plain-language boundary labels + tooltips carrying the precise term.
2.4 Framing toggle: "vs step above" (primary) / "vs original building" (secondary), visually distinct, not two competing equal columns.
2.5 Wire into the Brief 47 layout — panel appears on intervention-select, coexists with stack-left/visualiser-right without crowding.
2.6 Read the frontend-design skill; apply tokens; no competing hard colours.

**=== MANDATORY CHECKPOINT (Chris, browser, Bridgewater clean ~121.7) ===**
1. Select MVHR (with fabric measures above it) → headline reads clearly in one glance; the "lowers heat demand, raises electricity" story is legible.
2. Expand → audit trail shows baseline → after → Δ with boundaries as distinct, plain-language rows.
3. The two demand numbers (raw vs post-MVHR) are distinguishable and understandable.
4. Framing toggle works and isn't confusing.
5. The numbers reconcile with the Systems Sankey / Live Results for the same state (e.g. the 28.9/90.3 delivered/demand relationship is visible and consistent).
6. The "narrate it unprompted" test (UX section) — does it pass?
7. Bridgewater clean anchor ~121.7.

**If pass → Parts 3+. If the UX is overwhelming or the numbers don't reconcile → fix before proceeding.**

**Commit:** `Brief 48 Part 2: per-intervention audit-trail panel (headline + expandable trail)`

### Part 3 — Chain context (Level 3) + live recompute polish

**Goal:** The "where in the chain" view — heat-demand (and other quantity) in/out for this step — plus smooth live recompute on edit.

**Steps:**
3.1 Level 3 chain context: quantity entering this step (after everything above) → leaving this step (passed downstream). Cleanest form Claude Code proposes — inline mini-waterfall or in/out readout.
3.2 Live recompute: edit a value → trail updates in the same render cycle (reuse Brief 47 live-update loop), obvious which numbers moved, no place-losing flash.
3.3 Empty/zero-state polish; direction cues; smooth transitions.

**Commit:** `Brief 48 Part 3: chain-context view + live recompute`

### Part 4 — Whole-stack matrix overview (optional/lower priority)

**Goal:** A calm overview table — interventions × key metrics — as the client-facing scan. Built on the same surfaced data.

**Steps:**
4.1 Matrix: rows = interventions, columns = key metrics (Δheat demand, Δelectricity, Δgas, ΔEUI, ΔCO₂), marginal (vs step above) by default.
4.2 Keep it calm — not a dense spreadsheet; sensible precision, direction-coloured, totals row.
4.3 Switch/coexist with the per-intervention panel sensibly.

(If Part 3 reveals the per-intervention panel already satisfies the need, Part 4 can be deferred — confirm with Chris.)

**Commit:** `Brief 48 Part 4: whole-stack breakdown matrix`

### Part 5 — Bridgewater walkthrough + close + investigate findings

**Goal:** Walkthrough confirms the instrument works; then use it to take a first look at Findings A/C/D (read deltas off the UI), recording observations for the future boundary-fix brief. Archive Brief 48.

**Walkthrough (Bridgewater clean ~121.7):**
1. Select each of several interventions → headline + trail clear, not overwhelming, narrate-test passes.
2. MVHR audit trail shows the recovery credit explicitly (raw vs post-MVHR demand).
3. VRF audit trail shows it acts on delivered (~28.9), making the small SCOP-upgrade saving self-explanatory.
4. Chain context legible — where each measure acts, what flows downstream.
5. Edit a value → live recompute, obvious, smooth.
6. Numbers reconcile with Systems views.
7. Anchor ~121.7.

**Findings first-look (record only, no engine fixes):**
8. Use the panel to inspect Finding D (reorder): does the cumulative come out order-independent? Do marginals reconcile to cumulative differences? Record in the diagnostics note.
9. Use the panel to inspect Finding A (cooling setpoint) and C (infiltration): read the demand/delivered deltas directly. Record whether they now look correct-but-gains/climate-limited or genuinely anomalous.
10. Log all observations to the diagnostics note as input to the future boundary-fix brief. **Do not fix the engine in this brief.**

**Commit:** `Brief 48 close: intervention audit-trail viewer + findings first-look`

---

## What MUST NOT happen
- No engine recompute/restructure. Surface existing data; escalate if it's not there.
- No engine boundary FIXES — this brief builds the instrument; fixes are a separate brief.
- No ambiguous heat numbers — boundaries always explicit and named.
- No overwhelming UX — the calm/legible/narrate-test requirement is a gate, not a nicety. Read the frontend-design skill.
- No skipping the Part 2 checkpoint — data-correctness + UX legibility verified before polish/matrix.
- No engine-number drift — Bridgewater clean ~121.7 held.
- No partial commits — each Part one commit + STATUS + audit doc.

## When to escalate
- §5 audit finds key quantities are NOT computed (would change brief size — decide with Chris).
- Surfaced numbers don't reconcile (e.g. raw − MVHR ≠ post-MVHR) — that's a real finding, pause and report.
- The Part 2 checkpoint UX comes out overwhelming and can't be made calm within the panel pattern — rethink with Chris before polishing.
- Bridgewater anchor drifts from ~121.7.

## Notes on discipline
- The §5 data audit governs the brief's size — do it first, honestly.
- Boundaries explicit is the whole point — it's the Brief 44 discipline made visible.
- The UX legibility is the feature, not decoration — a confusing audit trail has zero value.
- The instrument investigates the findings; it does not fix them. Keep that line clean.

Standing by for authorisation to begin (BEFORE-DOING-ANYTHING + the §5 data audit first, then Part 1).
