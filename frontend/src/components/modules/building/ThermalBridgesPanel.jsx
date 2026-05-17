/**
 * ThermalBridgesPanel.jsx — Brief 28-IM-Polish Bug 2.1 / IA 3.4
 *
 * Left-column section in the Building module for the building-level
 * thermal-bridging configuration. Replaces the dead y-factor selector
 * that previously lived inside each construction-editor popout (which
 * wrote to library items but never affected project H_TB).
 *
 * Three modes (per `building_config.thermal_bridges.mode`):
 *   - `iso14683_auto` (default): show multiplier slider + read-only H_TB
 *      badge + collapsible per-junction breakdown
 *   - `manual_h_tb`: single number input (W/K) replaces the slider
 *   - `absent`: H_TB = 0; just a confirmation row
 *
 * Per-junction ψ values are DISPLAY-ONLY in V1 per Brief 28-IM-Polish §8
 * stuck-point fallback ("ψ values display-only V1, editable in V2"). The
 * lengths are auto-derived from geometry; ψ defaults from ISO 14683
 * Table A.2 via `thermalBridgesLibrary.js`.
 *
 * Engine consumption: `engineResult.losses_at_setpoint.thermal_bridging`
 * (carries `mode`, `multiplier`, `total_H_TB_W_per_K`, `junctions[]`).
 */

import { useContext, useState } from 'react'
import { ProjectContext } from '../../../context/ProjectContext.jsx'
import {
  JUNCTION_LABELS,
  ISO14683_DEFAULT_PSI,
  ORDERED_JUNCTION_TYPES,
} from '../../../data/thermalBridgesLibrary.js'

const BUILDING_ACCENT = '#A1887F'

const MODE_OPTIONS = [
  { value: 'iso14683_auto', label: 'ISO 14683 auto (recommended)' },
  { value: 'manual_h_tb',   label: 'Manual H_TB (W/K)' },
  { value: 'absent',        label: 'Absent (no TB modelled)' },
]

export default function ThermalBridgesPanel({ engineResult }) {
  const { params, updateParam } = useContext(ProjectContext)
  const [expanded, setExpanded] = useState(false)

  // Read the engine output for the live H_TB + per-junction breakdown.
  const tb = engineResult?.losses_at_setpoint?.thermal_bridging
  const engineMode = tb?.mode ?? 'iso14683_auto'
  const engineMultiplier = tb?.multiplier ?? 1.0
  const engineHTB = tb?.total_H_TB_W_per_K ?? 0
  const engineJunctions = Array.isArray(tb?.junctions) ? tb.junctions : []

  // Config state (writes back via updateParam).
  const cfg = params?.thermal_bridges ?? { mode: 'iso14683_auto', multiplier: 1.0 }
  const setMode = (mode) => {
    const next = { ...cfg, mode }
    if (mode === 'iso14683_auto' && next.multiplier == null) next.multiplier = 1.0
    if (mode === 'manual_h_tb' && next.h_tb_W_per_K == null) next.h_tb_W_per_K = engineHTB || 50
    updateParam('thermal_bridges', next)
  }
  const setMultiplier = (m) => updateParam('thermal_bridges', { ...cfg, mode: 'iso14683_auto', multiplier: m })
  const setHtbManual  = (v) => updateParam('thermal_bridges', { ...cfg, mode: 'manual_h_tb', h_tb_W_per_K: v })

  const currentMode       = cfg.mode ?? engineMode ?? 'iso14683_auto'
  const currentMultiplier = currentMode === 'iso14683_auto'
    ? Number(cfg.multiplier ?? engineMultiplier ?? 1.0)
    : 1.0

  return (
    <div className="mb-2">
      {/* Section header — same look as other CollapsibleSections */}
      <div
        className="w-full px-2.5 py-1.5 rounded text-left"
        style={{ backgroundColor: BUILDING_ACCENT }}
      >
        <span className="text-white text-xxs font-semibold uppercase tracking-wider">Thermal bridges</span>
        <span className="text-white/70 text-xxs ml-2 tabular-nums">→ H_TB = {engineHTB.toFixed(2)} W/K</span>
      </div>

      <div className="pt-2 pb-1 space-y-2">
        {/* Mode dropdown */}
        <div>
          <label className="text-xxs text-mid-grey block mb-0.5">Mode</label>
          <select
            value={currentMode}
            onChange={e => setMode(e.target.value)}
            className="w-full px-2 py-1 text-xxs text-navy border border-light-grey rounded bg-white focus:outline-none focus:border-teal cursor-pointer"
          >
            {MODE_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
          </select>
        </div>

        {/* Mode-specific controls */}
        {currentMode === 'iso14683_auto' && (
          <div>
            <div className="flex items-center justify-between mb-0.5">
              <label className="text-xxs text-mid-grey">Multiplier (× default ψ)</label>
              <span className="text-xxs text-navy tabular-nums">{currentMultiplier.toFixed(2)}×</span>
            </div>
            <input
              type="range" min={0.5} max={3.0} step={0.05}
              value={currentMultiplier}
              onChange={e => setMultiplier(parseFloat(e.target.value))}
              className="w-full h-[3px] accent-navy"
            />
            <div className="flex justify-between text-xxs text-mid-grey/80 mt-0.5 px-1">
              <span title="Certified detailing">0.5</span>
              <span title="Typical UK new build">1.0</span>
              <span title="Existing / poor detailing">2.0</span>
              <span title="Worst-case">3.0</span>
            </div>
          </div>
        )}

        {currentMode === 'manual_h_tb' && (
          <div>
            <label className="text-xxs text-mid-grey block mb-0.5">H_TB (W/K)</label>
            <input
              type="number" min={0} max={1000} step={1}
              value={Number(cfg.h_tb_W_per_K ?? engineHTB ?? 0)}
              onChange={e => setHtbManual(parseFloat(e.target.value))}
              className="w-full px-2 py-1 text-xxs text-navy border border-light-grey rounded tabular-nums focus:outline-none focus:border-teal"
            />
          </div>
        )}

        {currentMode === 'absent' && (
          <div className="text-xxs text-mid-grey italic">
            No thermal-bridging contribution. Building loses heat through fabric U-values only.
          </div>
        )}

        {/* Read-only H_TB row */}
        <div className="flex items-baseline justify-between text-xxs px-1 pt-1 border-t border-light-grey/60">
          <span className="text-mid-grey">→ H_TB (engine)</span>
          <span className="text-navy font-semibold tabular-nums">{engineHTB.toFixed(2)} W/K</span>
        </div>

        {/* Per-junction breakdown (collapsible; only meaningful for iso14683_auto) */}
        {currentMode === 'iso14683_auto' && engineJunctions.length > 0 && (
          <div>
            <button
              onClick={() => setExpanded(e => !e)}
              className="text-xxs text-mid-grey hover:text-navy underline w-full text-left"
            >
              {expanded ? '▾' : '▸'} Per-junction breakdown ({engineJunctions.length})
            </button>
            {expanded && (
              <div className="mt-1 border border-light-grey rounded overflow-hidden">
                <table className="w-full text-xxs">
                  <thead className="bg-off-white">
                    <tr className="text-mid-grey">
                      <th className="text-left  py-1 px-1.5 font-medium">Junction</th>
                      <th className="text-right py-1 px-1.5 font-medium">L (m)</th>
                      <th className="text-right py-1 px-1.5 font-medium">ψ (W/m·K)</th>
                      <th className="text-right py-1 px-1.5 font-medium">→ W/K</th>
                    </tr>
                  </thead>
                  <tbody>
                    {ORDERED_JUNCTION_TYPES.map(type => {
                      const j = engineJunctions.find(x => x.type === type)
                      if (!j) return null
                      const psi_default = ISO14683_DEFAULT_PSI[type]
                      const label = JUNCTION_LABELS[type] ?? type
                      return (
                        <tr key={type} className="border-t border-light-grey/60">
                          <td className="py-1 px-1.5 text-navy">{label}</td>
                          <td className="py-1 px-1.5 text-right tabular-nums text-navy">{j.length_m?.toFixed(1) ?? '—'}</td>
                          <td className="py-1 px-1.5 text-right tabular-nums text-mid-grey" title={`Default ${psi_default} W/m·K × multiplier ${currentMultiplier.toFixed(2)}`}>
                            {psi_default.toFixed(2)}
                          </td>
                          <td className="py-1 px-1.5 text-right tabular-nums text-navy">{j.contribution_W_per_K?.toFixed(2) ?? '—'}</td>
                        </tr>
                      )
                    })}
                    <tr className="border-t-2 border-light-grey bg-off-white">
                      <td className="py-1 px-1.5 font-semibold text-navy" colSpan={3}>Σ total H_TB</td>
                      <td className="py-1 px-1.5 text-right tabular-nums font-semibold text-navy">{engineHTB.toFixed(2)}</td>
                    </tr>
                  </tbody>
                </table>
                <p className="text-xxs text-mid-grey/80 italic px-2 py-1 border-t border-light-grey">
                  ψ defaults from ISO 14683 Table A.2. Multiplier applies uniformly across junctions.
                  Per-ψ editing queued for a follow-up (Brief 28-IM-Polish §8 fallback).
                </p>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
