# Brief 45 — Interventions + Systems UX polish

**Author:** Claude Chat (architect)
**Authorised by:** Chris Scott
**Status:** Active. Multi-Part UX polish brief.
**Date opened:** 2026-05-21
**Target outcome:** The Interventions module and the Systems module's left panel are properly usable for real consultancy work. Interventions sit in the main view with a draggable editor pop-out. Stack rows are legible. Sankey ribbons surface their calculation chain on hover. Simple EUI waterfall in the Comparison tab. Share % editable inline in Systems left panel without opening pop-outs. Visual split indicator for multi-system services.

After this brief lands: Chris can build a 3-intervention stack on Bridgewater, see clean marginal/cumulative deltas (separated by metric), hover any Sankey ribbon to inspect the calculation, see a waterfall chart of the cumulative impact, and edit heating shares in the left panel summary rows without disrupting flow.

---

## BEFORE DOING ANYTHING

0. **Session-start reconciliation pass.** Per Process Rule 8: `ls docs/briefs/active/`, `cat docs/briefs/current.md`, `tail STATUS.md`, `git log --oneline -20`. Brief 44 archived at `7c4c59a`. `active/` should be empty (Brief 30 paused in archive). If anything stale, first commit is cleanup.
1. Read this entire brief.
2. Read CLAUDE.md end to end. Particularly Module Scopes Interventions + Systems sections, and Process Rules 7 + 8.
3. Read the Notion design note: **NZA-Sim — Interventions UX feedback + Brief 43 scope** (https://www.notion.so/366d645e05cc818b8653d51bdf8b4342). Issues 1–8 are this brief's full scope. Issues already shipped under Brief 43 (structural ops, wider field coverage, summary enrichment, service-level patches) are out — don't re-do.
4. Read the existing UI: `frontend/src/components/modules/interventions/InterventionsModule.jsx`, `InterventionRow.jsx`, `InterventionEditorPopout.jsx`, `ComparisonView.jsx`, plus `frontend/src/components/modules/systems/SystemsModule.jsx`, `SystemSummaryRow.jsx`, `ServiceSectionHeader.jsx`. Skim `SankeyTab.jsx` to understand the ribbon structure for the hover work.
5. Confirm working tree clean: `git status --short`.
6. Confirm `origin/main == local main`.
7. **Part 1's first commit must include this brief file landed at `docs/briefs/active/45_ux_polish.md`** per Process Rule 7.
8. Do not begin Part 1 until checks 0–7 pass.

---

## Scope statement

This brief is **UI polish on a stable foundation**. No engine changes. No data model changes. No new physics. The patches model from Brief 41, the schema from Brief 42, the visualisation foundation from Brief 44 are all unchanged. What changes is layout, legibility, and inline editing affordances.

Per CLAUDE.md Module Scopes pattern, no module scope changes.

Four substantive Parts plus close.

---

## Operational mode — plough through

Authorisation up-front. No per-Part sign-off. Walkthrough sign-off after Part 3 before Part 4 close. Stop and escalate only for the conditions in "When to escalate" below. Final report at end of Part 4.

---

## Principles

1. **No engine changes.** If polish work surfaces an engine bug, log it (Issue #24 / Brief 47 candidates) and continue.
2. **No data model changes.** Patch shape, intervention shape, systems_config_v40 shape all unchanged.
3. **Reuse pop-out pattern.** Brief 37 SchedulePopout / Brief 41 InterventionEditorPopout / Brief 42 SystemEditorPopout — all established. New affordances follow the same shape.
4. **Reuse existing engine output.** Sankey hover, waterfall — both read from `consumption.brief40.*` and `consumption.interventions.*` that already exist. No new computation.
5. **Falsifiability for visual changes.** Each polish item has a concrete acceptance criterion ("share editable inline with single click" vs vague "feels better").
6. **Browser verification mandatory** at Part 4 walkthrough.
7. **Documentation hygiene per Process Rule 7.** Each Part's commit includes STATUS.md + audit-doc update. Brief file in `active/` as Part 1's first commit.

---

## Parts

### Part 1 — Interventions module layout fix + sidebar reposition + icons + popover positioning

**Goal:** Open Interventions → stack visible in main canvas (not full-screen pop-out covering everything). Editor opens as draggable pop-out beside the stack. Sidebar entry sits with other primary modules. Replace/remove icons clarified. Replace popover opens beside the system, not over it.

**Files touched:**
- `frontend/src/components/modules/interventions/InterventionsModule.jsx` — layout
- `frontend/src/components/modules/interventions/InterventionEditorPopout.jsx` — already-draggable pattern preserved; default position adjusted if needed
- `frontend/src/components/modules/interventions/StructuralOpMenu.jsx` (or wherever the Replace popover lives) — positioning fix
- Sidebar component — reorder
- `docs/audit/45_ux_polish.md` (new) — append findings
- `docs/briefs/active/45_ux_polish.md` — this brief
- `docs/briefs/current.md` — pointer

**Steps:**

1.1 **Brief on disk first.** Land brief file as Part 1's first commit before any code change. Per Process Rule 7.

1.2 **Layout fix.** Interventions stack renders in the main canvas at full width. Editor pop-out opens as draggable overlay, default position right-half, NOT full-screen. Stack remains visible and updates as patches are captured. Existing `nza-intervention-editor-popout-position` localStorage key preserved.

1.3 **Sidebar reposition.** Move Interventions entry from current position up alongside Building / Internal Gains / Operation / Systems. It's now a first-class consultancy module, not a side tab. Exact slot: Claude Code's call based on existing sidebar ordering; recommend immediately after Systems.

1.4 **Replace/remove icon clarification.** In `SystemSummaryRow` and any equivalent in the intervention editor:
- **Delete/remove → bin icon** (lucide `Trash2`)
- **Replace → arrows-swap icon** (lucide `ArrowLeftRight` or `Replace`)
- Tooltips: "Remove this system" / "Replace this system"

1.5 **Replace popover positioning.** When the user clicks Replace on a system, the `StructuralOpMenu` popover currently opens over the system card, obscuring it. Reposition to open **beside** the card (right side preferred, falls back to left if no space, falls back to below if no horizontal space). Use a positioning library if already in tree (Floating UI / Popper) or compute manually.

1.6 **Audit doc.** Document layout shape, sidebar slot chosen, icon mapping, popover positioning approach.

**Commit:**
```
Brief 45 Part 1: Interventions layout + sidebar + icons + popover

- Interventions stack now in main canvas; editor pop-out draggable
  beside (not full-screen). Stack visible during editing.
- Sidebar reposition: Interventions sits alongside other primary
  modules between Systems and Results.
- Icon clarification: bin for remove, swap-arrows for replace.
- Replace popover opens beside system card, not over it.

No data or engine changes. Brief 45 folded into docs/briefs/active/.
```

---

### Part 2 — Stack row + comparison legibility fix

**Goal:** The stack rows show kWh/m² and kgCO₂ as separate, properly labelled columns. Numbers don't run into each other. New empty interventions don't show carried-over cumulative deltas. Duplicate intervention button works.

**Files touched:**
- `frontend/src/components/modules/interventions/InterventionRow.jsx`
- `frontend/src/components/modules/interventions/InterventionStackView.jsx` — column headers + layout
- `frontend/src/components/modules/interventions/ComparisonView.jsx` — minor consistency tweaks
- `docs/audit/45_ux_polish.md` — append

**Steps:**

2.1 **Marginal + Cumulative column split.** Replace the broken "−63.1 kWh/m² (−52%)−63.1 kWh/m² (−52%)" rendering with proper columns:

| LABEL | MARGINAL ΔEUI | MARGINAL ΔCO₂ | CUMULATIVE ΔEUI | CUMULATIVE ΔCO₂ | edit |

Each delta as a single number with unit, colour-coded (green negative = saving, red positive = increase, grey zero). Percentages in parentheses under the value if helpful, or in tooltip.

2.2 **Empty-intervention treatment.** If `intervention.patches.length === 0` (or all patches are no-ops), show "—" in all four delta columns. Don't show carried-over cumulative from the row above. Visually muted (opacity-50 on the row except the label).

2.3 **Duplicate intervention button.** Add a duplicate icon button next to the edit pencil. On click:
- Deep-clones the intervention's patches
- Generates new UUIDs (intervention id + patch ids)
- Appends label `<original> (copy)`
- Inserts the duplicate immediately below the source in the stack
- Engine reruns naturally as the stack array updates

2.4 **Comparison view alignment.** Ensure the KPI strip in the Comparison tab uses the same column convention as the stack view. EUI delta, carbon delta as separate clearly-labelled cells.

2.5 **Audit doc append.** Document column shape, empty-row treatment, duplicate behaviour.

**Commit:**
```
Brief 45 Part 2: Stack legibility + duplicate intervention

- Marginal/Cumulative split into separate ΔEUI + ΔCO₂ columns.
  No more concatenated unit-less strings.
- Empty interventions show "—" not carried-over cumulative.
- Duplicate intervention button: deep-clones patches, generates
  new UUIDs, inserts below source.
- Comparison view KPI strip aligned to same convention.
```

---

### Part 3 — Sankey hover tooltip + simple EUI waterfall + inline share editing + visual split indicator

**Goal:** Sankey ribbons surface the demand → efficiency → fuel calculation chain on hover. Comparison tab has a waterfall chart showing baseline → after each intervention. Systems left panel lets the user drag share % inline without opening pop-out. Each service section shows a visual split bar across its systems.

**Files touched:**
- `frontend/src/components/modules/systems/SankeyTab.jsx` — hover tooltip
- `frontend/src/components/modules/interventions/ComparisonView.jsx` — waterfall chart
- `frontend/src/components/modules/interventions/EUIWaterfall.jsx` (new)
- `frontend/src/components/modules/systems/SystemSummaryRow.jsx` — inline share slider
- `frontend/src/components/modules/systems/ServiceSectionHeader.jsx` — split indicator
- `frontend/src/components/modules/systems/ServiceSplitBar.jsx` (new) — shared split indicator component
- `docs/audit/45_ux_polish.md` — append

**Steps:**

3.1 **Sankey hover tooltip.** Each ribbon shows a tooltip on hover:
- For demand→system ribbons: "Service X demand: Y MWh"
- For system→fuel ribbons: "System X delivered Y MWh ÷ SCOP/η Z → W MWh fuel"
- Multi-system services: list per-system breakdown ("Heating: 95% VRF @ SCOP 2.8 + 5% Electric panel @ COP 1.0")

Read from existing `consumption.brief40.{service}.systems[]` — no new calculation. Use the Sankey library's built-in tooltip if available; otherwise a thin custom layer.

3.2 **EUI waterfall chart.** New component `EUIWaterfall.jsx` in the Comparison tab. Shows:
- Bar 0 — Baseline EUI (e.g. 122.2 kWh/m²)
- Bar 1 — After Intervention 1 (with delta floating label)
- Bar 2 — After Intervention 1+2 (with delta label)
- Bar N — Final cumulative

Each bar shows the running total height. Floating delta labels between bars show marginal contribution per intervention. Disabled interventions render as muted/grey bars showing "skipped".

Data source: `consumption.interventions[]` — each entry already has `result.eui_kwh_per_m2` and the marginal/cumulative deltas. Reuse Brief 41 Part 2 output.

3.3 **Inline share editing in SystemSummaryRow.** Add a small share slider or numeric input directly in the summary row. Editable without opening pop-out. Drag updates `params.systems_config_v40.{service}[id=...].share_pct` immediately. Live engine recompute via the same `useMemo` chain.

Share validation fires inline: if sum across enabled systems ≠ 100, the section header shows the warning badge + Normalise button (already-existing Brief 40 Part 5b pattern). Brief 45 doesn't change validation logic, just surfaces the editor inline.

3.4 **Visual split indicator.** New `ServiceSplitBar.jsx` component used in each `ServiceSectionHeader`. Horizontal bar showing each system's share as a coloured segment:
- One segment per system, width = share_pct
- Segment colour = system's display colour (or service colour with system index variation)
- Disabled systems shown as striped / muted
- Hover on segment → tooltip with system label + share %
- Single-system case (most common today) → full-width single colour, still visible for consistency

Works for any service with 1-N systems. Renders in the section header alongside the validation badge.

3.5 **Audit doc append.** Document Sankey hover data source, waterfall chart structure, inline share affordance, split bar logic.

**Commit:**
```
Brief 45 Part 3: Sankey hover + waterfall + inline share + split bar

- Sankey ribbons surface calculation chain on hover: demand →
  system breakdown (per-system efficiency) → fuel consumed. Reads
  existing consumption.brief40.{service}.systems[]. No new calc.
- EUIWaterfall.jsx in Comparison tab: baseline → after each
  intervention bar chart with marginal-delta labels between bars.
- SystemSummaryRow gains inline share slider — drag share % without
  opening pop-out. Edit pencil still opens full editor for other
  fields. Validation/Normalise behaviour unchanged.
- ServiceSplitBar.jsx in each ServiceSectionHeader visualises the
  share split across systems at a glance. Disabled systems muted.

No engine or data model changes.
```

---

### Part 4 — Walkthrough + close

**Goal:** Chris's walkthrough confirms Brief 45 lands. Brief 45 archived. STATUS.md final.

**Files touched:**
- `docs/audit/45_ux_polish.md` — append "Part 4 walkthrough"
- `docs/briefs/active/45_ux_polish.md` → `docs/briefs/archive/45_ux_polish_COMPLETED.md`
- `docs/briefs/current.md` — pointer
- STATUS.md — close-out

**Walkthrough checklist Chris runs (12 items):**

1. Sidebar: Interventions entry sits with primary modules (between Systems and Results).
2. Open Interventions. Stack visible full-canvas. No full-screen pop-out.
3. Add intervention. Editor opens as draggable pop-out beside stack. Drag it around; close + reopen; position persists.
4. While editing, the stack rows in the background update as patches are captured.
5. Stack row layout: separate columns for Marginal ΔEUI, Marginal ΔCO₂, Cumulative ΔEUI, Cumulative ΔCO₂. Numbers don't collide.
6. Add a second empty intervention. Row shows "—" in all delta columns. No carried-over cumulative.
7. Click duplicate on an existing intervention with patches. Copy appears below with `(copy)` suffix, identical patches, new UUIDs. Marginal computes correctly.
8. Within intervention editor, click Replace on a system. Popover opens **beside** the card, not over it.
9. Remove a system → bin icon. Replace → swap-arrows icon. Tooltips clarify.
10. Open Systems module. Service section headers show the new split bar (Heating shows ~95%/5% split between VRF and Electric panel).
11. Drag the share slider in a SystemSummaryRow from 95 to 70. Engine recomputes; Sankey + Live Results update; share validation badge fires if total ≠ 100; Normalise button works.
12. Open Comparison tab in Interventions. Waterfall chart shows baseline → after each enabled intervention with marginal-delta labels between bars. Hover on any Sankey ribbon → tooltip shows calculation chain.

Pass → Part 4 close. Fail → log to 29_open_issues, diagnose, fix in follow-up commit, re-verify.

**Final report fields:**

1. New origin/main HEAD SHA
2. Layout fix confirmed: stack in main view, pop-out draggable beside
3. Sidebar slot chosen
4. Stack legibility: column shape + empty-row treatment + duplicate button verified
5. Sankey hover tooltip: confirmed reading from `consumption.brief40.*`, no new calculation
6. EUI waterfall: rendered on Bridgewater 3-intervention stack with specific numbers
7. Inline share editing: confirmed share drag works without pop-out
8. Visual split indicator: confirmed on multi-system services
9. Any new issues logged
10. Bridgewater 3-intervention stack EUI numbers (baseline + after each intervention + final cumulative) — must match the engine values from Brief 44 close (no engine changes)
11. CLAUDE.md unchanged (no scope drift)
12. `docs/briefs/active/` empty

**Commit:**
```
Brief 45 close: Interventions + Systems UX polish live

Layout fixed (stack in main view), sidebar repositioned, icons
clarified, popover positioning fixed, stack legibility restored
(separate ΔEUI/ΔCO₂ columns, empty rows show "—", duplicate works),
Sankey hover tooltips surface per-ribbon calculation, EUI waterfall
chart in Comparison tab, inline share editing in Systems
SystemSummaryRow, visual split indicator on service headers.

No engine or data model changes. Bridgewater intervention deltas
unchanged from Brief 44 close (verified).

Foundation now properly usable for real consultancy work.
```

---

## What MUST NOT happen in Brief 45

- No engine changes
- No data model changes
- No new physics
- No interventions architecture changes (Brief 41/42/43 closed)
- No visualisation foundation changes beyond what's documented here (Brief 44 closed)
- No new modules
- No partial commits — each Part is one commit including STATUS.md + audit-doc updates
- No skipping browser verification at Part 4
- No expanding scope to absorb new issues — log to `29_open_issues.md` for Brief 47 housekeeping

---

## When to escalate

Pause only if:
- Sidebar reorder breaks any existing route or navigation
- Inline share slider introduces an engine recompute loop / infinite re-render
- Sankey hover library doesn't support per-ribbon tooltips and a custom layer is non-trivial
- EUI waterfall reveals a discrepancy with stack-view marginal numbers (would mean Brief 44 verification missed something — surface immediately)
- Walkthrough item fails in a way that suggests deeper architectural issue
- Documentation hygiene slips

Otherwise plough through. Final report at end of Part 4.

---

## Notes for Claude Code

Pattern matches Briefs 36, 39, 40, 41, 42, 43, 44:

- Read everything before starting (BEFORE-DOING-ANYTHING checklist mandatory)
- Each Part one commit, audit doc + STATUS.md in same commit
- Browser verification mandatory at Part 4
- This is pure UI polish — engine and data model are read-only references for this brief
- If polish work surfaces a real engine bug, log it (Issue #24 / Brief 47 candidates) and continue without fixing here

Standing by for authorisation to begin Part 1.
