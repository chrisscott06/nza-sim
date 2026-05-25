/**
 * SystemSummaryRow.jsx — Brief 42 Part 3 (2026-05-20)
 *                     + Brief 45 Part 3 (2026-05-21)
 *
 * Compact per-system row rendered inside each service section in the
 * Systems module's left panel.
 *
 * Pre-Brief-45 (Brief 42 Part 3 §3.2):
 *   ● Label                          90% | SCOP 2.8 | [⚙ Edit]
 *
 * Brief 45 Part 3 (2026-05-21) — share editable inline:
 *   ● Label    [─────●─────] 90%  | SCOP 2.8 | [⚙ Edit]
 *
 * The user can drag the share slider directly in the summary row
 * without opening the pop-out. The pencil still opens the full editor
 * for the other per-system fields (label, source, efficiency, control
 * mechanism, etc).
 *
 * Click the edit button → opens `SystemEditorPopout` (full editor in
 * a draggable pop-out). Click the enable dot → toggles `enabled`.
 *
 * Building-level fields are NOT shown here — they live in the
 * `ServiceSectionHeader` block above the row list.
 *
 * Brief 45 Part 3: `onShareChange(newSharePct)` callback fires on every
 * drag update so the engine re-runs via the parent's existing useMemo
 * chain. Validation (sum of enabled shares = 100%) stays in the
 * section-header surface — this row's `shareInvalid` flag tints the
 * share badge amber when the section is out of balance, the slider's
 * own colour stays neutral so the user can move it cleanly.
 */

import { Pencil, Trash2 } from 'lucide-react'
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

export default function SystemSummaryRow({
  system,
  onToggleEnabled,
  onEdit,
  onShareChange,
  onDelete,
  shareInvalid = false,
  enabledPartnerCount = 0,   // Brief 47 Part 3 — share-rebalance flow clarity
}) {
  const service = system?.service ?? 'heating'
  const accent = SERVICE_COLOURS[service] ?? '#00AEEF'
  const isEnabled = system?.enabled !== false
  const headline = headlineEfficiency(system)
  const sharePct = Number(system?.share_pct ?? 0)

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

      {/* Brief 45 Part 3 (2026-05-21): inline share slider. Drag updates
          share_pct via onShareChange; the engine re-runs through the
          parent's existing useMemo chain. accentColor matches the service
          accent. stopPropagation on the slider's click + mousedown so the
          drag doesn't fall through to the row's edit-on-click affordance.
          Slider hidden when system is disabled — the disabled row's
          opacity-50 wrapper would mute it anyway, and a disabled system's
          share isn't editable until the user re-enables it. Slider also
          hidden when onShareChange is not provided (graceful fallback for
          any caller that hasn't been migrated). */}
      {onShareChange && isEnabled && (
        <input
          type="range"
          min={0}
          max={100}
          step={1}
          value={sharePct}
          onChange={(e) => onShareChange(Number(e.target.value))}
          onClick={(e) => e.stopPropagation()}
          onMouseDown={(e) => e.stopPropagation()}
          className="flex-shrink-0 w-20 h-[3px] cursor-pointer"
          style={{ accentColor: accent }}
          title={
            // Brief 47 Part 3 share-rebalance clarity: when this system
            // has enabled partners in the same service, Brief 45 Part
            // 3b auto-rebalances them as you drag this slider. The
            // tooltip surfaces that behaviour so the user understands
            // the partner sliders are about to move, too.
            enabledPartnerCount > 0
              ? `Share: ${sharePct}% of ${service} demand · drag to rebalance ${enabledPartnerCount} partner system${enabledPartnerCount === 1 ? '' : 's'} (enabled sum stays = 100%)`
              : `Share: ${sharePct}% of ${service} demand`
          }
        />
      )}

      {/* Share — Brief 42 Part 4 conditional-pass review: bumped from
          text-mid-grey to text-navy font-medium. Share is the single most-
          edited per-system field; needing to open the pop-out just to read
          it was friction. Brief 45 Part 3: pinned to w-9 so the share %
          width stays stable as the slider above it moves. */}
      <span className={`flex-shrink-0 text-xxs tabular-nums font-medium w-9 text-right ${
        shareInvalid && isEnabled ? 'text-amber-600' : (isEnabled ? 'text-navy' : 'text-mid-grey')
      }`}>
        {sharePct}%
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

      {/* Brief 47 Part 1.3 (2026-05-24): list-level delete affordance.
          Trash icon, confirm-before-delete (system removal is destructive
          and affects share validation across the service). Renders only
          when onDelete is provided so existing callers that haven't been
          migrated stay safe. */}
      {onDelete && (
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation()
            const label = system?.label ?? '(unnamed system)'
            if (window.confirm(`Delete system "${label}"?`)) onDelete()
          }}
          className="flex-shrink-0 p-1 rounded hover:bg-red-50 text-mid-grey hover:text-red-600 transition-colors"
          title="Delete this system"
        >
          <Trash2 size={11} />
        </button>
      )}
    </div>
  )
}
