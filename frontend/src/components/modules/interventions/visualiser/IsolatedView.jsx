/**
 * IsolatedView.jsx — Brief 71 Part 2
 *
 * Right-pane visualiser view that ranks every intervention by its standalone
 * impact: each measure run ALONE against the baseline, not stacked on top of
 * the others. Useful for "which single measure moves the needle most" — the
 * classic question the combined Waterfall can't answer cleanly because
 * marginals there are order-dependent.
 *
 * The data comes from `useIsolatedResults` (Brief 71 Part 1) which calls
 * `runInterventionStack` with a singleton per intervention. No new engine
 * code, no new physics — pure consumer view.
 *
 * Isolated ≠ marginal — the caption and the per-theme subtotal label both
 * state this so the user isn't misled into expecting the bars to sum to the
 * combined-stack After-stack total (they won't, because compounding shifts
 * the baseline for each subsequent stacked intervention).
 *
 * Affordances on each bar:
 *   - Enable/disable toggle (same dot as InterventionRow, INTERVENTIONS_ACCENT
 *     when enabled, mid-grey when off). Disabled rows render muted but keep
 *     their isolated number visible — the user can still see what they're
 *     leaving on the table.
 *   - Pencil → opens the editor (`onEdit(id)`). Mirrors InterventionRow.
 *
 * Sort options: by saving (default), by name, by theme. Group-by-theme is a
 * separate toggle; when enabled, bars are clustered under theme headers
 * with a subtotal labelled "sum of isolated impacts — not the compounded
 * total" (Principle 4).
 */

import { useMemo, useState } from 'react'
import { Pencil } from 'lucide-react'
import { useUISettings } from '../../../../context/UISettingsContext.jsx'
import { toDisplay, KIND, getGia } from './unitFmt.js'
import { useIsolatedResults } from '../useIsolatedResults.js'

const INTERVENTIONS_ACCENT = '#E84393'
const SAVE_GREEN  = '#16A34A'   // savings (negative EUI delta) — Tailwind green-600
const INCREASE_RED = '#DC2626'  // increases (positive EUI delta) — Tailwind red-600
const UNTAGGED_THEME = 'Untagged'

function fmtDelta(value, fixed = 1) {
  if (value == null || !Number.isFinite(value)) return '—'
  if (Math.abs(value) < 0.05) return '0.0'
  const sign = value < 0 ? '−' : '+'
  return `${sign}${Math.abs(value).toFixed(fixed)}`
}

/**
 * Per-bar row — label, the horizontal bar, value text, and action affordances.
 * Bars are anchored at the centre line (delta=0) so savings extend left in
 * green and increases extend right in red, mirroring the EUIWaterfall legend
 * semantics (Principle: same visual language across the Interventions module).
 */
function IsolatedBar({ row, displayDelta, scale, unitLabel, onToggleEnabled, onEdit }) {
  const enabled = row.enabled
  // Bar geometry — anchored at 50% of the bar lane; savings (negative) extend
  // left, increases (positive) extend right. Width is |delta| / scale.
  const pctW = scale > 0 ? Math.min(100, (Math.abs(displayDelta ?? 0) / scale) * 100) : 0
  const isSaving = (displayDelta ?? 0) < 0
  const colour = enabled
    ? (isSaving ? SAVE_GREEN : INCREASE_RED)
    : '#9CA3AF'   // muted grey for disabled rows
  // Bar starts at centre (50%) and extends 50%*pctW in either direction.
  const halfPct = pctW / 2
  const barLeft = isSaving ? `${50 - halfPct}%` : '50%'
  const barWidth = `${halfPct}%`

  return (
    <div className={`flex items-center gap-2 py-1.5 ${enabled ? '' : 'opacity-60'}`}>
      {/* Enable/disable dot — same affordance as InterventionRow */}
      <button
        type="button"
        onClick={() => onToggleEnabled?.(row.id)}
        className="flex-shrink-0 p-0.5 rounded hover:bg-light-grey/40 transition-colors"
        title={enabled ? 'Disable this intervention (also affects the combined stack)' : 'Enable this intervention'}
      >
        <span
          className="block w-2.5 h-2.5 rounded-full"
          style={{ backgroundColor: enabled ? INTERVENTIONS_ACCENT : '#9CA3AF' }}
        />
      </button>

      {/* Label */}
      <div className="w-40 flex-shrink-0 truncate">
        <span
          className={`text-caption ${enabled ? 'text-navy font-medium' : 'text-mid-grey line-through'}`}
          title={row.label}
        >
          {row.label}
        </span>
        {row.theme && (
          <span
            className="ml-1.5 px-1.5 py-0.5 rounded-full bg-light-grey/60 text-xxs text-mid-grey font-medium align-middle"
            title={`Theme: ${row.theme}`}
          >
            {row.theme}
          </span>
        )}
      </div>

      {/* Bar lane — bidirectional from centre */}
      <div className="flex-1 relative h-3 rounded bg-light-grey/40 overflow-hidden">
        {/* Centre line marker */}
        <div className="absolute top-0 bottom-0" style={{ left: '50%', width: '1px', backgroundColor: '#9CA3AF' }} />
        {/* The bar itself */}
        {Number.isFinite(displayDelta) && Math.abs(displayDelta) >= 0.05 && (
          <div
            className="absolute top-0 bottom-0"
            style={{ left: barLeft, width: barWidth, backgroundColor: colour }}
          />
        )}
      </div>

      {/* Delta value */}
      <div className="w-24 flex-shrink-0 text-right">
        <span
          className={`text-caption tabular-nums font-medium ${
            !enabled ? 'text-mid-grey' :
            isSaving ? 'text-green-700' :
            Math.abs(displayDelta ?? 0) < 0.05 ? 'text-mid-grey' :
            'text-red-700'
          }`}
        >
          {fmtDelta(displayDelta)}
          <span className="text-xxs text-mid-grey/70 font-normal"> {unitLabel}</span>
        </span>
      </div>

      {/* Edit affordance — mirrors InterventionRow */}
      <button
        type="button"
        onClick={() => onEdit?.(row.id)}
        className="flex-shrink-0 p-1.5 rounded hover:bg-light-grey/50 text-mid-grey hover:text-navy transition-colors"
        title="Edit this intervention"
        aria-label="Edit"
      >
        <Pencil size={13} />
      </button>
    </div>
  )
}

/**
 * Compute the display-unit EUI delta from a `cumulative_delta` record
 * (shape: `eui_kwh_per_m2: { from, to, delta, delta_pct }` per
 * `computeDelta` in interventionsEngine.js).
 */
function extractEuiDelta(cumulativeDelta) {
  return cumulativeDelta?.eui_kwh_per_m2?.delta ?? null
}

export default function IsolatedView({
  interventions = [],
  baselineConfig,
  runEngine,
  libraryData,
  stackResult,
  onToggleEnabled,
  onEdit,
}) {
  const [sortBy, setSortBy] = useState('saving')   // 'saving' | 'name' | 'theme'
  const [groupByTheme, setGroupByTheme] = useState(false)

  // Engine-consumer hook (Brief 71 Part 1). One extra runInterventionStack
  // singleton call per intervention; memoised against
  // [interventions, baselineConfig, runEngine, libraryData, stackResult].
  const isoRows = useIsolatedResults(interventions, baselineConfig, runEngine, libraryData, stackResult)

  // Honour the global Per m² / Total toggle. EUI is intensity by default
  // (kWh/m²·yr); when toggle = 'kwh', we'd want absolute MWh — but the
  // isolated delta in EUI maps cleanly to per-m² regardless. Convert via
  // toDisplay so the label tracks the toggle.
  const { unit } = useUISettings()
  const gia_m2 = getGia(stackResult?.baseline) || getGia(isoRows[0]?.isolatedResult?.baseline) || 0
  const unitLabel = toDisplay(0, KIND.KWH_M2, unit, gia_m2).label || 'kWh/m²·yr'

  // Convert each row's raw EUI delta through the toggle.
  const enriched = useMemo(() => {
    return isoRows.map((row) => {
      const rawEui = extractEuiDelta(row.cumulativeDelta)
      const displayDelta = rawEui != null
        ? toDisplay(rawEui, KIND.KWH_M2, unit, gia_m2).value
        : null
      return { ...row, displayDelta }
    })
  }, [isoRows, unit, gia_m2])

  // Sort
  const sorted = useMemo(() => {
    const copy = [...enriched]
    if (sortBy === 'name') {
      copy.sort((a, b) => (a.label || '').localeCompare(b.label || ''))
    } else if (sortBy === 'theme') {
      copy.sort((a, b) => {
        const ta = a.theme || UNTAGGED_THEME
        const tb = b.theme || UNTAGGED_THEME
        const cmp = ta.localeCompare(tb)
        if (cmp !== 0) return cmp
        // Within a theme, fall through to saving order (largest saving first)
        return (a.displayDelta ?? 0) - (b.displayDelta ?? 0)
      })
    } else {
      // 'saving' — most negative (biggest saving) first; null displayDelta sorts last
      copy.sort((a, b) => {
        const av = a.displayDelta ?? Infinity
        const bv = b.displayDelta ?? Infinity
        return av - bv
      })
    }
    return copy
  }, [enriched, sortBy])

  // Group-by-theme structure
  const grouped = useMemo(() => {
    if (!groupByTheme) return null
    const map = new Map()
    for (const row of sorted) {
      const t = row.theme || UNTAGGED_THEME
      if (!map.has(t)) map.set(t, [])
      map.get(t).push(row)
    }
    return Array.from(map.entries()).map(([theme, rows]) => {
      const subtotal = rows.reduce((s, r) => s + (Number.isFinite(r.displayDelta) ? r.displayDelta : 0), 0)
      return { theme, rows, subtotal }
    })
  }, [groupByTheme, sorted])

  // Scale — use the largest absolute display delta across all rows so every
  // bar is comparable. Min scale of 0.5 to avoid hairline bars when everything
  // is sub-unit.
  const scale = useMemo(() => {
    let max = 0.5
    for (const r of enriched) {
      const v = Math.abs(r.displayDelta ?? 0)
      if (v > max) max = v
    }
    return max
  }, [enriched])

  // Empty state
  if (interventions.length === 0) {
    return (
      <div className="border border-dashed border-light-grey rounded-xl bg-off-white/30 p-10 text-center">
        <p className="text-caption text-mid-grey">
          No interventions yet. Add interventions in the Stack tab to see their isolated impacts.
        </p>
      </div>
    )
  }
  if (isoRows.length === 0 || !stackResult) {
    return (
      <div className="border border-dashed border-light-grey rounded-xl bg-off-white/30 p-10 text-center">
        <p className="text-caption text-mid-grey">
          Computing isolated impacts… this requires the combined stack to have run at least once.
        </p>
      </div>
    )
  }

  return (
    <div className="space-y-4">
      {/* Header — title + controls */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <p className="text-caption font-semibold text-navy">Isolated impacts</p>
          <p className="text-xxs text-mid-grey mt-0.5">
            Each intervention run alone against the baseline. Standalone EUI change per measure.
          </p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          {/* Sort selector */}
          <div className="flex items-center gap-1 text-xxs">
            <span className="text-mid-grey">Sort:</span>
            {[
              { id: 'saving', label: 'By saving' },
              { id: 'name',   label: 'By name'   },
              { id: 'theme',  label: 'By theme'  },
            ].map(opt => (
              <button
                key={opt.id}
                type="button"
                onClick={() => setSortBy(opt.id)}
                className={`px-2 py-1 rounded text-xxs font-medium transition-colors ${
                  sortBy === opt.id
                    ? 'text-white'
                    : 'border border-light-grey text-mid-grey hover:border-navy hover:text-navy'
                }`}
                style={sortBy === opt.id ? { backgroundColor: INTERVENTIONS_ACCENT } : undefined}
              >
                {opt.label}
              </button>
            ))}
          </div>
          {/* Group-by-theme toggle */}
          <label className="flex items-center gap-1.5 text-xxs text-mid-grey cursor-pointer">
            <input
              type="checkbox"
              checked={groupByTheme}
              onChange={(e) => setGroupByTheme(e.target.checked)}
              className="rounded border-light-grey"
            />
            Group by theme
          </label>
        </div>
      </div>

      {/* Caption — isolated ≠ marginal (Principle 4) */}
      <div className="rounded-lg bg-amber-50 border border-amber-200 px-3 py-2">
        <p className="text-xxs text-amber-900">
          <span className="font-semibold">Isolated ≠ marginal.</span> Each bar shows what a measure
          would deliver on its own, measured from the unmodified baseline. The bars do NOT sum to
          the combined-stack total — for the compounded picture, switch to the Waterfall view.
        </p>
      </div>

      {/* Bars */}
      <div className="rounded-xl border border-light-grey bg-white px-4 py-3">
        {!groupByTheme && (
          <div>
            {sorted.map(row => (
              <IsolatedBar
                key={row.id}
                row={row}
                displayDelta={row.displayDelta}
                scale={scale}
                unitLabel={unitLabel}
                onToggleEnabled={onToggleEnabled}
                onEdit={onEdit}
              />
            ))}
          </div>
        )}
        {groupByTheme && grouped && grouped.map(group => (
          <div key={group.theme} className="mb-4 last:mb-0">
            <div className="flex items-baseline justify-between border-b border-light-grey pb-1 mb-1">
              <span className="text-xxs font-semibold text-navy uppercase tracking-wider">
                {group.theme}
              </span>
              <span className="text-xxs text-mid-grey tabular-nums">
                <span className="italic">sum of isolated impacts — not the compounded total: </span>
                <span className={`font-medium ${
                  group.subtotal < -0.05 ? 'text-green-700' :
                  group.subtotal >  0.05 ? 'text-red-700'   :
                  'text-mid-grey'
                }`}>
                  {fmtDelta(group.subtotal)} {unitLabel}
                </span>
              </span>
            </div>
            {group.rows.map(row => (
              <IsolatedBar
                key={row.id}
                row={row}
                displayDelta={row.displayDelta}
                scale={scale}
                unitLabel={unitLabel}
                onToggleEnabled={onToggleEnabled}
                onEdit={onEdit}
              />
            ))}
          </div>
        ))}
      </div>

      {/* Legend */}
      <div className="flex items-center justify-end gap-4 text-xxs text-mid-grey">
        <span className="inline-flex items-center gap-1">
          <span className="block w-3 h-2 rounded" style={{ backgroundColor: SAVE_GREEN }} />
          saving (lower EUI)
        </span>
        <span className="inline-flex items-center gap-1">
          <span className="block w-3 h-2 rounded" style={{ backgroundColor: INCREASE_RED }} />
          increase (higher EUI)
        </span>
      </div>
    </div>
  )
}
