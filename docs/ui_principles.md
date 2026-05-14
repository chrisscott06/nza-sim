# NZA-Sim UI Principles

**Status:** Canonical layout rules for module construction. Every brief from Brief 27 onwards must conform. Existing modules brought into conformance opportunistically.

**Owner:** Chris.

**Scope:** This document covers layout, density, and visual grouping. It does NOT cover colour palette, typography, or component-level styling — those will be addressed in a tool-wide UI design pass after the core module work is done.

---

## Purpose

NZA-Sim modules are built one at a time, often by different briefs with different focuses. Without shared layout discipline, the result is horizontal sprawl, inconsistent density, and visual incoherence across modules. This document captures a small set of layout rules to prevent that drift.

These rules are tactical, not strategic. They aren't a design system. They're constraints that keep individual modules from accumulating chaos before a proper system pass.

---

## The five principles

### 1. Card width matches content, not container

A card that holds a single 30-character value should not span 800 pixels. Cards have a natural size based on their content; the layout's job is to position them sensibly, not to stretch them.

**Bad:** A single "Annual mean: 18.3°C" stat displayed in a card spanning the full centre canvas width. Eye travel to read one number.

**Good:** A single stat displayed inline with the content it relates to, or as part of a multi-stat card.

**Implementation:** Cards default to `width: max-content` or a sensible fixed width based on content type. Use flex/grid containers with `justify-content: start` or `space-between` rather than `space-around` for spreading.

### 2. Related items live in the same card

Three related stats (annual mean, winter min, summer max) are one concept. They go in one card with vertical internal layout. Three separate cards at three corners of the screen forces the eye to travel and breaks the cognitive grouping.

**Bad:**
```
[Annual mean: 18.3°C]              [Winter min: 1.8°C]              [Summer max: 41.7°C]
```

**Good:**
```
┌── Free-running temperature ──┐
│  Annual mean:    18.3°C      │
│  Winter min:      1.8°C      │
│  Summer max:     41.7°C      │
└──────────────────────────────┘
```

Apply the same rule to input groups, output summaries, and any conceptually-related collection of items.

### 3. Centre canvas has a maximum readable width

Aim for ~900–1000px maximum width for the centre canvas content, centred, with breathing margins on either side at wider viewports. Going wider produces fatigue and breaks scanning patterns.

**Exception:** Genuinely horizontal content (Sankey diagrams, comfort bars showing year subdivisions, time-series charts spanning a year) can use the full width. Width is meaningful for these — it carries data.

**Rule of thumb:** if a content block doesn't get more useful at 1400px than at 900px, constrain it to 900–1000px.

### 4. Section bounding boxes group inputs visually

Inputs that belong to the same concept should sit inside a single bounded card. This is already the pattern in the Building module's left panel (GEOMETRY, GLAZING, SHADING, FABRIC, AIRTIGHTNESS — each is its own bounded section). Continue that pattern in all modules.

**Implementation:**
- Section bounding boxes have consistent border, padding, and corner radius
- Section headers are visually clear (background colour, sentence-case or ALL CAPS consistently)
- Collapsible sections preserve the bounding box visually even when collapsed
- Inputs inside a section use consistent label-right or label-above alignment
- Inputs inside a section use consistent spacing

### 5. Vertical stacking is the default

When in doubt, stack vertically. Horizontal layouts are for genuinely-parallel content (comparing two things side by side, distributing a single quantity across categories) or where horizontal carries data (time on the x-axis of a chart, weeks of a year, hours of a day).

Two pieces of information that aren't directly comparable should not be placed left/right at opposite ends of the screen. They should be stacked or grouped into a single card.

### 6. Density baseline — working tool, not marketing page

NZA-Sim's surfaces are working tools. They should read as such: information-dense, compact, scannable. They should NOT read as marketing landing pages with oversized hero text, generous whitespace, and pacing-for-effect section gaps.

**Concrete baseline:**
- Body text default: `text-xxs` / `text-caption` (not `text-base` / `text-lg`)
- Section headings: `text-section` or smaller; reserve `text-base` / `text-h2` / `text-h3` for top-of-page headers
- Padding inside cards: `p-2` / `p-3` (not `p-4` / `p-6`)
- Gap between sections: `space-y-3` / `space-y-4` / `space-y-5` (not `space-y-8` / `space-y-12`)
- Buttons: compact; `px-2 py-0.5` / `px-2.5 py-1` typical; pill buttons rare
- Numbers: `tabular-nums` always (so column-aligned readout panels scan cleanly)

**Rule of thumb:** if a surface needs scrolling to read content that should fit at-a-glance, density is too low. If text feels cramped or unreadable at default zoom, density is too high. Calibrate to the consultant doing real work, not a first-time visitor scanning a homepage.

This principle was added 2026-05-14 after the Brief 28a Part 4 component-harness walkthrough surfaced sprawl in `/chart-test`. The principle existed implicitly in the existing modules (Internal Gains, Building) but wasn't documented.

---

## Common patterns and their canonical treatment

### A list of stats (n=2 to n=6)

Vertical stack inside a single card. Use a consistent label-value alignment (label left, value right, with column-aligned values for scanability).

```
┌── Card name ──────────────────┐
│  Label one:      value one    │
│  Label two:      value two    │
│  Label three:    value three  │
└───────────────────────────────┘
```

### A pair of comparable values (e.g., heating vs cooling demand)

Single card with both values inside, either stacked vertically or with a clear horizontal pairing. Don't put them at opposite ends of the screen.

```
┌── Demand vs comfort band ─────────────────┐
│  Heating:  207 MWh  (below 21°C)          │
│  Cooling:   47 MWh  (above 25°C)          │
└────────────────────────────────────────────┘
```

### A multi-tab view (3D Model / Heat Balance / Free-running / etc.)

Tab strip at the top, centred. Tab content uses the centre canvas's maximum readable width. Switching tabs should not require horizontal scrolling.

### A flow visualisation (Sankey, time-series, etc.)

Use full available width. These earn their horizontal space because width carries data.

**Height, however, is bounded.** A chart should NEVER flex-fill viewport height. The Y-axis range carries less meaning than the X-axis range, so unbounded vertical growth produces wasted whitespace and forces page scrolling.

- Default chart height: **280–360 px** for full-width time-series; **280–320 px** for square-ish category charts (e.g. a 12-month bar chart).
- Aspect ratio: time-series ~16:9 (wide); category charts (≤ 30 points) closer to 4:3 or square. The data determines it, not the container.
- Charts rendered inside a Pablo `ChartContainer` set height via the `height` prop (number, in px). Avoid `h-full` / `flex-1` on chart wrappers.

### A chart paired with a stat panel (Pablo Load Inspector pattern)

Time-series or category charts often appear alongside read-at-a-glance summary numbers. The canonical composition mirrors Pablo's Load Inspector:

```
┌── header: zoom controls, period buttons, unit toggle ─────────┐
├──────────────────────────────────────────────┬────────────────┤
│                                              │  Stat 1        │
│                                              │  Stat 2        │
│            CHART AREA  (~2/3 width)          │  Stat 3        │
│                                              │  Stat 4        │
│                                              │                │
├──────────────────────────────────────────────┴────────────────┤
│  [All] [Jan] [Feb] [Mar] ... [Dec]   (MonthJumpButtons)        │
└────────────────────────────────────────────────────────────────┘
```

Rules:
- **Chart on the left, stats on the right.** The chart is the main visual surface; stats are scanning metadata. Left-bias matches reading order (eye lands on chart first, then scans the stats column).
- **Stats column is narrower** (~1/3 of the layout, or fixed ~180–220 px). DataCards stacked vertically; not arranged in a grid.
- **Zoom + period controls go above** the chart, spanning the full layout width. Aligned to the left edge of the chart so the chart "owns" the column it sits in.
- **MonthJumpButtons (if present) go below** the chart, also spanning full width. They drive the chart's date window; placing them below keeps the eye flow chart → month-jump → chart-updates.
- **No vertical fill.** Chart height bounded per the previous pattern. Stats panel can be shorter than the chart; whitespace at the bottom of the stats column is fine.

This pattern lands in Brief 28a Part 5 (Internal Gains Conditions tab) and is mirrored in 3e (Building Conditions tab) with Building-specific data lenses.

### Mini-profiles and inline indicators

For schedule shapes, gain profiles, or other small visualisations that summarise a complex quantity, render inline (within text flow or card layout) at small size. Don't create dedicated cards for these — they're modifiers to other content.

### Engine toggle (Live | Simulation)

Place near the data it controls, not as a global toggle. A single segmented control inline with the view title is appropriate.

### Comfort band editor

Inline with the demand display. Editable numeric inputs (lower / upper) with clear labels. Updates trigger live recompute.

---

## What this document does NOT specify

Out of scope for these principles (will be covered by the tool-wide UI design pass later):

- Colour palette and semantic colour usage
- Typography choices and scale
- Spacing scale (specific px values for padding, margins, gaps)
- Component-level styling (button shape, input field appearance)
- Animation and interaction patterns
- Iconography
- Responsive breakpoints

These will be defined when the tool's modules are mature enough to inform proper system design.

---

## How briefs apply this document

Every brief that builds or modifies module UI must:

1. Reference this document in the brief's preamble
2. Confirm each new view or layout follows the five principles
3. Flag in close-out report any deviations and why

Module completion checklist (see `docs/module_completion_checklist.md`) explicitly verifies conformance.

---

## Versioning

This is v1.0. Updates happen when patterns emerge during module work that need new rules. Updates are committed in isolation, before any brief that depends on the change.
