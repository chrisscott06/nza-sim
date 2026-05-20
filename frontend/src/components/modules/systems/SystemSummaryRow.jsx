/**
 * SystemSummaryRow.jsx — Brief 42 Part 3 (2026-05-20)
 *
 * Compact per-system row rendered inside each service section in the
 * Systems module's left panel. Per Brief 42 §3.2:
 *
 *   ● Label                          90% | SCOP 2.8 | [⚙ Edit]
 *
 * Click the edit button → opens `SystemEditorPopout` (full editor in
 * a draggable pop-out). Click the enable dot → toggles `enabled`.
 *
 * Building-level fields are NOT shown here — they live in the
 * `ServiceSectionHeader` block above the row list.
 */

import { Pencil } from 'lucide-react'
import { SERVICE_COLOURS } from './SystemEditorCard.jsx'

function headlineEfficiency(system) {
  const service = system?.service
  const v = system?.efficiency_metric
  if (service === 'heating') {
    if (typeof v !== 'number') return null
    if (system?.source === 'ambient_air' || system?.source === 'ambient_ground') return `SCOP ${v.toFixed(1)}`
    if (system?.source === 'district_heating' || system?.source === 'electricity') return `COP ${v.toFixed(2)}`
    return `η ${v.toFixed(2)}`
  }
  if (service === 'cooling') {
    return typeof v === 'number' ? `SEER ${v.toFixed(1)}` : null
  }
  if (service === 'dhw') {
    return typeof v === 'number' ? `η ${v.toFixed(2)}` : null
  }
  if (service === 'ventilation') {
    const sfp = v?.sfp_w_per_lps ?? system?.sfp_w_per_lps
    const recov = v?.recovery_sensible_pct ?? system?.recovery_sensible_pct
    const parts = []
    if (typeof sfp === 'number')   parts.push(`SFP ${sfp.toFixed(2)}`)
    if (typeof recov === 'number') parts.push(`HRE ${recov.toFixed(0)}%`)
    return parts.length > 0 ? parts.join(' · ') : null
  }
  if (service === 'lighting' || service === 'small_power') {
    const cf = system?.control_factor
    const mech = system?.control_mechanism
    if (mech === 'constant') return 'No controls'
    if (typeof cf === 'number') return `${mech?.replace(/_/g, ' ')} (${(cf * 100).toFixed(0)}%)`
    return mech?.replace(/_/g, ' ') ?? null
  }
  return null
}

export default function SystemSummaryRow({ system, onToggleEnabled, onEdit, shareInvalid = false }) {
  const service = system?.service ?? 'heating'
  const accent = SERVICE_COLOURS[service] ?? '#00AEEF'
  const isEnabled = system?.enabled !== false
  const headline = headlineEfficiency(system)

  return (
    <div
      className={`flex items-center gap-2 px-2 py-1.5 rounded border border-light-grey bg-white hover:border-mid-grey/40 transition-colors ${
        !isEnabled ? 'opacity-50' : ''
      }`}
    >
      {/* Enable dot */}
      <button
        type="button"
        onClick={onToggleEnabled}
        className="flex-shrink-0 p-0.5 rounded hover:bg-light-grey/40 transition-colors"
        title={isEnabled ? 'Disable this system' : 'Enable this system'}
      >
        <span
          className="block w-2.5 h-2.5 rounded-full"
          style={{ backgroundColor: isEnabled ? accent : '#9CA3AF' }}
        />
      </button>

      {/* Label */}
      <button
        type="button"
        onClick={onEdit}
        className="flex-1 min-w-0 text-left"
        title="Click to edit"
      >
        <span className={`block truncate text-xxs ${isEnabled ? 'text-navy font-medium' : 'text-mid-grey line-through'}`}>
          {system?.label ?? '(unnamed)'}
        </span>
      </button>

      {/* Share — Brief 42 Part 4 conditional-pass review: bumped from
          text-mid-grey to text-navy font-medium. Share is the single most-
          edited per-system field; needing to open the pop-out just to read
          it was friction. */}
      <span className={`flex-shrink-0 text-xxs tabular-nums font-medium ${
        shareInvalid && isEnabled ? 'text-amber-600' : (isEnabled ? 'text-navy' : 'text-mid-grey')
      }`}>
        {Number(system?.share_pct ?? 0)}%
      </span>

      {/* Headline efficiency — bumped from text-mid-grey/80 to text-mid-grey
          for the same readability reason (still secondary to share). */}
      {headline && (
        <span className={`flex-shrink-0 text-xxs truncate max-w-[140px] ${
          isEnabled ? 'text-mid-grey' : 'text-mid-grey/60'
        }`} title={headline}>
          {headline}
        </span>
      )}

      {/* Edit button */}
      <button
        type="button"
        onClick={onEdit}
        className="flex-shrink-0 p-1 rounded hover:bg-light-grey/40 text-mid-grey hover:text-navy transition-colors"
        title="Edit this system"
      >
        <Pencil size={11} />
      </button>
    </div>
  )
}
