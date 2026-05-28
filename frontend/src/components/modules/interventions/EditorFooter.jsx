/**
 * EditorFooter.jsx — Brief 46 Part 1 (2026-05-21)
 *
 * Sticky footer of the intervention editor pop-out. Shows:
 *   - Intervention label (editable input)
 *   - Σ patches counter (read from capture context)
 *   - Baseline EUI / Current EUI / ΔEUI / ΔCO₂ (live, derived from
 *     engine results the parent passes in via props)
 *   - Cancel + Save buttons (parent handles persistence)
 *
 * Parent (`InterventionEditorPopout`) is responsible for:
 *   - Running the engine on `baseline + currentPatches` to produce the
 *     preview metrics (`previewEui`, `previewCarbon`)
 *   - Computing the deltas vs baseline (this component formats them)
 *   - Wiring Save / Cancel callbacks
 *   - Validating Save (e.g. label required, no engine validation
 *     errors) — passed in as `canSave` prop
 *
 * This component is purely presentational and reads from the capture
 * context for the patches counter.
 */

import { useInterventionCapture } from '../../../context/InterventionCaptureContext.jsx'
import { useUISettings } from '../../../context/UISettingsContext.jsx'
import { toDisplay, KIND } from './visualiser/unitFmt.js'

const INTERVENTIONS_ACCENT = '#E84393'

function fmtEui(v) {
  if (v == null || !Number.isFinite(v)) return '—'
  if (Math.abs(v) >= 100) return v.toFixed(0)
  if (Math.abs(v) >= 10)  return v.toFixed(1)
  return v.toFixed(2)
}

function fmtDelta(v, unit) {
  if (v == null || !Number.isFinite(v) || Math.abs(v) < 0.05) return { text: `0.0 ${unit}`, tone: 'neutral' }
  const sign = v < 0 ? '−' : '+'
  return {
    text: `${sign}${Math.abs(v).toFixed(1)} ${unit}`,
    tone: v < 0 ? 'good' : 'bad',
  }
}

function DeltaPill({ delta, unit, tone, title }) {
  const toneCls = tone === 'good' ? 'text-green-600 bg-green-50 border-green-200'
                : tone === 'bad'  ? 'text-red-600 bg-red-50 border-red-200'
                                  : 'text-mid-grey bg-off-white border-light-grey'
  return (
    <span
      className={`inline-flex items-center px-2 py-0.5 rounded-full border text-xxs tabular-nums font-medium ${toneCls}`}
      title={title}
    >
      {delta}{unit ? ` ${unit}` : ''}
    </span>
  )
}

export default function EditorFooter({
  label,
  onLabelChange,
  // Brief 71 Part 4 (2026-05-28): theme is a free-text tag stored on every
  // intervention. The Isolated view (Brief 71 Part 2) groups by it; the
  // InterventionRow badge surfaces it. Existing field on every persisted
  // intervention; only the editor control was missing.
  theme,
  onThemeChange,
  themeSuggestions = [],
  baselineEui,
  baselineCarbon,
  previewEui,
  previewCarbon,
  gia_m2 = 0,        // 2026-05-26: needed for unit-toggle conversion (kWh/m²·yr ↔ MWh)
  onCancel,
  onSave,
  canSave = true,
  saveDisabledReason,
}) {
  const { currentPatches } = useInterventionCapture()
  const { unit } = useUISettings()
  const patchCount = Array.isArray(currentPatches) ? currentPatches.length : 0

  const euiDelta    = (Number.isFinite(previewEui) && Number.isFinite(baselineEui)) ? previewEui - baselineEui : null
  const carbonDelta = (Number.isFinite(previewCarbon) && Number.isFinite(baselineCarbon)) ? previewCarbon - baselineCarbon : null

  // Convert baseline + preview + delta to the chosen display unit.
  // 2026-05-26: carbon also honours the toggle (kgCO₂/m²·yr ↔ tCO₂).
  const baselineConv = toDisplay(baselineEui, KIND.KWH_M2, unit, gia_m2)
  const previewConv  = toDisplay(previewEui,  KIND.KWH_M2, unit, gia_m2)
  const deltaConv    = toDisplay(euiDelta,    KIND.KWH_M2, unit, gia_m2)
  const euiUnitLabel = baselineConv.label || previewConv.label || 'kWh/m²·yr'

  const carbonDeltaConv = toDisplay(carbonDelta, KIND.KG_M2, unit, gia_m2)
  const carbonUnitLabel = carbonDeltaConv.label || 'kgCO₂/m²·yr'

  const euiFmt    = fmtDelta(deltaConv.value, euiUnitLabel)
  const carbonFmt = fmtDelta(carbonDeltaConv.value, carbonUnitLabel)

  return (
    <div className="flex-shrink-0 border-t border-light-grey bg-white px-3 py-2 flex items-center gap-3 flex-wrap">
      {/* Label input */}
      <div className="flex items-center gap-1.5 flex-shrink-0">
        <span className="text-xxs uppercase tracking-wider text-mid-grey font-medium">Label</span>
        <input
          type="text"
          value={label ?? ''}
          onChange={(e) => onLabelChange?.(e.target.value)}
          placeholder="Intervention name"
          className="w-44 px-2 py-1 rounded border border-light-grey text-xxs text-navy focus:outline-none focus:border-navy"
        />
      </div>

      {/* Theme input — Brief 71 Part 4 (2026-05-28). Free-text combobox via
          a native <datalist> so existing distinct theme values from the
          interventions list surface as autocomplete suggestions. Tag
          consistency without enforcing a closed vocabulary. */}
      <div className="flex items-center gap-1.5 flex-shrink-0">
        <span className="text-xxs uppercase tracking-wider text-mid-grey font-medium" title="Group tag — shown as a badge on the stack row and used by the Isolated view's group-by-theme toggle">Theme</span>
        <input
          type="text"
          list="brief71-theme-suggestions"
          value={theme ?? ''}
          onChange={(e) => onThemeChange?.(e.target.value)}
          placeholder="e.g. Fabric, Systems"
          className="w-32 px-2 py-1 rounded border border-light-grey text-xxs text-navy focus:outline-none focus:border-navy"
        />
        <datalist id="brief71-theme-suggestions">
          {themeSuggestions.map((t) => (
            <option key={t} value={t} />
          ))}
        </datalist>
      </div>

      {/* Patches counter */}
      <span className="text-xxs text-mid-grey tabular-nums" title="Captured patches in this intervention">
        Σ patches: <span className="text-navy font-medium">{patchCount}</span>
      </span>

      {/* Metrics block */}
      <div className="flex items-center gap-3 flex-wrap">
        <span className="text-xxs text-mid-grey">
          EUI <span className="text-mid-grey/80 tabular-nums">{fmtEui(baselineConv.value)}</span>
          <span className="mx-1 text-mid-grey/60">→</span>
          <span className="text-navy font-medium tabular-nums">{fmtEui(previewConv.value)}</span>
          <span className="ml-1 text-mid-grey/70">{euiUnitLabel}</span>
        </span>
        <DeltaPill
          delta={euiFmt.text}
          tone={euiFmt.tone}
          title={`EUI change vs baseline: ${euiFmt.text}`}
        />
        <DeltaPill
          delta={carbonFmt.text}
          tone={carbonFmt.tone}
          title={`Carbon change vs baseline: ${carbonFmt.text}`}
        />
      </div>

      {/* Right-anchored actions */}
      <div className="ml-auto flex items-center gap-2 flex-shrink-0">
        <button
          type="button"
          onClick={onCancel}
          className="px-3 py-1.5 rounded-lg border border-light-grey text-xxs font-medium text-mid-grey hover:bg-off-white transition-colors"
        >
          Cancel
        </button>
        <button
          type="button"
          onClick={onSave}
          disabled={!canSave}
          className="px-4 py-1.5 rounded-lg text-white text-xxs font-medium hover:opacity-90 transition-opacity disabled:opacity-40 disabled:cursor-not-allowed"
          style={{ backgroundColor: INTERVENTIONS_ACCENT }}
          title={canSave ? 'Save changes to intervention' : (saveDisabledReason ?? 'Cannot save — see editor')}
        >
          Save intervention
        </button>
      </div>
    </div>
  )
}
