/**
 * LiveResultsStrip.jsx — Brief 28-IM-Polish IA 3.2 / Bug 2.6
 *
 * Compact always-visible strip showing 4 KPI numbers for the current
 * module. Sits below the 3D viewer in the right column (or below an
 * equivalent context-image area for modules without a 3D viewer).
 *
 * Replaces the previous full-column "Live Results" tab — that pattern
 * burned 400 px of right-column width to show 5 numbers in a sea of
 * whitespace. The strip is ~80 px tall and stays visible regardless of
 * which centre-column view tab is active.
 *
 * The same component is consumed across Building / Internal Gains /
 * Operation / Systems / Results — each module passes its own four
 * `items` per Brief 28-IM-Polish IA 3.2 mapping.
 *
 * Static-only by design (the brief reserves Dynamic re-runs for the
 * separate toolbar button); each module that already has a Dynamic-aware
 * panel keeps that elsewhere.
 *
 * Props:
 *   items: [{ label, value, unit, sub?, accent? }]   — 1–6 entries (4 typical)
 *   loading?: bool                                    — render skeleton
 *   className?: string
 */

export default function LiveResultsStrip({ items = [], loading = false, className = '' }) {
  if (loading) {
    return (
      <div className={`flex border-t border-light-grey bg-off-white ${className}`} style={{ minHeight: 80 }}>
        {[1, 2, 3, 4].map(i => (
          <div key={i} className="flex-1 px-3 py-2 border-r border-light-grey last:border-r-0">
            <div className="h-2 bg-light-grey/60 rounded w-12 mb-2 animate-pulse" />
            <div className="h-5 bg-light-grey rounded w-16 animate-pulse" />
          </div>
        ))}
      </div>
    )
  }
  if (!items || items.length === 0) return null
  return (
    <div className={`flex border-t border-light-grey bg-off-white ${className}`} style={{ minHeight: 80 }}>
      {items.map((it, i) => (
        <div
          key={it.label ?? i}
          className="flex-1 px-3 py-2 border-r border-light-grey last:border-r-0"
          style={it.accent ? { borderTop: `2px solid ${it.accent}` } : undefined}
        >
          <p className="text-xxs uppercase tracking-wider text-mid-grey leading-tight">{it.label}</p>
          <p className="text-base text-navy font-bold tabular-nums leading-tight mt-0.5">
            {it.value} <span className="text-xxs text-mid-grey font-normal">{it.unit}</span>
          </p>
          {it.sub && <p className="text-xxs text-mid-grey/80 leading-tight mt-0.5 truncate" title={it.sub}>{it.sub}</p>}
        </div>
      ))}
    </div>
  )
}
