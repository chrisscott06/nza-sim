// Pablo design system — chart styling tokens
// Used by all Recharts charts across the application

const FONT_STACK = "'Stolzl', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif"

export const TICK_STYLE = {
  fontSize: 8,
  fontFamily: FONT_STACK,
  fill: '#95A5A6',
}

export const TOOLTIP_STYLE = {
  backgroundColor: '#fff',
  border: '1px solid #E6E6E6',
  borderRadius: '4px',
  fontSize: '9px',
  fontFamily: FONT_STACK,
  color: '#58595B',
  padding: '4px 6px',
}

export const LEGEND_STYLE = {
  fontSize: '8px',
  fontFamily: FONT_STACK,
}

export const GRID_STYLE = {
  strokeDasharray: '3 3',
  stroke: '#E6E6E6',
}

// Standard axis props — pass as spread onto XAxis/YAxis
export const AXIS_PROPS = {
  tick: TICK_STYLE,
  axisLine: { stroke: '#E6E6E6' },
  tickLine: false,
}

// Tooltip content wrapper styling
export const TOOLTIP_WRAPPER_STYLE = {
  outline: 'none',
}

// ── Shared colour palettes ────────────────────────────────────────────────────

/** Scenario comparison colours — index 0 = baseline, 1-5 = alternatives */
export const SCENARIO_COLORS = [
  '#2B2A4C', // navy   (baseline)
  '#00AEEF', // teal
  '#E84393', // magenta
  '#ECB01F', // gold
  '#16A34A', // green
  '#8B5CF6', // purple
]

/** End-use energy colours — keyed by end use */
export const ENDUSE_COLORS = {
  heating:      '#DC2626',
  cooling:      '#3B82F6',
  lighting:     '#ECB01F',
  equipment:    '#8B5CF6',
  fans:         '#7C3AED',
  dhw:          '#F97316',
  ventilation:  '#06B6D4',
  infiltration: '#9E9E9E',
}

/** Fabric element colours — keyed by element type */
export const FABRIC_COLORS = {
  wall:         '#A1887F',
  glazing:      '#4FC3F7',
  roof:         '#78909C',
  floor:        '#795548',
  infiltration: '#9E9E9E',
  ventilation:  '#06B6D4',
}

// ── Pablo-port tokens (Brief 28a Part 4, 2026-05-14) ────────────────────────
// Ported from pablo-2/frontend/src/data/chartTokens.js. MODELLER_COLORS
// intentionally NOT ported (Pablo-specific). BUILDING_SERVICE_COLORS not
// ported here either — NZA-Sim's heat-balance views consume the canonical
// palette in frontend/src/data/balanceColours.js (INTERNAL_COLOURS,
// SOLAR_COLOURS, FABRIC_COLOURS, HEATING_COLOUR, COOLING_COLOUR). Reconciling
// the two palettes into a single canon is a Brief 28a Part 3f / ui_principles
// decision and is deferred until that work lands.

/**
 * Generic chart series colours — for multi-series charts (load profiles,
 * energy flows, etc.) where the series identity doesn't map to a known
 * domain palette. Use SCENARIO_COLORS for scenario comparison; use
 * ENDUSE_COLORS / FABRIC_COLORS / balanceColours.js for domain-specific
 * series.
 */
export const CHART_SERIES_COLORS = [
  '#00AEEF', // teal (always first)
  '#E84393', // magenta
  '#ECB01F', // gold
  '#F48379', // coral
  '#2ECC71', // green
  '#9B59B6', // purple
  '#C8423C', // red
  '#2B2A4C', // navy
]

/** Season colours — used by MonthJumpButtons (0-indexed month → season). */
export const SEASON_COLORS = {
  Winter: '#00AEEF',
  Spring: '#2ECC71',
  Summer: '#ECB01F',
  Autumn: '#F48379',
}

/** Month → season lookup (index 0–11 → key in SEASON_COLORS). */
export const MONTH_SEASON = [
  'Winter', 'Winter', 'Spring', 'Spring', 'Spring', 'Summer',
  'Summer', 'Summer', 'Autumn', 'Autumn', 'Autumn', 'Winter',
]

/** Short calendar-month labels (index 0–11). */
export const MONTH_LABELS = [
  'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
  'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec',
]
