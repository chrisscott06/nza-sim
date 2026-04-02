# PABLO 2.0 — Design System Reference
## For companion tool development (EnergyPlus Building Simulation Platform)

---

## 1. Charting & Visualisation

### Library
**Recharts** (React wrapper for D3) — used exclusively across all modules.
- File: `package.json` → `recharts`
- Import pattern: `import { ResponsiveContainer, BarChart, Bar, AreaChart, Area, ComposedChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ReferenceLine, PieChart, Pie, Cell } from 'recharts'`

### Standard chart types in use
- **Stacked bar charts** — Monthly Energy Balance, BAU Projection, Financial Case Annual Spend
- **Stacked area charts** — Energy Flows (load profile with self-consumption, grid import, export)
- **Area charts** — Duration Curves, Battery SoC, Load Profile vs Threshold
- **Line charts** — Cumulative cashflow, BAU cost trajectory, demand overlay
- **ComposedChart** — mixed bar + line (e.g. stacked bars with BAU dashed line overlay)
- **Donut/Pie charts** — Energy Sources, Generation Destination (on Overview tabs)
- **Grouped bar charts** — Monthly peaks before/after (Capacity Reduction)

### Shared chart wrapper
**`ChartContainer`** — `frontend/src/components/ui/ChartContainer.jsx`
- White background, light-grey border, compact uppercase title
- Hover-visible print/export icon (PNG, SVG, PDF, clipboard)
- Configurable height via `height` prop (e.g. `h-72`, `h-[350px]`)
```jsx
<ChartContainer title="Monthly Energy Balance" height="h-80">
  <ResponsiveContainer width="100%" height="100%">
    <BarChart data={data}>...</BarChart>
  </ResponsiveContainer>
</ChartContainer>
```

### Chart styling tokens
**File:** `frontend/src/data/chartTokens.js`
```js
TICK_STYLE   = { fontSize: 9, fontFamily: "'Stolzl'", fill: '#95A5A6' }
TOOLTIP_STYLE = { backgroundColor: '#fff', border: '1px solid #E6E6E6', borderRadius: '4px', fontSize: '10px', fontFamily: "'Stolzl'" }
LEGEND_STYLE  = { fontSize: '9px', fontFamily: "'Stolzl'" }
GRID_STYLE    = { strokeDasharray: '3 3', stroke: '#E6E6E6' }
```

### Master chart configuration
**File:** `frontend/src/data/chartConfig.js`
- `ENERGY_COMPONENTS` — 6 cost categories with colours + labels + stacking order
- `LIFECYCLE_COMPONENTS` — CAPEX (`#1D9E75`), OPEX (`#7F8C8D`), REPEX (`#D85A30`)
- `NET_BENEFIT_COLORS` — positive teal, negative coral, cumulative blue
- `LINE_STYLES` — BAU dashed navy, cumulative blue with white dots, payback pink dashed
- `formatAxisGBP()` — £k/£M axis formatter

---

## 2. Colour System

### Primary palette (Tailwind custom colours)
**File:** `frontend/tailwind.config.js`

| Token | Hex | Usage |
|-------|-----|-------|
| `navy` | `#2B2A4C` | Sidebar bg, text primary, demand line |
| `magenta` | `#E84393` | Save buttons, payback markers, accent highlights |
| `coral` | `#F48379` | Export, negative values, warnings |
| `teal` | `#00AEEF` | Wholesale theme, Wind theme, links |
| `gold` | `#ECB01F` | Solar theme, wholesale prices |
| `off-white` | `#F8F9FA` | Page background |
| `light-grey` | `#E6E6E6` | Borders, grid lines |
| `mid-grey` | `#95A5A6` | Secondary text, labels |
| `dark-grey` | `#58595B` | Body text default |

### Module theme colours
| Module | Colour | Hex |
|--------|--------|-----|
| Solar PV | Gold | `#ECB01F` |
| Wind | Cyan | `#00AEEF` |
| Capacity Reduction | Purple | `#9B59B6` |
| Arbitrage | Purple | `#9B59B6` |
| Network Connection / ECA | Teal | `#00AEEF` |
| Wholesale Market | Teal/Light blue | `#00AEEF` |

### Energy cost categories (6 standard)
**File:** `frontend/src/data/costCategories.js`

| Category | Colour | Hex |
|----------|--------|-----|
| Retail Tariff | Blue | `#3498DB` |
| Wholesale | Gold | `#ECB01F` |
| DUoS | Pink/Magenta | `#E84393` |
| TNUoS | Purple | `#9B59B6` |
| Levies | Green | `#27AE60` |
| Other | Orange | `#E67E22` |

### Energy flow colours
**File:** `frontend/src/design-system/tokens.js`

| Element | Colour | Hex |
|---------|--------|-----|
| Grid Import | Grey | `#7F8C8D` |
| Solar self-use | Gold | `#ECB01F` |
| Wind self-use | Cyan | `#06B6D4` |
| Battery | Purple | `#9B59B6` |
| Battery discharge | Pink | `#E84393` |
| Export | Red | `#EF4444` |
| Demand line | Navy | `#2B2A4C` |

### DUoS time-of-use bands
| Band | Colour | Hex |
|------|--------|-----|
| Red | Red | `#DC2626` |
| Amber | Amber | `#F59E0B` |
| Green | Green | `#16A34A` |

### Where colours are defined
- **Tailwind config:** `frontend/tailwind.config.js` — custom colour tokens
- **Design system tokens:** `frontend/src/design-system/tokens.js` — CHART_COLORS, ENERGY_FLOW_COLORS, COST_BREAKDOWN_COLORS
- **Cost categories:** `frontend/src/data/costCategories.js` — CATEGORY_COLORS
- **Chart config:** `frontend/src/data/chartConfig.js` — ENERGY_COMPONENTS, LIFECYCLE_COMPONENTS
- **CSS variables:** `--slider-color` in `index.css` for slider theming
- NO CSS custom properties for the main colour palette (all via Tailwind classes)

---

## 3. Typography & Spacing

### Font family
**Stolzl** — custom font with 6 weights loaded via @font-face.
- Thin (100), Light (300), Book (400), Regular (450), Medium (500), Bold (700)
- Default body: weight 300 (Light), 13px
- Fallback stack: `-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif`

**File:** `frontend/src/index.css` (font-face declarations)

### Size scale (Tailwind custom)
**File:** `frontend/tailwind.config.js` → `fontSize`

| Token | Size | Line height | Usage |
|-------|------|-------------|-------|
| `text-xxs` | ~10px (0.6rem) | 0.85rem | Tiny labels, chart axis text |
| `text-xs` | ~10px (0.65rem) | 0.9rem | Micro text, compact controls |
| `text-caption` | 11px (0.6875rem) | 0.95rem | Card labels, axis labels |
| `text-table` | 12px (0.75rem) | 1rem | Table cells |
| `text-body` | 13px (0.8125rem) | 1.15rem | Base body text |
| `text-subsection` | 14px (0.875rem) | 1.2rem | Subsection headings (weight 500) |
| `text-section` | 16px (1rem) | 1.35rem | Section headings (weight 500) |
| `text-page-title` | 20px (1.25rem) | 1.6rem | Page titles (weight 500) |
| `text-metric` | 20px (1.25rem) | 1.5rem | Data card primary values (weight 500) |
| `text-metric-lg` | 24px (1.5rem) | 1.75rem | Hero metrics (weight 500) |

**Design rule:** Exactly five text sizes allowed for content (xxs, caption, body, section, page-title). Metric sizes for data displays only.

### Spacing
Standard **Tailwind defaults** — no custom spacing scale. Common patterns:
- `p-3` (12px) for card padding
- `gap-2` / `gap-3` (8px/12px) for grid gaps
- `space-y-2` / `space-y-3` for vertical stacking
- `mb-2` / `mb-3` for section spacing
- Module sidebar: `p-3` padding
- Chart container: `px-2 pb-2` internal padding

---

## 4. Layout & Navigation

### Shell structure
**Sidebar nav (left) + top bar + main content area**

```
┌──────────────────────────────────────────────────┐
│ [Project bar — project name, library pills, etc] │
│ [Global controls — Real/Nominal, VAT, Escalation]│
├──┬───────────────────────────────────────────────┤
│S │                                               │
│I │           Main content area                   │
│D │           (module page)                       │
│E │                                               │
│B │                                               │
│A │                                               │
│R │                                               │
│  │                                               │
│56│                                               │
│px│                                               │
└──┴───────────────────────────────────────────────┘
```

**Sidebar:** `w-14` (56px), dark navy background, icon-only navigation with tooltips.
**File:** `frontend/src/components/layout/Sidebar.jsx`
- Icons from `lucide-react` + custom SVG icons (`PylonIcon`, `SolarPanelIcon`, `WindTurbineIcon`, `ModellerIcon`)
- Grouped with separator dividers (data setup → exploration → analysis → library)
- Active state: lighter navy background + accent colour indicator

**Top bar:** Shows project name, active library item pills, global toggles (Real/Nominal, Ex-VAT/Inc-VAT, Escalation, Compound/Linear).

### Module page layout
**Explorer pattern** (used by all analysis modules):
**File:** `frontend/src/components/layout/ExplorerLayout.jsx`

```jsx
<ExplorerLayout sidebar={sidebarContent}>
  {/* Tab bar */}
  <TabBar tabs={TABS} active={activeTab} onChange={setActiveTab} />
  {/* Tab content */}
  {activeTab === 'overview' && <OverviewContent />}
</ExplorerLayout>
```

- Left sidebar: `w-64` (256px) or `w-72` (288px), scrollable, contains configuration controls
- Main area: `flex-1`, scrollable, contains tab bar + tab content
- Height: `h-[calc(100vh-6rem)]` — fills viewport minus top bar

### Tabbed views
**File:** `frontend/src/components/ui/TabBar.jsx`
- Horizontal tab bar with bottom border
- Active tab: accent colour underline + font-medium
- CSS: `.tab-bar` flex container, `.tab-item` individual tabs
- Each module defines its own `TABS` array: `[{ id: 'overview', label: 'Overview' }, ...]`

### Common layout patterns within tabs
- **Left/right split:** Narrow left column (data cards + tables, ~350px) + wide right column (charts)
- **Stacked charts:** Multiple ChartContainers in `space-y-3`
- **Side-by-side charts:** `grid grid-cols-2 gap-3`
- **Overlay panels:** Slide-out from left, 380-450px wide, for asset editors and library pickers

---

## 5. Component Patterns

### Component library
**Custom-built** — no external component library (no shadcn, MUI, or Ant).
All shared components in `frontend/src/components/ui/`.

### Shared UI components

| Component | File | Purpose |
|-----------|------|---------|
| `DataCard` | `DataCard.jsx` | KPI tile with coloured left border, value + label + icon |
| `ChartContainer` | `ChartContainer.jsx` | White card wrapper for charts with title + print button |
| `TabBar` | `TabBar.jsx` | Horizontal tab navigation |
| `LibraryPicker` | `LibraryPicker.jsx` | Dropdown to select library items, filtered by type |
| `SmartScaleSlider` | `SmartScaleSlider.jsx` | Non-linear slider with configurable breakpoints + colour |
| `ModuleEmptyState` | `ModuleEmptyState.jsx` | Empty state when required library items aren't assigned |
| `SaveToLibraryButton` | `SaveToLibraryButton.jsx` | Pink save button for library items |
| `ExplorerLayout` | `layout/ExplorerLayout.jsx` | Sidebar + main area shell for explorer modules |
| `ErrorBoundary` | `ErrorBoundary.jsx` | React error boundary with fallback UI |
| `Toggle` | `Toggle.jsx` | Small toggle switch |

### DataCard pattern
```jsx
<DataCard
  icon={Zap} label="Annual Savings" value="£14,732"
  unit="/yr" accent="green" size="md"
/>
```
- Coloured left border (3px) matching accent
- Value in navy font-medium, unit in lighter smaller text
- Label in grey uppercase xxs text below
- Accent options: teal, magenta, gold, green, red, purple, coral, navy

### Input patterns
- **Number inputs:** `<input type="number" className="w-20 text-right text-xs px-2 py-1.5 border border-light-grey rounded bg-white text-navy" />`
- **SmartScaleSlider:** Non-linear slider with breakpoints for capacity/power inputs. Colour prop matches module theme. Fill track gradient from left.
- **Button groups:** `[0.5hr] [1hr] [2hr] [4hr]` duration presets, active state uses module colour
- **Dropdowns:** `<select>` with same styling as inputs
- **Checkboxes:** Browser-native with `accent-[colour]`
- **Toggle buttons:** `[Global] [Custom]` pair, active = module colour bg + white text

### Empty states
**`ModuleEmptyState`** — centred alert icon, module name, list of missing library items, "Go to Project Home" button. Shown when required library items aren't assigned to the project.

### Loading states
No formal loading component — modules show empty states or loading spinners inline. Some buttons show "Loading…" or "Saving…" text during async operations.

---

## 6. Data Flow

### ProjectContext
**File:** `frontend/src/context/ProjectContext.jsx`
- **Pattern:** React Context with a `ProjectProvider` wrapping the app
- **State:** Current project, active library item IDs, loaded library item data, profile data, wholesale prices, global toggles (Real/Nominal, VAT, Compound/Linear, inflation rate, analysis period)
- **Library items:** `activeLibraryItems` (IDs) → `loadedItems` (full objects fetched from API)
- **Profile data:** HH demand array fetched separately (parquet blob decoded server-side)
- **Working state:** Per-module state persisted across navigation (e.g. `solarWorkingState`, `windWorkingState`)

```jsx
const { priceBasis, vatDisplay, escalationMethod, inflationRate,
  analysisPeriod, profileData, loadedItems, activeLibraryItems } = useProject();
```

### ProjectEngineContext
**File:** `frontend/src/context/ProjectEngineContext.jsx`
- **Pattern:** React Context that derives computed values from ProjectContext
- **Exposes:** `engine` object with derived properties + calculation functions
- **Key properties:** `engine.tariff`, `engine.network`, `engine.escalation`, `engine.metadata`
- **Key functions:** `engine.calculate.fullBill(overrides)`, `engine.calculate.avoidedImport(profile)`, `engine.calculate.exportValue(profile)`, `engine.calculate.wholesaleCost(profile)`

```jsx
const engine = useProjectEngine();
// Use derived data:
const asc = engine.network.asc;
const bands = engine.tariff.bands;
// Run calculations:
const bill = engine.calculate.fullBill({ demandProfile: modifiedProfile });
```

### Three-level calculation architecture
1. **Level 1:** Pure billing functions (stateless, parameterised) — `hhCalculations.js`, `deriveSABill.js`, `deriveReconstructedBill.js`
2. **Level 2:** Project engine (`ProjectEngineContext`) — holds defaults, provides `fullBill()` with optional overrides
3. **Level 3:** Intervention coordinators (`interventionBilling.js`, `tariffArbitrage.js`) — thin wrappers calling Level 2 twice (BAU + intervention), apply degradation/escalation/CAPEX/OPEX

### Display transforms
**File:** `frontend/src/utils/displayTransforms.js`
- Engine ALWAYS calculates in Real 2026 ex-VAT
- `applyDisplayTransforms(value, year, { priceBasis, inflationRate, vatDisplay })` — converts at render layer
- Real → Nominal: `value × (1 + inflation)^year`
- Ex-VAT → Inc-VAT: `value × 1.2`

---

## 7. Backend Architecture

### Stack
- **FastAPI** (Python) — REST API
- **SQLite** with WAL mode — single file database at `data/wholesale.db`
- **aiosqlite** — async SQLite access
- **No ORM** — raw SQL queries

### API structure
- Routers in `api/routers/` (library_v3, wholesale, solar, wind, network, published_rates)
- State management in `api/state.py` (project CRUD, library item CRUD)
- Database access in `api/db/` (wholesale_db, library_db, profile_db)

### Library system
- All data stored as library items with `library_type`, `name`, `config_json`
- 10 active types: load_profile, supply_arrangement, network_connection, escalation_scenario, wholesale_price, solar_pv, solar_asset, battery_asset, wind, wind_asset
- Projects reference library items by ID; library items store all configuration as JSON

---

## 8. Key Files Reference

| Purpose | File |
|---------|------|
| Tailwind config (colours, fonts, sizes) | `frontend/tailwind.config.js` |
| CSS base + font faces + component classes | `frontend/src/index.css` |
| Design system tokens (chart colours) | `frontend/src/design-system/tokens.js` |
| Cost category master (6 categories) | `frontend/src/data/costCategories.js` |
| Chart configuration master | `frontend/src/data/chartConfig.js` |
| Chart styling tokens (axes, tooltips) | `frontend/src/data/chartTokens.js` |
| Project context (state management) | `frontend/src/context/ProjectContext.jsx` |
| Engine context (calculations) | `frontend/src/context/ProjectEngineContext.jsx` |
| Display transforms (Real/Nominal/VAT) | `frontend/src/utils/displayTransforms.js` |
| Intervention billing coordinator | `frontend/src/utils/interventionBilling.js` |
| Explorer layout shell | `frontend/src/components/layout/ExplorerLayout.jsx` |
| Sidebar navigation | `frontend/src/components/layout/Sidebar.jsx` |
| All shared UI components | `frontend/src/components/ui/` |
