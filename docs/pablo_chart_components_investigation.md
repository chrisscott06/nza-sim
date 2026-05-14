# Pablo chart components investigation

**Status:** Investigation report, not implementation. Brief 28 will decide
which components to port and what shape the work takes.

**Pablo repo inspected:** https://github.com/chrisscott06/pablo-2
**Inspection date:** 2026-05-13
**Reporter:** Brief 28 prep, per Chris's directive.

---

## Headline findings

1. **All six requested components live in `pablo-2/frontend/src/components/ui/`**
   (the Pablo equivalent of nza-sim's `components/ui/`). They're collectively
   referenced from `src/components/ui/index.js` (Pablo's UI barrel). This
   is a deliberate, well-organised set of design-system primitives.

2. **Shared colour palette already aligns.** Pablo uses Tailwind 3.x with
   `tailwind.config.js` exposing `navy / teal / magenta / coral / gold /
   nza-green` etc. NZA-Sim uses Tailwind 4.0's CSS-first approach and
   already exposes the same colours via `--color-navy`, `--color-teal`,
   `--color-magenta`, `--color-coral` in `index.css`. The Tailwind utility
   classes the components reference (`text-teal`, `bg-navy`, `border-l-teal`)
   work identically across both setups.

3. **Recharts version gap.** Pablo runs Recharts 3.8.0; nza-sim runs
   Recharts 2.13.0. The components themselves don't import Recharts —
   `chartTokens.js` exports style objects passed to Recharts at call
   sites. So a port doesn't force a Recharts upgrade, BUT users of
   `TICK_STYLE` / `TOOLTIP_STYLE` etc. in nza-sim should be sanity-checked
   against Recharts 2.13.0's props (likely identical; both versions
   accept the same style-object shapes).

4. **Most components are clean lifts.** TabBar (15 lines), DataCard (33),
   chartTokens.js (74), MonthJumpButtons (97), ZoomNav (70) have zero or
   one shallow dependency. **ChartContainer (46 lines) is the exception** —
   it depends on ChartPrintModal which pulls in `html2canvas` + `jspdf`
   for image / SVG / PDF export. Porting ChartContainer means either
   accepting those dependencies (~250 KB minified) or extracting a
   pared-down version without the print modal.

5. **Composition pattern is independent.** Pablo's LoadInspector + Load
   Shaper compose these primitives in straightforward parent JSX with
   useState-managed zoom/start-day state. No state-management library
   required. Each parent owns its `zoomDays`, `startDay`, `selectedMonth`
   state and passes setters to the controls.

---

## Component-by-component

### 1. ChartContainer

**Path:** `pablo-2/frontend/src/components/ui/ChartContainer.jsx`
**Line count:** 46

**Purpose:** Standard chart card with white background, light-grey border,
compact title row, and a hover-revealed print icon that opens an export
modal (PNG / SVG / PDF / clipboard / browser-print).

**External dependencies:**
- npm: `react`, `lucide-react` (Printer icon)
- Pablo internal: `../shared/ChartPrintModal`
- Tailwind classes: `bg-white`, `rounded-lg`, `border`, `border-light-grey`,
  `text-xxs`, `font-medium`, `text-navy`, `uppercase`, `tracking-wide`,
  `text-mid-grey`, `hover:text-navy`, `hover:bg-off-white`, plus the standard
  print-modal classes inside ChartPrintModal

**Pablo-specific assumptions:**
- `border-light-grey` + `text-mid-grey` + `bg-off-white` are Pablo Tailwind
  utilities (not standard Tailwind). NZA-Sim has the exact same custom
  classes (visible in `frontend/src/index.css`). No mapping work needed.
- The print icon uses a `group / group-hover:opacity-100` pattern. Both
  apps run Tailwind ≥ 3.2 so this is fine.

**Coupling:**
- Direct dep chain: ChartContainer → ChartPrintModal → html2canvas + jspdf
- ChartPrintModal is 290 lines, dynamic-imports `html2canvas` (already a
  Pablo dep), uses `jspdf` (also a Pablo dep). Both libraries are heavy
  (~150 KB + ~100 KB minified).
- **Lift options:**
  - **Clean lift with deps:** add `html2canvas` + `jspdf` to nza-sim's
    `package.json`, port ChartPrintModal alongside ChartContainer.
    Cost: ~250 KB on the bundle. Benefit: full export parity with Pablo.
  - **Stripped lift:** copy ChartContainer minus the print button.
    `showPrint` state + ChartPrintModal removed. ~30 lines. Zero new
    dependencies. Loses export functionality — users would have to
    screenshot for now. Could be added later by re-introducing the modal.
  - **Hybrid:** lift ChartContainer with the print button rendered
    behind a feature flag (`enablePrint` prop, default false). Defer
    the modal lift to a later brief.

**Recommendation:** Stripped lift first (zero risk), reintroduce
ChartPrintModal in a follow-up when export demand materialises.

---

### 2. ZoomNav

**Path:** `pablo-2/frontend/src/components/ui/ZoomNav.jsx`
**Line count:** 70

**Purpose:** Period zoom + date scrubbing control. Renders:
`[1d] [7d] [14d] [30d]  ◄  dateRangeLabel  ►   {rightContent slot}`

(Note: the request mentioned "1 Day / 1 Week / 1 Month / Quarter / 6 Months / Year"
period labels — Pablo's default is `1d / 7d / 14d / 30d`. The component is
fully parameterised via the `options` prop; nza-sim can pass any
`{label, days}` array.)

**Props:**
- `zoomDays`, `setZoomDays` — current period + setter
- `startDay`, `setStartDay` — left edge of the window
- `totalDays` — full timeline length (clamps navigation)
- `dateRangeLabel` — caller-formatted string ("3 Jan – 9 Jan 2025")
- `options` — period-button array (defaults to the 1d/7d/14d/30d set)
- `rightContent` — slot for additional right-side controls (caller can
  drop in custom buttons; e.g. ArbitrageExplorer's "Best Day" jump)

**External dependencies:**
- npm: `react`, `lucide-react` (ChevronLeft, ChevronRight)
- Pablo internal: none
- Tailwind classes: standard + Pablo custom (`text-mid-grey`, `text-navy`,
  `bg-teal`, `border-light-grey`, `bg-off-white`) — all present in nza-sim

**Pablo-specific assumptions:**
- The active-period style uses `bg-teal` (Pablo's primary accent). NZA-Sim
  also has `bg-teal` defined. If the active style should match the
  active module's accent (orange for Internal Gains, etc.) instead, the
  component would need an `accent` prop.
- The date label is caller-formatted — fine, no locale baked in.

**Coupling:** Zero external coupling. Pure presentational component
with caller-managed state.

**Lift:** Trivial. Copy file as-is. If the active-period colour should
follow module accent, add an `accent` prop (1 extra prop, ~3 line change).

---

### 3. MonthJumpButtons

**Path:** `pablo-2/frontend/src/components/ui/MonthJumpButtons.jsx`
**Line count:** 97 (includes a `dayOffsetForMonth` helper used by callers)

**Purpose:** Season-coloured month picker — `[All] [Jan] [Feb] ... [Dec]`.
Used to skip a time-series window to a specific calendar month.

**Props:**
- `selectedMonth` — 0-indexed month or null for "All"
- `onSelect` — handler
- `showAll` — whether to render the "All" button (default true)
- `size` — 'sm' (default) or 'md'
- `disabledMonths` — array of indices to grey-out (e.g. months with no data)

**External dependencies:**
- npm: `react`
- Pablo internal: `chartTokens.js` (MONTH_LABELS, MONTH_SEASON, SEASON_COLORS)
- Tailwind classes: standard + Pablo custom (`text-navy`, `bg-light-grey`,
  `text-mid-grey`, `border-light-grey`)

**Pablo-specific assumptions:**
- Tied to chartTokens.js for month labels + season palette. If chartTokens
  ports too, this works as-is.
- The seasonal colour scheme (Winter=teal / Spring=green / Summer=gold /
  Autumn=coral) is northern-hemisphere-centric. NZA-Sim users are
  primarily UK so this aligns; if international users matter later, the
  colour map could become locale-dependent.

**Coupling:** Tight coupling to chartTokens.js (3 named exports). If
chartTokens ports as a whole, MonthJumpButtons is a clean lift. If the
caller wants to override colours, chartTokens.js's constants would need
to be parameter-able.

**Lift:** Clean if chartTokens.js comes too. ~5 lines of `import` to
adjust to nza-sim's path layout.

Also exports `dayOffsetForMonth(startDate, monthIndex)` helper used by
LoadInspector — a simple date math util, easy to keep next to the
component.

---

### 4. TabBar

**Path:** `pablo-2/frontend/src/components/ui/TabBar.jsx`
**Line count:** 15

**Purpose:** Tab strip with `tab-bar` / `tab-item` / `tab-item-active`
CSS classes.

**Props:**
- `tabs` — array of `{ id, label }`
- `active` — currently active id
- `onChange` — handler

**External dependencies:**
- npm: `react`
- Pablo internal: none in the JS file, BUT depends on three CSS classes
  defined in Pablo's `index.css`:
  ```css
  .tab-bar       { @apply flex border-b border-surface-dark gap-0.5 mb-3; }
  .tab-item      { @apply px-3 py-1.5 text-body text-text-secondary hover:text-text-primary border-b-2 border-transparent transition-colors cursor-pointer; }
  .tab-item-active { @apply text-accent border-accent font-medium; }
  ```

**Pablo-specific assumptions:**
- `text-text-secondary`, `text-text-primary`, `border-surface-dark`,
  `text-accent`, `border-accent` are Pablo-specific semantic colour
  utilities that don't exist in nza-sim's palette.
- The bottom-border underline style is a different visual pattern from
  nza-sim's existing tab strip in `InternalGainsModule.jsx`, which uses
  a 2px coloured underline below the active tab plus accent colour.

**Coupling:** Lightweight JS, but the CSS class set ties it to Pablo's
design tokens. Two options:
- Port the JS + adapt the CSS classes to nza-sim's existing palette
  (`text-mid-grey` / `text-navy` / `border-light-grey` / module accent)
- Use the existing nza-sim tab strip pattern (already shipped in the
  Internal Gains module — top-centred, accent underline) and not port
  TabBar at all.

**Recommendation:** Don't port TabBar literally. NZA-Sim's tab strip
pattern from `InternalGainsModule.jsx` is already in place and a sibling
project should keep its own visual language. **If a unified TabBar
component is wanted, abstract from the existing nza-sim usage** rather
than from Pablo's.

---

### 5. DataCard

**Path:** `pablo-2/frontend/src/components/ui/DataCard.jsx`
**Line count:** 33

**Purpose:** Compact stat card — value on top, label below, coloured
left border (3px) keyed to an `accent` prop. ~60–80px tall depending on
`size`.

**Props:**
- `label`, `value`, `unit`, `sub` — text content
- `icon` — Lucide component (optional)
- `accent` — `'teal' | 'magenta' | 'gold' | 'green' | 'red' | 'purple' | 'coral' | 'navy' | 'accent'` (default 'teal')
- `size` — `'sm' | 'md'` (default 'sm')
- `className` — passthrough

**External dependencies:**
- npm: `react` (passes lucide icons through but doesn't import them)
- Pablo internal: none
- Tailwind classes:
  - Border colour map: `border-l-teal`, `border-l-magenta`, `border-l-gold`,
    `border-l-nza-green`, `border-l-nza-red`, `border-l-nza-purple`,
    `border-l-coral`, `border-l-navy`, `border-l-accent`
  - Icon colour map: same set with `text-` prefix

**Pablo-specific assumptions:**
- The accent colour names map to Pablo's Tailwind config exactly. NZA-Sim
  has `teal`, `magenta`, `gold`, `coral`, `navy` already; `nza-green`,
  `nza-red`, `nza-purple`, `accent` would need to be added (or renamed
  to match nza-sim's tokens, or made dynamic via inline style).
- **For nza-sim's module-coloured palette** (gain colours `#8B5CF6` /
  `#F59E0B` / `#FB923C`, module accent `#EA580C`), a literal Pablo port
  doesn't cover the cases. Either:
  - Extend nza-sim's Tailwind palette to include Pablo's named accents
  - Refactor DataCard to accept a CSS-color string instead of a named
    accent (`accent="#EA580C"` instead of `accent="teal"`)

**Coupling:** Self-contained. Easy to lift.

**Recommendation:** Port with the refactor — change `accent` from a
named-lookup-keyed-string to a free-form colour string. That gives
nza-sim's module accents (orange / vermillion / etc.) first-class
support without bloating the Tailwind config. The two static maps
become one inline style.

The DataCard component used by Pablo's LoadShaper is the canonical
multi-stat row pattern that NZA-Sim's Internal Gains module currently
reinvents (see Annual breakdown view's StatCard). Consolidating on a
shared DataCard would unify the two patterns.

---

### 6. chartTokens.js

**Path:** `pablo-2/frontend/src/data/chartTokens.js`
**Line count:** 74

**Purpose:** Single source of truth for chart styling tokens. Exports
constant objects to be passed directly to Recharts components:
- `TICK_STYLE`, `LABEL_STYLE` — axis tick + label text styling
- `TOOLTIP_STYLE` — tooltip box styling
- `LEGEND_STYLE` — legend text styling
- `GRID_STYLE` — CartesianGrid stroke/dash
- `CHART_SERIES_COLORS` — 8-colour series palette (teal-first)
- `MODELLER_COLORS` — named-flow colour map (generation, batteryCharge, etc.)
- `SEASON_COLORS` — Winter / Spring / Summer / Autumn
- `MONTH_LABELS` — `['Jan', 'Feb', ..., 'Dec']`
- `MONTH_SEASON` — month-index-to-season lookup
- `BUILDING_SERVICE_COLORS` — heating / cooling / hot_water / lighting / etc.

**External dependencies:** None. Pure constant exports.

**Pablo-specific assumptions:**
- `MODELLER_COLORS` is Pablo-specific (generation, batteryCharge, etc.).
  NZA-Sim doesn't have those concepts at module level.
- `BUILDING_SERVICE_COLORS` is genuinely useful for NZA-Sim — `heating`,
  `cooling`, `lighting`, `ventilation`, `small_power` all map to NZA-Sim
  concepts. NZA-Sim's `balanceColours.js` partially overlaps but uses
  different values (lighting `#F59E0B` here vs `#F2C14E` in Pablo).
- `TICK_STYLE` font is `'Stolzl'` — Pablo's Stolzl font is also installed
  in NZA-Sim per the build output, so this is fine.

**Coupling:** Zero external. Easy lift.

**Recommendation:** Lift `TICK_STYLE` / `TOOLTIP_STYLE` / `LEGEND_STYLE` /
`LABEL_STYLE` / `GRID_STYLE` / `CHART_SERIES_COLORS` / `SEASON_COLORS` /
`MONTH_LABELS` / `MONTH_SEASON` as-is. Skip `MODELLER_COLORS` (Pablo-
specific). Reconcile `BUILDING_SERVICE_COLORS` vs nza-sim's existing
`balanceColours.js` — they cover the same conceptual ground; either
merge them into one canonical palette per the same v1.0-ui-principles
discipline that prevents drift across modules, or keep them separate
with documented "which to use where".

---

## Composition pattern (how Pablo wires these together)

The canonical reference is `pablo-2/frontend/src/pages/explorer/LoadInspector.jsx`,
specifically the "Time Series" tab around line 580-640. Pattern:

```jsx
import { TabBar, DataCard, ChartContainer, ZoomNav } from '../../components/ui'
import MonthJumpButtons, { dayOffsetForMonth } from '../../components/ui/MonthJumpButtons'

// Parent owns the state
const [zoomDays, setZoomDays] = useState(7)
const [startDay, setStartDay] = useState(0)
const [selectedMonth, setSelectedMonth] = useState(null)
const totalDays = engine.metadata.totalDays

// Derive a date-range label for the caller's locale / formatting choice
const dateRangeLabel = (() => { /* ... */ })()

return (
  <>
    {/* Optional: ZoomNav at top */}
    <ZoomNav
      zoomDays={zoomDays} setZoomDays={setZoomDays}
      startDay={startDay} setStartDay={setStartDay}
      totalDays={totalDays}
      dateRangeLabel={dateRangeLabel}
    />

    {/* Optional: MonthJumpButtons to skip the window */}
    {zoomDays < 365 && (
      <MonthJumpButtons
        selectedMonth={cursor.getMonth()}
        showAll={false}
        onSelect={(m) => {
          if (m == null) { setStartDay(0); return }
          const offset = dayOffsetForMonth(engine.metadata.startDate, m)
          setStartDay(Math.min(offset, maxStartDay))
        }}
      />
    )}

    {/* DataCard row above the chart for headline stats */}
    <div className="grid grid-cols-4 gap-3">
      <DataCard label="Peak" value="..." />
      <DataCard label="Mean" value="..." />
      ...
    </div>

    {/* ChartContainer wraps the actual Recharts chart */}
    <ChartContainer title="Time Series — 7 Day View" height="h-[480px]">
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={data}>
          <CartesianGrid {...GRID_STYLE} />
          <XAxis tick={TICK_STYLE} ... />
          <YAxis tick={TICK_STYLE} />
          <Tooltip contentStyle={TOOLTIP_STYLE} />
          <Legend wrapperStyle={LEGEND_STYLE} />
          <Area dataKey="value" />
        </AreaChart>
      </ResponsiveContainer>
    </ChartContainer>
  </>
)
```

**Data shape expected:**
- Time-series array `[{ datetime, demand, ... }]` with whatever keys the
  chart needs. No magic structure — caller-defined.
- `engine.metadata.startDate` + `engine.metadata.totalDays` for the date
  navigation math.

**State management:** Plain React `useState`. No Redux / Zustand / Jotai.
The window state (`zoomDays`, `startDay`, `selectedMonth`) lives in the
parent component; the navigation primitives are dumb controls receiving
value + setter.

---

## Summary table

| Component | LoC | npm deps | Pablo deps | Tailwind tokens needed | Lift difficulty |
|---|---:|---|---|---|---|
| `ChartContainer` | 46 | react, lucide-react | ChartPrintModal (→ html2canvas + jspdf, ~250 KB) | text-xxs, font-medium, text-navy, text-mid-grey, border-light-grey, bg-off-white | **Medium** (clean if you accept ChartPrintModal + deps; trivial if stripped) |
| `ZoomNav` | 70 | react, lucide-react | none | text-xxs, text-mid-grey, text-navy, bg-teal, border-light-grey, bg-off-white | **Trivial** — copy file as-is; consider `accent` prop for module-themed active state |
| `MonthJumpButtons` | 97 | react | `chartTokens.js` (MONTH_LABELS, MONTH_SEASON, SEASON_COLORS) | text-navy, bg-light-grey, text-mid-grey, border-light-grey | **Trivial** if chartTokens.js comes too; otherwise needs ~5 const inlines |
| `TabBar` | 15 | react | none in JS — but depends on `.tab-bar` / `.tab-item` / `.tab-item-active` CSS classes that reference Pablo-specific tokens | Pablo `text-text-primary` / `text-text-secondary` / `text-accent` / `border-surface-dark` | **Recommend NOT porting** — nza-sim's existing tab strip pattern in InternalGainsModule is preferable to lifting Pablo's |
| `DataCard` | 33 | react | none | `border-l-teal` / `border-l-magenta` / `border-l-gold` / `border-l-nza-green` / `border-l-nza-red` / `border-l-nza-purple` / `border-l-coral` / `border-l-navy` / `border-l-accent` plus `text-` equivalents | **Easy** — port + refactor `accent` to a free-form colour string (one-time API change, eliminates Tailwind config bloat) |
| `chartTokens.js` | 74 | none | none | none | **Trivial** — lift styling tokens + `BUILDING_SERVICE_COLORS` ; skip `MODELLER_COLORS` (Pablo-specific); reconcile with existing `balanceColours.js` |

---

## Bundle-size implications

If the full set ports (ChartContainer with ChartPrintModal):
- `html2canvas`: ~150 KB minified, ~45 KB gzipped
- `jspdf`: ~100 KB minified, ~30 KB gzipped
- Total: **~250 KB minified / ~75 KB gzipped** on top of the existing bundle.

If ChartContainer ports stripped (no print modal):
- **Zero new dependencies.** All other components have zero npm deps
  beyond what nza-sim already has (react, lucide-react).

---

## Recharts compatibility note

Pablo runs Recharts 3.8.0, nza-sim runs 2.13.0. The style objects in
chartTokens.js (`TICK_STYLE`, `TOOLTIP_STYLE`, etc.) are passed to props
that have been stable across versions:
- `tick={TICK_STYLE}` — props.tick on `<XAxis>` / `<YAxis>`. Stable.
- `contentStyle={TOOLTIP_STYLE}` — props.contentStyle on `<Tooltip>`. Stable.
- `wrapperStyle={LEGEND_STYLE}` — props.wrapperStyle on `<Legend>`. Stable.
- `{...GRID_STYLE}` — props on `<CartesianGrid>` (strokeDasharray, stroke).
  Stable.

No API breakage expected for the styling tokens. **The components themselves
don't import Recharts**, so the port doesn't touch the engine.

If nza-sim later wants to upgrade to Recharts 3.8.0, the migration is
orthogonal to this port; the components don't care.

---

## Recommended port plan for Brief 28

1. **chartTokens.js** — lift cleanly, drop `MODELLER_COLORS`. Reconcile
   `BUILDING_SERVICE_COLORS` with existing `balanceColours.js` — propose
   one canonical palette for both heat-balance flows and chart series.
2. **ZoomNav** — copy, add optional `accent` prop for active-period
   colour. Verify against Brief 28's intended use sites.
3. **MonthJumpButtons** — copy + `dayOffsetForMonth` helper. Comes
   "for free" once chartTokens lands.
4. **DataCard** — copy + refactor `accent` to free-form colour string.
   Consolidate the existing inline-StatCard pattern from `Annual
   breakdown` view onto this primitive.
5. **ChartContainer (stripped)** — port without ChartPrintModal. Defer
   the print/export modal until export demand is concrete.
6. **TabBar** — do NOT port. Use the existing nza-sim tab strip in the
   Internal Gains module as the canonical pattern.

**Estimated Brief 28 scope for these:**
- Add `frontend/src/data/chartTokens.js` (lift) — 15 min
- Add `frontend/src/components/ui/ZoomNav.jsx` (lift + 1 prop) — 30 min
- Add `frontend/src/components/ui/MonthJumpButtons.jsx` (lift) — 15 min
- Add `frontend/src/components/ui/DataCard.jsx` (lift + refactor) — 30 min
- Add `frontend/src/components/ui/ChartContainer.jsx` (stripped lift) — 20 min
- Migrate `balance/HeatBalance.jsx` + Internal Gains canvas views to use
  the shared primitives — 2-3 hours
- Reconcile `balanceColours.js` ↔ `BUILDING_SERVICE_COLORS` — 30 min
- Update `ui_principles.md` to point at the new shared primitives — 15 min

**Half a day for the components + a half-day migrating existing sites.**

---

## Out of scope for this report

- Implementation of any port — decision deferred to Brief 28.
- Recharts upgrade investigation (separate question).
- A proper UI library extraction for sharing across Pablo + nza-sim
  (would require a real monorepo or npm-published package).
- TabBar pattern unification — see recommendation: keep separate.

End of report.
