/**
 * EnginePill.jsx — Brief 28-IM-Polish §4.2 / Bug 2.7
 *
 * Small pill in the top-corner of every chart indicating which engine
 * produced the rendered data. Click to toggle when Dynamic is available;
 * when Dynamic is unavailable the button stays disabled with a tooltip.
 *
 * Engine colour convention (already used elsewhere in the app):
 *   - Static  → teal-700 (#0F766E)
 *   - Dynamic → violet-700 (#9333EA)
 *   - Both    → split-colour pill
 *
 * Props:
 *   mode:         'static' | 'dynamic' | 'both'
 *   onToggle?:    fn — called when the pill is clicked (omit for read-only)
 *   dynamicReady: bool — when false + onToggle present, the Dynamic side
 *                       is greyed out and the tooltip explains why
 *   stale?:       bool — when true, render a "stale" indicator
 */

const COLOURS = {
  static:  { bg: '#0F766E15', border: '#0F766E', text: '#0F766E' },
  dynamic: { bg: '#9333EA15', border: '#9333EA', text: '#9333EA' },
  both:    { bg: '#F1F5F9',   border: '#475569', text: '#475569' },
}

export default function EnginePill({ mode = 'static', onToggle, dynamicReady = true, stale = false, className = '' }) {
  const c = COLOURS[mode] ?? COLOURS.static
  const label = mode === 'both' ? 'Static + Dynamic' : mode === 'dynamic' ? 'Dynamic' : 'Static'
  const interactive = typeof onToggle === 'function'
  const title = !dynamicReady && mode === 'static'
    ? 'Dynamic not available — run the simulation to enable comparison'
    : stale
      ? 'Dynamic result is stale — inputs changed since last run'
      : interactive ? 'Click to toggle engine source' : label

  return (
    <button
      onClick={interactive ? onToggle : undefined}
      disabled={!interactive || (mode === 'static' && !dynamicReady)}
      title={title}
      className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full border text-xxs font-medium tabular-nums ${interactive ? 'cursor-pointer hover:brightness-105' : 'cursor-default'} ${className}`}
      style={{ backgroundColor: c.bg, borderColor: c.border, color: c.text }}
    >
      <span className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: c.border }} />
      {label}
      {stale && <span className="ml-1 text-amber-700" title="Dynamic stale">●</span>}
    </button>
  )
}
