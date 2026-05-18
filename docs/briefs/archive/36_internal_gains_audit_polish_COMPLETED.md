# Brief 36 — Internal Gains Audit, Colour Discipline, Shared Pop-out Schedule Editor

**Author:** Claude Chat (architect)
**Authorised by:** Chris Scott
**Status:** Active.
**Date opened:** 2026-05-18
**Target outcome:** Internal Gains (State 2 Static) is audited end-to-end using the Brief 29 three-lists method. The left-panel section colour scheme is unified to three shades of purple, matching the Sankey. A shared draggable pop-out schedule editor replaces the centre-canvas editor in Internal Gains AND replaces the stuck schedule editor in Systems, with exception period support added to Systems' editor in the process. STATUS.md and `docs/audit/` reflect the completed work.

---

## BEFORE DOING ANYTHING

1. Read this entire brief.
2. Read CLAUDE.md, particularly the "Module scopes" section (Brief 33 Part 3) and Process Rules 7–11.
3. Read STATUS.md as currently on disk; confirm last entry is Brief 33 Part 3 (commit `d814973`).
4. Read `docs/audit/29_open_issues.md` to see the open issue numbering — new issues from this brief continue from there.
5. Confirm working tree clean: `git status --short`.
6. Confirm `origin/main == local main`: `git fetch origin && git log origin/main..main && git log main..origin/main` both return empty.
7. Do not begin Part 1 until all six checks pass.

---

## Scope statement

This brief touches the Internal Gains module (per CLAUDE.md "Module scopes" stub — to be expanded as part of this brief's audit findings if structural issues are found) and the Systems module (specifically its schedule editor — physics inputs not touched).

The Internal Gains module is State 2 Static. Per the existing stub in CLAUDE.md, it computes occupancy schedules, lighting use, equipment use, and operable envelope operation (none of which involve installed systems or mechanical equipment).

The audit and fixes here are Static-side only. Dynamic remains paused per Brief 32. Systems module is touched only at the schedule editor — no physics, no system efficiency changes.

---

## Operational mode — keep ploughing through

Per Chris's authorisation: this brief runs end-to-end without phase-by-phase sign-off pauses. Findings documents at each Part boundary are the record. Stop and escalate ONLY for the conditions in "When to escalate" below. Otherwise continue.

This overrides any default brief discipline that would otherwise request authorisation between Parts. Authorisation is granted up-front for all four Parts.

---

## Principles

1. **No code touches Dynamic-side paths.** `sql_parser.py`, `epjson_assembler.py`, and the simulation API endpoints stay frozen. Internal Gains' Dynamic toggle was already removed in Brief 28-IM-M4.5 — do not reintroduce.
2. **Static audit findings are documented, not silently fixed.** Document every finding in the audit doc with severity. Fix what's small and in-scope; defer structural findings to follow-up briefs.
3. **No pre-assumed numerical targets.** The engine produces what the physics produces. The sanity check in Part 1 (100% schedule → hand calc) is a falsifiability test, not a calibration target. If the engine disagrees with the hand calc by more than ~5%, that is a finding to investigate.
4. **The shared schedule editor must work the same way in both consumers.** No "Internal Gains has feature X, Systems has feature Y." Single component, single API, shared behaviour. Including exception periods.
5. **Documentation hygiene is part of the commit.** Per CLAUDE.md Process Rule 7. Each Part's STATUS.md and audit-doc updates land in the same commit as the code changes.

---

## Parts

### Part 1 — Internal Gains Static audit

**Goal:** Apply the Brief 29 three-lists method to Internal Gains' Static engine. Identify any hidden integrand terms, display ghosts, or scope contamination. Run an engine sanity check against a hand-calc baseline.

**Files touched (read-only audit, plus findings doc):**
- `frontend/src/utils/instantCalc.js` — `_calculateState2` and related helpers (read-only)
- `frontend/src/components/modules/gains/*.jsx` (read-only)
- `frontend/src/components/modules/gains/canvas/*.jsx` (read-only)
- `frontend/src/components/modules/gains/useAnnualGains.js` (read-only)
- `frontend/src/context/ProjectContext.jsx` — for the gains data model (read-only)
- `docs/audit/32_static_audit_FINDINGS.md` (new — or extended if Brief 32 left a stub)
- `docs/audit/29_open_issues.md` — append any new issues, numbering continues from current max

**Steps:**

1.1 **Three-lists matrix.** For each gain category (occupancy, lighting, equipment) in `_calculateState2`:
- **Integrand list:** every variable that contributes to the State 2 demand integral
- **Aggregate list:** every key written to State 2's result object (`gains_at_setpoint`, annual breakdown, per-category totals)
- **Display list:** every key iterated by the display layer — `SummaryView.jsx`, `HeatBalanceView.jsx`, `LoadShapeView.jsx`, `MonthlyView.jsx`, the always-visible `InternalGainsStrip`

Build the matrix as a markdown table in `32_static_audit_FINDINGS.md` under a new "Internal Gains Static" section. Identify mismatches: any term in (a) but not in (b)/(c) is a hidden integrand term; any term in (b)/(c) but not in (a) is a display ghost.

1.2 **Multi-profile audit.** Lighting and equipment use `params.gains.{category}.profiles[]` with per-profile `area_share` and `schedule`. Confirm:
- The engine aggregates profiles by area-share-weighted sum (not unweighted sum, not average)
- `area_share` values across profiles sum to ≤ 1.0 — areas above 1.0 should be flagged in UI but allowed in engine (or vice versa — document whichever is the case)
- A profile with `area_share = 0` contributes zero (not a fraction of the total)
- The schedule's `exceptions[]` array overrides the main schedule for named date ranges (does not add to it)

For each, document expected behaviour and observed behaviour. Mismatches are findings.

1.3 **Sanity check — 100% schedule hand calc.** Set Bridgewater's lighting profile to schedule = 1.0 at all hours (8760 h × 1.0). Read the area, density (W/m²), and expected annual energy:
- Annual lighting energy = density × area × 8760 hours
- Convert to MWh

The engine's reported annual lighting gain should match this hand calc to within ~1% (allowing for area_share rounding). If it doesn't, that is a Severity 2 finding — investigate which term is missing or extra.

Repeat for occupancy (set schedule = 1.0, hand-calc = density × area × hours × heat-per-person × 8760), and for equipment.

This sanity check is a falsifiability test of the engine, not a calibration target.

1.4 **Scope contamination check.** Walk the data flow into `_calculateState2`. Does it read any input that belongs to Systems (HVAC, mechanical ventilation, lighting controls, system efficiency) or Operation (operable openings, manual envelope operation)? Per CLAUDE.md "Module scopes" Operation/Systems stubs, Internal Gains should compute:
- People sensible + latent gains
- Lighting gains (heat input to zone — NOT electrical end-use accounting; that's Systems)
- Equipment gains (heat input to zone — NOT electrical end-use accounting; that's Systems)

Anything outside that list is contamination. Document with location.

1.5 **Sensible/latent split.** People gains have sensible and latent components. Confirm:
- The integrand uses sensible (T_zone-affecting) gain for the heat balance
- The display shows sensible + latent appropriately (whichever is correct for the displayed metric)
- These two paths don't disagree silently

If the integrand uses total but the display shows sensible only (or vice versa), that's a finding.

1.6 **State 1 → State 2 delta.** The summary view's headline diagnostic compares envelope-only (State 1) heating demand against envelope+gains (State 2). Confirm:
- Both numbers come from the same Static engine
- Both use the same comfort band
- The delta is computed as `state1 - state2` (positive = gains helped heating)

If state1 and state2 are calculated via different code paths with different assumptions, the delta is meaningless and that's a structural finding.

1.7 **Document findings.** In `32_static_audit_FINDINGS.md`, under "Internal Gains Static":
- Heat balance statement (one paragraph)
- Three-lists matrix
- Multi-profile findings
- Sanity-check hand calc vs engine output, per gain
- Scope contamination findings (or "none found")
- Sensible/latent split findings
- State 1 → State 2 delta findings
- New issues appended to `29_open_issues.md`, numbered continuing from current max, each with severity (1–3) and root-cause hypothesis

1.8 **Commit.**

**Commit message:**
```
Brief 36 Part 1: Internal Gains Static audit

Three-lists method applied to State 2 Static engine. Findings in
docs/audit/32_static_audit_FINDINGS.md "Internal Gains Static" section.
Sanity check: 100%-schedule hand calc reproduced to within ~1% across
occupancy, lighting, equipment.

New issues (if any) appended to docs/audit/29_open_issues.md.
Closes Brief 32 Part 6 (Internal Gains scope) within Brief 36.
```

STATUS.md update in the same commit.

---

### Part 2 — Colour discipline

**Goal:** Unify the Internal Gains colour palette to three shades of purple matching the Sankey, replacing the current mixed purple/yellow/orange section headers.

**Files touched:**
- `frontend/src/components/modules/gains/gainColours.js` — update `GAIN_COLOURS`
- `frontend/src/components/modules/gains/InternalGainsModule.jsx` — confirm `GAIN_COLOURS` is used everywhere (no hardcoded colours)
- Any other gains-related component that hardcodes a colour value (grep for `#EA580C`, `purple`, `yellow`, `orange` within `frontend/src/components/modules/gains/`)
- Sankey rendering for State 2 — confirm purple shades match

**Steps:**

2.1 Identify the three purple shades used by the Sankey for People / Lighting / Equipment. Document them.

2.2 Update `GAIN_COLOURS` in `gainColours.js`:
- `occupancy`: deepest purple (matches Sankey People)
- `lighting`: medium purple (matches Sankey Lighting)
- `equipment`: lightest purple (matches Sankey Equipment)

The module's structural accent (`GAINS_ACCENT = '#EA580C'`) stays as-is — that's the module identity colour, not a gain colour, and only appears in module title bar / tab strip underline / sidebar active indicator.

2.3 Grep for any hardcoded colour references in the gains components and replace with `GAIN_COLOURS[...]` lookups. The section headers (`CollapsibleSection`'s `accent` prop) already use `GAIN_COLOURS` per the code — confirm this works.

2.4 Visual verification (Claude Code performs via inspection of the rendered JSX; full browser verification deferred to Chris's walkthrough):
- Left-panel Occupancy/Lighting/Equipment section headers are three shades of purple
- Sankey People/Lighting/Equipment flow colours match the section headers
- Stacked bar People/Lighting/Equipment match
- Monthly view People/Lighting/Equipment match
- LoadShapeView (Profiles) People/Lighting/Equipment match

2.5 **Commit.**

**Commit message:**
```
Brief 36 Part 2: Internal Gains colour discipline

Section headers unified to three shades of purple matching Sankey.
Module structural accent (#EA580C) preserved for title bar / tab
underline / sidebar active indicator. No hardcoded colours remain in
gains components.
```

STATUS.md update in the same commit.

---

### Part 3 — Shared pop-out schedule editor

**Goal:** Build a shared draggable schedule editor component. Replace the centre-canvas editor in Internal Gains and the stuck editor in Systems. Exception periods support added to the shared component (Systems currently lacks this).

This is the biggest piece of work in the brief — probably half a day to a day of Claude Code time. Per Chris's authorisation, keep ploughing unless a "When to escalate" condition fires.

**Files touched:**
- `frontend/src/components/shared/SchedulePopout.jsx` (new) — the shared component
- `frontend/src/components/shared/SchedulePopout.css` (new — or inline Tailwind, whichever matches project style)
- `frontend/src/components/modules/gains/canvas/ScheduleEditorCanvas.jsx` — refactor to use `SchedulePopout`
- `frontend/src/components/modules/gains/InternalGainsModule.jsx` — update to open `SchedulePopout` instead of rendering centre-canvas editor
- `frontend/src/components/modules/systems/*.jsx` — wherever the Systems schedule editor lives, refactor to use `SchedulePopout` (Claude Code identifies the file by grep)
- `frontend/src/context/ProjectContext.jsx` — if exception periods aren't in the Systems data model yet, add the schema

**Steps:**

3.1 **Component design.** `SchedulePopout` is a draggable, dockable modal. Properties:
- Opens via prop `isOpen` and prop `onClose`
- Has a header bar (title + close button + drag handle — entire header bar is the drag handle)
- User can drag it anywhere on the screen by the header
- Position persists across opens (localStorage)
- Body content is the existing schedule editor markup (weekday/Sat/Sun tabs, drag bars, monthly multipliers, exception periods, statistics)
- A "Reset position" link in the header restores it to centre-screen
- Backdrop is transparent (does not block clicks on the main window — user can edit schedules and click main-window controls without closing the editor)
- Can be resized via a bottom-right resize handle (optional but useful — at minimum, fixed size that doesn't block the main view)

3.2 **Real-time reactivity.** The pop-out's onChange handler writes to `ProjectContext` immediately on every drag/click. The main window's KPI strip, Sankey, and other views update reactively (already wired via `useMemo([params, ...])` per Brief 33 Finding 1's confirmed wiring). No "Apply" button — every edit is live.

3.3 **Exception periods.** The current centre-canvas Internal Gains editor supports exception periods (named date-range overrides). The Systems editor does not. Lift exception period UI into `SchedulePopout` so both consumers get it. If Systems' data model doesn't have an `exceptions[]` array on schedules yet, add it (default empty array, no migration needed for existing data — fall through gracefully when the array is missing).

3.4 **Refactor Internal Gains.** Replace `ScheduleEditorCanvas` rendering in the "Schedule: {gain}" tab with: a button "Open schedule editor →" which opens `SchedulePopout` with the current section's schedule. When closed, the tab still shows the Schedule label and a small static preview of the schedule. The pop-out is the only place to edit; the centre canvas becomes a preview when the pop-out is closed.

Alternative if cleaner: drop the "Schedule: {gain}" tab entirely. The pop-out opens via "Edit schedule →" links in the left-panel sections (already exist). The tab strip drops from 5 tabs to 4. This may be cleaner — Claude Code's call which pattern is less disruptive to the existing UX.

3.5 **Refactor Systems schedule editor.** Identify the current editor location, replace with `SchedulePopout`. Confirm the new pop-out is movable (the "stuck" complaint Chris flagged is resolved). Confirm the Systems energy numbers update reactively as schedules are edited.

3.6 **Visual + behaviour verification (Claude Code via inspection, Chris's walkthrough confirms):**
- Pop-out opens and is movable
- Pop-out persists position across opens
- Main window stays interactive while pop-out is open
- KPI strip and Sankey update as schedule is edited
- Exception periods work in both Internal Gains and Systems
- "Reset position" works
- Close button works
- No regression in existing schedule editor behaviour (weekday/Sat/Sun, monthly multipliers, presets, copy weekday → weekend, etc.)

3.7 **Commit.**

**Commit message:**
```
Brief 36 Part 3: Shared pop-out schedule editor

New SchedulePopout component — draggable, persistent position, non-
blocking backdrop. Replaces centre-canvas editor in Internal Gains and
stuck editor in Systems. Exception periods support lifted into shared
component (Systems editor gained this feature).

Real-time reactivity: every edit writes to ProjectContext immediately;
main window KPIs/Sankey/views update without explicit "Apply".
```

STATUS.md update in the same commit.

---

### Part 4 — Audit close, STATUS, push

**Goal:** Close out Brief 36 cleanly. Move Brief 36 from `active/` to `archive/`. Confirm push.

**Files touched:**
- `docs/briefs/active/36_internal_gains_audit_polish.md` → `docs/briefs/archive/36_internal_gains_audit_polish_COMPLETED.md`
- `docs/briefs/current.md` — clear "active" pointer
- `STATUS.md` — final close-out

**Steps:**

4.1 Rename + move Brief 36 to archive.

4.2 Update `docs/briefs/current.md` to indicate no active brief (between briefs).

4.3 Final STATUS.md update: Brief 36 closed, summary of what landed, any new issues from Part 1 audit logged in `29_open_issues.md`, next-brief sequencing notes.

4.4 Single push. Confirm origin/main HEAD matches local HEAD.

**Commit message:**
```
Brief 36 close: Internal Gains audited and polished, shared pop-out
schedule editor live.

Part 1 audit: findings in docs/audit/32_static_audit_FINDINGS.md.
Part 2 colours: three-shade purple palette unified.
Part 3 pop-out: shared component live in Internal Gains and Systems,
exception periods working in both.

Next: Operation module audit (Brief 37, future) or Dynamic rebuild
(Brief 30 resumption).
```

---

## Final report (paste in chat after Part 4)

1. New origin/main HEAD SHA
2. Summary of Part 1 audit findings: how many new issues logged, severities, headline (e.g. "100% lighting hand calc reproduced to within 0.4% — no integrand-vs-display mismatch found" or "Found one S2 issue — equipment latent split inconsistent between integrand and display")
3. Confirmation of Part 2 colour unification (three purple shades confirmed across Sankey / sections / stacked / monthly / profiles)
4. Part 3 pop-out:
   - Internal Gains: opens, drags, persists position, reactive
   - Systems: stuck editor replaced, exception periods now present, reactive
   - Any regression observed in existing schedule editor behaviour
5. Path to `32_static_audit_FINDINGS.md`
6. Confirmation that `docs/briefs/active/` contains zero files after this brief closes

---

## What MUST NOT happen in this brief

- No code changes to `sql_parser.py`, `epjson_assembler.py`, or simulation API endpoints (Dynamic remains paused)
- No reintroduction of Dynamic engine surfaces in Internal Gains UI
- No calibration of the engine to a target value
- No invention of physical mechanisms to explain unexpected numbers from the hand-calc sanity check
- No partial-commit pattern — each Part is one commit including its STATUS.md update
- No skipping the audit on the grounds of "Internal Gains looks fine" — the audit's job is to test that assumption with the three-lists method, not confirm it

## When to escalate

Pause and escalate to Chris ONLY if:

- Part 1's hand-calc sanity check fails by more than ~10% on any gain category (suggests structural integrand issue, not a small one)
- Part 1 finds more than 5 Severity 2+ issues in Internal Gains (suggests the module needs a Brief 30-style rebuild, not a polish)
- Part 3's pop-out work uncovers a state management issue that requires refactoring outside the `gains/` and `systems/` directories
- The Systems module's current schedule editor location cannot be identified by grep (need Chris to point at the file)
- Documentation hygiene starts slipping (per CLAUDE.md Process Rule 7)
- At any point a non-Internal-Gains, non-shared-pop-out concept appears in the brief's scope

Otherwise, keep ploughing through. Final report at the end of Part 4.

## Standing by for authorisation to begin Part 1.
