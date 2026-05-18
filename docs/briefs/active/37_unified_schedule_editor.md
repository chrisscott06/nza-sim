# Brief 37 — Unified Schedule Editor

> **Repo front matter (Brief 37 Part 1 commit 2026-05-18):**
> **Status:** ACTIVE — chat-form authorisation 2026-05-18 by Chris. Brief file folded into Part 1's commit per the Brief 32 / 33 pattern.
> **Progress:** Part 1 in flight (this commit).

---

**Author:** Claude Code (executor) drafting from chat-form spec; Chris Scott (architect) co-designed in chat exchange 2026-05-18.
**Authorised by:** Chris Scott (chat-form, same exchange).
**Status:** Active.
**Date opened:** 2026-05-18.
**Target outcome:** One shared schedule-editor component used by Internal Gains, Operation, Systems. Side-by-side layout (bars + monthly dials on the left; annual heatmap + stats on the right; exceptions panel along the bottom). Themed via a single `accent` prop driven by module / sub-section / service. Schema unified so `gains/`-style and `profiles/`-style schedules become one flat shape with `exceptions[]` everywhere.

---

## BEFORE DOING ANYTHING

1. Read this entire brief.
2. Read CLAUDE.md, particularly Process Rules 7–11 and the Module scopes section.
3. Read STATUS.md as currently on disk; confirm last entry is Brief 36 close (`66fb0e6`).
4. Confirm working tree clean: `git status --short` (the 11 pre-existing untracked files stay untracked).
5. Confirm `origin/main == local main`: `git fetch origin && git log origin/main..main && git log main..origin/main` both return empty.
6. Do not begin Part 1 until all five checks pass.

---

## Scope statement

This brief touches the Internal Gains module (per CLAUDE.md "Module scopes" stub), the Operation module (per the same stub), the Systems module (per the same stub), the shared schedule library, and the global colour token table in `frontend/src/data/balanceColours.js`. No physics changes anywhere.

Per CLAUDE.md Module scopes: schedules are an **input shape** — they are read by both the State 2 engine (Internal Gains) and the State 3 engine (Systems) and the upcoming State 2.5 work (Operation). The editor itself is a UI component, not a physics component. Refactoring the editor and unifying the schedule shape do not move physics across module boundaries.

Dynamic remains paused per Brief 32. `sql_parser.py`, `epjson_assembler.py`, simulation API endpoints — untouched.

---

## Operational mode

Ploughing through Parts 1, 2, and 3 without per-Part sign-off pauses. Authorisation is granted up-front for all three.

**Sign-off PAUSE before Part 4** so Chris can walk through the live unified editor in all three consumers (Internal Gains × 3 sections; Operation; Systems × N services) before legacy code is deleted.

This overrides any default brief discipline that would otherwise request authorisation between Parts 1–3.

---

## Principles

1. **No physics changes.** Same gain math, same flow correlations, same engine paths. The editor is UI; the schedule it edits is engine input.
2. **No reintroduction of paused / reverted concepts.** No `balanced_mechanical`, no mech-extract reads in Internal Gains, no Dynamic engine surfaces.
3. **Single accent prop drives the editor's chrome end-to-end** — pop-out header, day-type active tab, bar fill, monthly-knob dot, Save button, statistics-card accent line. No per-piece overrides.
4. **Schema migration is one-shot + idempotent + non-breaking.** Reader gains a `schedule.weekday ?? schedule.day_types?.weekday` fallback so partially-migrated state during transition doesn't crash anything.
5. **No dead code at the end.** Once Part 4 closes, the legacy editors are deleted, not commented out. The methodology doc reference (if any) is updated to point at the unified component.
6. **Documentation hygiene is part of the commit, not after it.** Per CLAUDE.md Process Rule 7. Each Part's STATUS.md and (where relevant) audit-doc updates land in the same commit as the code changes.

---

## Parts

### Part 1 — Colour token sweep

**Goal:** Land the colour changes that the unified editor will theme from. Standalone — no editor work in this Part; no schema work; no engine work. Purely the colour-token table + sweep for hardcoded service-colour values that need to flip to the new tokens.

**Decided palette (from chat, 2026-05-18):**

| Surface | Old hex | New hex | Tailwind |
|---|---|---|---|
| Operation module-wide accent | `#0E7490` cyan-700 | `#0F766E` | teal-700 |
| Systems heating | `#DC2626` | `#DC2626` (unchanged) | red-600 |
| Systems cooling (Systems daily-stacks + heat-balance) | mixed `#3B82F6` / `#00AEEF` | `#00AEEF` (unified) | (custom; matches global `COOLING_COLOUR`) |
| Systems DHW | `#F97316` orange-500 | `#EC4899` | pink-500 |
| Systems ventilation (fans) | `#06B6D4` cyan-500 | `#14B8A6` | teal-500 |
| Systems lighting (electricity end-use) | `#F59E0B` (unchanged) | `#F59E0B` (unchanged) | amber-500 |
| Systems small power | `#8B5CF6` (unchanged) | `#8B5CF6` (unchanged) | violet-500 |
| Internal Gains palette | unchanged from Brief 36 Part 2 | unchanged | three purples |

Note: Operation's permanent-vents daily-stack today uses sky-500 `#0EA5E9` (from Brief 32 Part 2 colour discipline). With Operation's module accent flipping to teal-700, those sit side-by-side as teal + sky. Readable; no change requested but flagged for walkthrough.

**Files touched:**
- `frontend/src/data/balanceColours.js` — add canonical `SYSTEMS_SERVICE_COLOURS` table with the new values; keep the existing `INTERNAL_COLOURS`, `FABRIC_COLOURS`, `HEATING_COLOUR`, `COOLING_COLOUR` exports.
- `frontend/src/components/modules/OperationModule.jsx` — `const ACCENT = '#0E7490'` → `'#0F766E'`. Sweep for any other hardcoded `#0E7490` in the file.
- `frontend/src/components/modules/SystemsModule.jsx` — service-colour table in the daily-stack arrays (lines ~804–809) updated: cooling `#3B82F6` → `#00AEEF`, DHW `#F97316` → `#EC4899`, fans `#06B6D4` → `#14B8A6`. Refer to `SYSTEMS_SERVICE_COLOURS` rather than hardcoding where practical.
- Any other file that hardcodes `#F97316` as the DHW token, `#06B6D4` as the ventilation/fans token, or `#3B82F6` as a cooling token (grep + replace). Preserve genuine independent uses of those values (e.g. amber-500 in non-DHW contexts; sky-500 in non-cooling contexts).
- STATUS.md (this file at session level) — Brief 37 Part 1 entry.
- This file: `docs/briefs/active/37_unified_schedule_editor.md` itself lands in this commit (the file-into-repo step folded in per the chat-form authorisation pattern).

**Verification:**
- Grep returns zero matches for `#F97316` as a DHW token (`grep -n "#F97316" frontend/src` and inspect — any remaining match is non-DHW and documented).
- Grep returns zero matches for the cyan-700 `#0E7490` in OperationModule.jsx.
- Grep returns zero matches for `#06B6D4` as a ventilation/fans token.
- Build clean.
- Browser-verify (Chris, walkthrough): Operation header bar reads dark teal; Systems daily-stack DHW reads pink; Systems daily-stack fan power reads teal-500.

**Commit message:**
```
Brief 37 Part 1: Colour token sweep (Operation teal, Systems DHW pink, etc.)

Operation module accent flips from cyan-700 #0E7490 to teal-700
#0F766E ("dark teal" per Chris's spec). Systems service-colour
table updated: cooling unifies to #00AEEF (was mixed #3B82F6 in
daily-stacks vs #00AEEF in COOLING_COLOUR); DHW flips from
#F97316 orange to #EC4899 pink-500; ventilation (fans) flips from
#06B6D4 cyan-500 to #14B8A6 teal-500 to clear the conflict with
Systems module identity cyan.

No editor work in this commit — that's Part 2. No schema work — Part 3.

Brief 37 itself lands in this commit (chat-form authorisation;
brief file folded into Part 1 per the Brief 32 / 33 pattern).
```

STATUS.md update in same commit.

---

### Part 2 — Build `UnifiedScheduleEditor`

**Goal:** New shared component that subsumes both `gains/ScheduleEditor.jsx` (live writes + exceptions + bar-style monthly) and `profiles/ScheduleEditor.jsx` (library writes + dial-knob monthly + side-by-side heatmap). Layout matches the cleaner Operation/Systems side-by-side pattern; exception periods supported in all consumers; theming via a single `accent` prop.

**Files touched (new):**
- `frontend/src/components/shared/UnifiedScheduleEditor.jsx` (new) — the assembled component.
- `frontend/src/components/shared/scheduleEditor/BarEditor.jsx` (new) — the 24-bar daily-curve editor (Weekday / Sat / Sun tabs).
- `frontend/src/components/shared/scheduleEditor/MonthlyDials.jsx` (new) — the 12-dial monthly-multiplier control.
- `frontend/src/components/shared/scheduleEditor/AnnualHeatmap.jsx` (new — moved from `gains/canvas/AnnualHeatmap.jsx`).
- `frontend/src/components/shared/scheduleEditor/QuickSetToolbar.jsx` (new) — Flat 0/0.5/1 presets, Invert, Shift, Baseload, Copy Wk→Wk.
- `frontend/src/components/shared/scheduleEditor/Statistics.jsx` (new) — Peak / Average / Annual operating hours card.
- `frontend/src/components/shared/scheduleEditor/ExceptionsPanel.jsx` (new — moved from `gains/canvas/ExceptionsPanel.jsx`).

**Existing files NOT modified in this Part:** consumers (Internal Gains, Operation, Systems) keep using their existing editors — the new `UnifiedScheduleEditor` lives in isolation until Part 3 wires it up. This keeps Part 2 self-contained and verifiable.

**Component API:**
```javascript
<UnifiedScheduleEditor
  schedule={schedule}              // { weekday[24], saturday[24], sunday[24], monthly_multipliers[12], exceptions[] }
  onChange={(next) => …}           // called on every edit (live mode) or on Save (library mode)
  accent="#0F766E"                 // single theme colour for ALL chrome
  mode="live"                      // 'live' (Internal Gains) | 'library' (Systems)
  enableExceptions={true}          // show the ExceptionsPanel along the bottom
  libraryMeta={                    // only when mode='library' — name / type / zone + Save / Cancel
    { name, schedule_type, zone_type, onSave, onCancel }
  }
  contextLabel="Occupancy"         // e.g. "Occupancy", "Heating", "Cooling — Bedroom Zone"
/>
```

**Layout:**

```
┌───────────────────────────────────────────────────────────────────┐
│ NAME    │ SCHEDULE TYPE │ ZONE TYPE         (library mode only)    │
├──────────────────────────────┬────────────────────────────────────┤
│  [Weekday | Sat | Sun]       │  ANNUAL PATTERN (Live Preview)     │
│  24-bar daily editor         │  J F M A M J J A S O N D × 00-23   │
│                              │  Heatmap gradient (low→high)        │
│  QUICK SET                   │                                     │
│  [Flat 0.5 Apply] [Copy Wk→Wk] │  STATISTICS                      │
│  [Invert] [Shift ‹ ›]        │   Peak / Average / Annual op hours  │
│                              │                                     │
│  MONTHLY MULTIPLIERS         │                                     │
│  12 dial knobs (J–D)         │                                     │
├──────────────────────────────┴────────────────────────────────────┤
│ EXCEPTION PERIODS  (enableExceptions=true)              [+ Add ▾] │
│  • Public holidays  …  [edit] [delete]                            │
├───────────────────────────────────────────────────────────────────┤
│                              [Cancel]   [Save to Library]          │ ← library mode
└───────────────────────────────────────────────────────────────────┘
```

**Steps:**

2.1 Move `gains/canvas/AnnualHeatmap.jsx` → `shared/scheduleEditor/AnnualHeatmap.jsx`. Replace the existing hardcoded purple default with an `accent` prop; the heatmap gradient seeds from `accent` low→high. The legacy in-place file stays only if other consumers (`OccupancySection`'s mini-profile preview, `LightingSection`'s, `EquipmentSection`'s) still need it — grep first. If only the editor consumes it, full move.

2.2 Move `gains/canvas/ExceptionsPanel.jsx` → `shared/scheduleEditor/ExceptionsPanel.jsx`. No code changes — the panel already operates on `parentSchedule.exceptions` with an `onChange(nextExceptions)` write. Path update only.

2.3 Author `BarEditor.jsx`: the 24-bar daily-curve editor. Lifted from `gains/ScheduleEditor.jsx`'s bar-grid logic (drag-to-paint, click-to-set). Themed via `accent` (bar fill).

2.4 Author `MonthlyDials.jsx`: the 12-dial monthly-multiplier control. Lifted from `profiles/ScheduleEditor.jsx`'s dial knobs. Themed via `accent` (dial dot fill).

2.5 Author `QuickSetToolbar.jsx`: Flat 0 / Flat 0.5 / Flat 1 / Invert / Shift ‹ / Shift › / Baseload [n] Apply / × [n] Apply / Copy Weekday → Weekend. Single horizontal toolbar above the bar editor.

2.6 Author `Statistics.jsx`: Peak fraction / Average fraction / Annual operating hours. Lifted from `gains/canvas/ScheduleEditorCanvas.jsx`'s `useScheduleStats` hook.

2.7 Assemble `UnifiedScheduleEditor.jsx`: left column (BarEditor + QuickSetToolbar + MonthlyDials), right column (AnnualHeatmap + Statistics), bottom row (ExceptionsPanel when `enableExceptions`), library-meta header row when `mode='library'`, save/cancel footer when `mode='library'`.

2.8 Build clean. No consumer wired yet — the component renders only if you import it. Add a placeholder test render under a dev-only route or just confirm by isolated import + visual sanity in dev mode (Chris's walkthrough will be the live verification when Part 3 wires it).

**Verification:**
- Build clean, zero errors.
- New files at the listed paths.
- No consumer file modified in this Part.
- `UnifiedScheduleEditor` props match the documented API.

**Commit message:**
```
Brief 37 Part 2: UnifiedScheduleEditor (component build, isolated)

New frontend/src/components/shared/UnifiedScheduleEditor.jsx
assembled from extracted sub-components: BarEditor, MonthlyDials,
AnnualHeatmap (moved from gains/canvas/), QuickSetToolbar,
Statistics, ExceptionsPanel (moved from gains/canvas/).

Layout: bars + monthly dials on the left; annual heatmap + stats
on the right; exceptions panel along the bottom; library-meta
row + Save/Cancel footer when mode='library'.

Single accent prop drives all chrome — header bar (via parent
SchedulePopout), day-type active tab, bar fill, monthly-knob
dot, heatmap gradient, Save button, statistics-card accent line.

Component lives in isolation — no consumer wired yet (Part 3
does that). Existing gains/ScheduleEditor + profiles/ScheduleEditor
still serve their consumers unchanged.
```

STATUS.md update in same commit.

---

### Part 3 — Refactor + schema migration

**Goal:** Wire all three consumers (Internal Gains × 3 sections; Operation × N schedules; Systems × N services) to `UnifiedScheduleEditor`. Unify the persisted schedule schema so the engine and the new editor both consume the same flat shape.

**Files touched:**
- `frontend/src/components/modules/gains/InternalGainsModule.jsx` — replace `ScheduleEditorCanvas` (inside the `SchedulePopout` body) with `UnifiedScheduleEditor`. Pass `mode='live'`, `accent=GAIN_COLOURS[activeSection]`, `enableExceptions=true`, `contextLabel=GAIN_LABELS[activeSection]`.
- `frontend/src/components/modules/SystemsModule.jsx` — replace the `<ScheduleEditor>` inside the `SchedulePopout` body with `UnifiedScheduleEditor`. Pass `mode='library'`, `accent` derived from the service the schedule is being edited for (heating → red; cooling → cyan-bright; DHW → pink; ventilation → teal-500; lighting → amber; small power → violet), `enableExceptions=true`, `libraryMeta` carrying name/type/zone/save/cancel.
- `frontend/src/components/modules/OperationModule.jsx` (or wherever its schedule editor is hosted — grep + identify) — replace with `UnifiedScheduleEditor`. Pass `mode='live'` (operable openings + occupancy presence schedules write to project, not library), `accent='#0F766E'`, `enableExceptions=true`, `contextLabel` per the operable opening / behaviour being edited.
- `frontend/src/utils/instantCalc.js` `_calculateState2` (line ~2024 `const sched = occ.schedule ?? {}` and the `findActiveException` calls + `lightingFractionForHour` / `equipmentFractionForHour`): add a one-line fallback `sched.weekday ?? sched.day_types?.weekday` so the reader tolerates both old and new shapes during transition. Reader-side defensive change only; engine math unchanged.
- `frontend/src/utils/scheduleLibrary.js` (or wherever the schedules-library schema is defined) — schedule object gains an `exceptions: []` default. If `day_types: {…}` exists as a legacy field, the schedule's flat `weekday/saturday/sunday` fields shadow it. New schedules written by the unified editor write the flat shape only.
- `scripts/37_schedule_schema_migration.py` (new) — for each persisted project's schedules library + project-local schedules: detect legacy `day_types: {…}` shape; rewrite to top-level flat shape; ensure `exceptions: []` present. Idempotent: re-running is a no-op. Per CLAUDE.md Process Rule 11: dev server must be stopped before running.
- `STATUS.md` — Brief 37 Part 3 entry.

**Steps:**

3.1 Grep for the Operation module's schedule-editor host. Likely under `frontend/src/components/modules/operation/` or as part of `OperationModule.jsx` itself. Identify; document in this brief if not as expected. (Escalate per "When to escalate" if it can't be found by grep.)

3.2 Wire Internal Gains to `UnifiedScheduleEditor`. The `resolveScheduleSection` helper added in Brief 36 Part 3 already produces the right shape; the new editor consumes it directly. Drop the `ScheduleEditorCanvas` import.

3.3 Wire Operation to `UnifiedScheduleEditor`. Schedules edited in Operation include operable-opening control schedules + per-section behaviour schedules; these are all flat-shape today (`weekday/saturday/sunday`). Confirm during the wiring step.

3.4 Wire Systems to `UnifiedScheduleEditor` with `mode='library'`. The existing `editingSchedule` state in `SystemsModule.jsx` still drives open/close; the new editor receives `editingSchedule` adapted to the flat shape, and on Save writes back via the existing schedules-library save path. Resolve the service-colour from the schedule's `schedule_type` field (e.g. `heating` → red).

3.5 Schema migration: author `scripts/37_schedule_schema_migration.py`. Read each project's `building_config.schedules` (or wherever the library is stored). Detect legacy `day_types: {weekday, saturday, sunday}` shape. Rewrite to flat `weekday, saturday, sunday` at the same level. Ensure `exceptions: []` is present (empty default). Idempotent. Run it once per CLAUDE.md Process Rule 11 (dev server stopped first).

3.6 Add the reader fallback in `_calculateState2` so partially-migrated state during transition doesn't crash. One line: `sched.weekday ?? sched.day_types?.weekday`. Same pattern for saturday/sunday.

3.7 Build clean. Browser walkthrough deferred to the Part 4 pause point.

**Verification:**
- Build clean, zero errors.
- All three consumers route their schedule edits through `UnifiedScheduleEditor`.
- `_calculateState2` reader tolerates both schedule shapes.
- Migration script runs cleanly and re-runs as NO-OP.
- Bridgewater's `state2.gains.{people, lighting, equipment}` numbers unchanged from Brief 36 Part 1's audit baseline (no physics changes; the engine reads the same numbers via the unified shape).

**Commit message:**
```
Brief 37 Part 3: Wire consumers + unify schedule schema

Internal Gains, Operation, Systems all route schedule edits through
the new UnifiedScheduleEditor. Legacy gains/canvas/ScheduleEditorCanvas
+ profiles/ScheduleEditor still exist on disk (deleted in Part 4
after Chris's walkthrough).

Schedule schema unified: legacy day_types: {weekday, saturday,
sunday} flattened to top-level weekday/saturday/sunday across the
schedules library. Reader gains a one-line shape fallback so
transition state doesn't crash. Engine math unchanged; Bridgewater
gain numbers unchanged.

Migration: scripts/37_schedule_schema_migration.py, idempotent, ran
clean. Dev server stopped per CLAUDE.md Process Rule 11.
```

STATUS.md update in same commit.

---

### PAUSE — sign-off before Part 4

After Part 3 lands, **STOP**. Chris walks through the live unified editor in all three consumers:
- Internal Gains: open each section (Occupancy / Lighting / Equipment); pop-out opens with the right accent (purples); bar edits + monthly dials + heatmap all update reactively; exceptions panel works.
- Operation: each behaviour schedule opens in the pop-out with teal-700 accent; same behaviour.
- Systems: each service schedule opens in the pop-out with the per-service accent (heating red, cooling cyan-bright, DHW pink, ventilation teal-500, lighting amber, small power violet); library-meta row + Save/Cancel work.

Chris reports findings. Adjustments (if any) land as small standalone commits per the "diagnosis-before-fix" discipline established by Brief 33 Findings 1/2.

Only after Chris's confirmation: Part 4 deletes the legacy editors.

---

### Part 4 — Delete legacy editors + close-out

**Goal:** Remove the legacy schedule editors now that nothing imports them. Close Brief 37.

**Files touched:**
- `frontend/src/components/modules/gains/ScheduleEditor.jsx` — DELETE.
- `frontend/src/components/modules/gains/canvas/ScheduleEditorCanvas.jsx` — DELETE.
- `frontend/src/components/modules/profiles/ScheduleEditor.jsx` — DELETE.
- `frontend/src/components/modules/gains/canvas/AnnualHeatmap.jsx` + `ExceptionsPanel.jsx` — DELETE if Part 2 moved them; otherwise verify no remaining imports and delete.
- `docs/briefs/active/37_unified_schedule_editor.md` → `docs/briefs/archive/37_unified_schedule_editor_COMPLETED.md`.
- `docs/briefs/current.md` — clear "Active" pointer.
- `STATUS.md` — final close-out entry.

**Verification:**
- `git ls-files | grep -E "ScheduleEditor.jsx" | wc -l` returns only the `shared/scheduleEditor/` entries (one component + its sub-components).
- Build clean.
- Brief archived.

**Commit message:**
```
Brief 37 Part 4 close: Delete legacy schedule editors

Removed gains/ScheduleEditor.jsx, gains/canvas/ScheduleEditorCanvas.jsx,
profiles/ScheduleEditor.jsx now that all consumers route through
UnifiedScheduleEditor. AnnualHeatmap + ExceptionsPanel live under
shared/scheduleEditor/ as Part 2 moves.

Brief 37 archived. Schedule editor is unified across Internal Gains,
Operation, Systems with consistent theming, schema, and exception-
period support.
```

---

## Final report (paste in chat after Part 4)

1. New origin/main HEAD SHA.
2. Confirmation of the four accent values live on the three modules + Systems services (Operation teal-700, Systems DHW pink-500, Systems ventilation teal-500, Systems cooling cyan-bright unified).
3. Confirmation that `UnifiedScheduleEditor` opens with the right accent in:
   - Internal Gains × 3 sections (occupancy / lighting / equipment)
   - Operation × all schedule sites
   - Systems × all services (heating / cooling / DHW / ventilation / lighting / small power)
4. Confirmation that exception periods work in all three consumers (write → save → reload preserves them).
5. Confirmation that Bridgewater's `state2.gains.{people, lighting, equipment}` numbers are unchanged from Brief 36 Part 1's audit baseline (no physics shift).
6. Confirmation that `git ls-files | grep -E "ScheduleEditor.jsx" | grep -v "shared/scheduleEditor"` returns empty (legacy editors deleted).
7. Path to any new audit findings if the unification surfaces any (none expected — this is UI work).

---

## What MUST NOT happen in this brief

- No physics changes. No gain integrand changes. No engine math changes.
- No reintroduction of `balanced_mechanical`, `mech_extract`, Dynamic-engine surfaces in any module's UI.
- No partial-commit pattern within a Part — each Part is one commit including STATUS.md.
- No deletion of legacy editors before Part 4 (they keep working through Parts 1–3; deleted only after Chris's walkthrough).
- No expansion of the Internal Gains issues #14 / #15 fixes into this brief — those are separate work.

---

## When to escalate

Pause and escalate ONLY if:

- Part 3's schema migration touches `>5` persisted projects in unexpected ways (e.g. a schedule already in the flat shape gets rewritten incorrectly) — indicates a migration logic bug, not a small fix.
- Part 3's reader fallback breaks engine math on Bridgewater (gain numbers shift from the Brief 36 Part 1 baseline) — indicates the schedule shape didn't fully unify.
- The Operation module's schedule-editor host cannot be identified by grep (need Chris to point at the file).
- A per-service accent surfaces a regression in Systems' Heat Balance / Sankey readability (e.g. teal-500 ventilation visually merges with another bar).
- Any consumer's exception-period writes break round-trip on save/reload.

Otherwise, plough through Parts 1, 2, 3. Pause before Part 4. Final report at the end of Part 4.

---

## Status

Part 1 in flight (this commit). Brief file folded into Part 1 per chat-form authorisation.
