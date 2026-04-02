// Pablo design system — chart styling tokens
// Used by all Recharts charts across the application

const FONT_STACK = "'Stolzl', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif"

export const TICK_STYLE = {
  fontSize: 9,
  fontFamily: FONT_STACK,
  fill: '#95A5A6',
}

export const TOOLTIP_STYLE = {
  backgroundColor: '#fff',
  border: '1px solid #E6E6E6',
  borderRadius: '4px',
  fontSize: '10px',
  fontFamily: FONT_STACK,
  color: '#58595B',
  padding: '6px 8px',
}

export const LEGEND_STYLE = {
  fontSize: '9px',
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
