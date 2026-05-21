/**
 * ServiceSplitBar.jsx — Brief 45 Part 3 (2026-05-21)
 *
 * Horizontal bar visualising the share split across a service's systems.
 * Renders inside `ServiceSectionHeader` (or wherever the Systems module
 * lays out per-service blocks) above the per-system summary rows.
 *
 *   ─────────────────────────────────────────────
 *   ▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓░░░  Heating
 *   95% Primary VRF      ·  5% Secondary panel
 *   ─────────────────────────────────────────────
 *
 * Falsifiability:
 *   - Single-system case (most common today): one full-width segment in
 *     the service accent colour. Tooltip "Single system · 100%".
 *   - Two-system case (Bridgewater Heating + DHW): two segments sized
 *     by their `share_pct`, separated by a 1 px gap. Each segment's
 *     `title` attribute carries `<label> — <share>%`.
 *   - Disabled systems render with a hatched pattern (CSS background
 *     stripes) and reduced opacity.
 *   - When enabled-shares sum ≠ 100%, an amber "Σ <sum>%" badge floats
 *     to the right of the bar so the user sees the validation surface
 *     at a glance without scrolling to the bottom of the service
 *     section.
 *
 * Brief 45 Principle §1: no engine changes. This component reads the
 * already-validated systems_config_v40.<service> array.
 */

import { SERVICE_COLOURS } from './SystemEditorCard.jsx'

const DISABLED_HATCH = 'repeating-linear-gradient(45deg, rgba(156,163,175,0.55) 0 4px, rgba(156,163,175,0.25) 4px 8px)'

export default function ServiceSplitBar({ service, systems = [] }) {
  const accent = SERVICE_COLOURS[service] ?? '#00AEEF'
  const list = Array.isArray(systems) ? systems : []

  // Compute total enabled share for the validation badge. Disabled
  // shares stay in the bar's visual layout (rendered hatched) so the
  // user can see what's been authored, but the validation Σ tracks
  // only enabled.
  const enabledList = list.filter(s => s?.enabled !== false)
  const enabledSum = enabledList.reduce((s, x) => s + Number(x?.share_pct ?? 0), 0)
  const validShares = list.length === 0 || enabledList.length === 0
    || Math.abs(enabledSum - 100) < 0.5

  // Total shares for layout proportions — include disabled so the
  // visual bar reflects what's been entered. If the total is < 100,
  // pad with a grey "unallocated" slot so the bar always fills.
  const totalShare = list.reduce((s, x) => s + Number(x?.share_pct ?? 0), 0)
  const unallocated = Math.max(0, 100 - totalShare)
  const segmentDivisor = Math.max(totalShare + unallocated, 100)

  if (list.length === 0) {
    return null
  }

  // Generate per-system segment colour. Single-system → full accent.
  // Multi-system → alternate between full accent + accent at 70% / 50%
  // saturation by hex-mixing with white. Keeps the colour family
  // recognisable per service while distinguishing systems.
  const colourFor = (idx) => {
    if (list.length === 1) return accent
    // Hex-blend with white at progressively higher ratios for later systems.
    const blendPct = Math.min(0.55, idx * 0.18)
    return blendHexWithWhite(accent, blendPct)
  }

  return (
    <div className="flex items-center gap-2 mb-1.5 px-0.5">
      <div className="flex-1 flex h-3 rounded overflow-hidden border border-light-grey/60" style={{ backgroundColor: '#F3F4F6' }}>
        {list.map((sys, idx) => {
          const sharePct = Number(sys?.share_pct ?? 0)
          const widthPct = (sharePct / segmentDivisor) * 100
          const isEnabled = sys?.enabled !== false
          const colour = colourFor(idx)
          const tooltip = `${sys?.label ?? '(unnamed)'} — ${sharePct.toFixed(1)}% ${isEnabled ? '' : '(disabled)'}`.trim()
          if (widthPct <= 0) return null
          return (
            <div
              key={sys?.id ?? `seg-${idx}`}
              className="h-full flex-shrink-0"
              style={{
                width: `${widthPct}%`,
                background: isEnabled ? colour : DISABLED_HATCH,
                opacity: isEnabled ? 0.9 : 0.7,
                borderLeft: idx > 0 ? '1px solid white' : 'none',
              }}
              title={tooltip}
            />
          )
        })}
        {unallocated > 0 && (
          <div
            className="h-full flex-shrink-0"
            style={{
              width: `${(unallocated / segmentDivisor) * 100}%`,
              backgroundColor: 'transparent',
            }}
            title={`Unallocated — ${unallocated.toFixed(1)}%`}
          />
        )}
      </div>
      <span
        className={`text-xxs tabular-nums w-12 text-right ${validShares ? 'text-mid-grey/70' : 'text-amber-700 font-medium'}`}
        title={validShares ? 'Enabled shares sum to 100%' : `Enabled shares sum to ${enabledSum.toFixed(1)}% (not 100%)`}
      >
        Σ {enabledSum.toFixed(0)}%
      </span>
    </div>
  )
}

// Simple hex-with-white blend. Accepts '#RRGGBB' (lowercase or upper).
function blendHexWithWhite(hex, pct) {
  if (typeof hex !== 'string' || !hex.startsWith('#') || hex.length !== 7) return hex
  const r = parseInt(hex.slice(1, 3), 16)
  const g = parseInt(hex.slice(3, 5), 16)
  const b = parseInt(hex.slice(5, 7), 16)
  const mix = (c) => Math.round(c + (255 - c) * pct)
  const rh = mix(r).toString(16).padStart(2, '0')
  const gh = mix(g).toString(16).padStart(2, '0')
  const bh = mix(b).toString(16).padStart(2, '0')
  return `#${rh}${gh}${bh}`
}
