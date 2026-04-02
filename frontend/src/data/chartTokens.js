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
