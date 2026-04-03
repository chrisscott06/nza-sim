/**
 * GainsLossesChart.jsx
 *
 * Butterfly diagram reading from result.gains_losses.heating_side / cooling_side.
 *
 * Left of centre  → HEATING IMPACT
 *   Loss rows:  left bars only  (fabric losses that INCREASE heating demand)
 *   Gain rows:  left bars only  (gains × util_factor that REDUCE heating demand)
 *
 * Right of centre → COOLING IMPACT
 *   Gain rows:  right bars only (gains × cooling_fraction that DRIVE cooling demand)
 *   Free-cool:  small left bars (ventilation/infiltration that help reduce cooling)
 *
 * All values already in MWh from instantCalc gains_losses object.
 */

import { useState } from 'react'

// ── Facade label helper ───────────────────────────────────────────────────────
// F1=north (0°), F2=east (90°), F3=south (180°), F4=west (270°)
function facadeLabel(facadeNumber, orientationDeg) {
  const baseAngles = { 1: 0, 2: 90, 3: 180, 4: 270 }
  const trueAngle = (baseAngles[facadeNumber] + (orientationDeg ?? 0)) % 360
  const directions = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW']
  const compass = directions[Math.round(trueAngle / 45) % 8]
  return `F${facadeNumber} (${compass})`
}

// ── Layout constants ──────────────────────────────────────────────────────────
const ROW_H   = 13    // px per row
const BAR_MAX = 84    // max half-bar width (px)
const LABEL_W = 56    // central label column width (px)
const PAD_X   = 4
const TOTAL_W = PAD_X + BAR_MAX + LABEL_W + BAR_MAX + PAD_X   // 240px
const HEADER  = 18

// ── Colours ───────────────────────────────────────────────────────────────────
const C = {
  infiltration: '#9E9E9E',
  wall:         '#A1887F',
  ventilation:  '#06B6D4',
  glazing:      '#4FC3F7',
  roof:         '#8D6E63',
  floor:        '#6D4C41',
  solar:        '#F59E0B',
  solar_dim:    '#FDE68A',
  equipment:    '#64748B',
  lighting:     '#8B5CF6',
  people:       '#EC4899',
  sol_air:      '#BCAAA4',
}

// ── Row renderer ──────────────────────────────────────────────────────────────
function Row({ label, leftVal, rightVal, leftColor, rightColor, maxVal, y, note }) {
  const lw = maxVal > 0 ? Math.max(0, (leftVal  / maxVal) * BAR_MAX) : 0
  const rw = maxVal > 0 ? Math.max(0, (rightVal / maxVal) * BAR_MAX) : 0

  const lx    = PAD_X + BAR_MAX - lw
  const rx    = PAD_X + BAR_MAX + LABEL_W
  const barH  = ROW_H * 0.62
  const barY  = y - barH / 2
  const textY = y + 3.5

  return (
    <g>
      {lw > 0.5 && (
        <rect x={lx} y={barY} width={lw} height={barH} rx={1.5} fill={leftColor} opacity={0.9} />
      )}
      <text x={PAD_X + BAR_MAX + LABEL_W / 2} y={textY} textAnchor="middle" fontSize={6} fill="#58595B">
        {label}
      </text>
      {rw > 0.5 && (
        <rect x={rx} y={barY} width={rw} height={barH} rx={1.5} fill={rightColor ?? leftColor} opacity={0.9} />
      )}
    </g>
  )
}

// ── Section divider ───────────────────────────────────────────────────────────
function Divider({ y }) {
  return (
    <line
      x1={PAD_X + 8} y1={y} x2={TOTAL_W - PAD_X - 8} y2={y}
      stroke="#EBEBEB" strokeWidth={0.5}
    />
  )
}

// ── Main component ────────────────────────────────────────────────────────────
export default function GainsLossesChart({ result, orientation, onExpand }) {
  if (!result || result.gia_m2 === 0) return null

  const hs = result.gains_losses?.heating_side
  const cs = result.gains_losses?.cooling_side
  if (!hs || !cs) return null

  // Shorthand for compass-annotated solar row labels
  const fl1 = facadeLabel(1, orientation)  // north facade
  const fl2 = facadeLabel(2, orientation)  // east facade
  const fl3 = facadeLabel(3, orientation)  // south facade
  const fl4 = facadeLabel(4, orientation)  // west facade

  // ── Section A: Heating losses (left bars only) ────────────────────────────
  const LOSS_ROWS = [
    { id: 'infil', label: 'Infiltration', left: hs.infiltration,       color: C.infiltration },
    { id: 'walls', label: 'Walls',        left: hs.wall_conduction,    color: C.wall        },
    { id: 'vent',  label: 'Ventilation',  left: hs.ventilation,        color: C.ventilation },
    { id: 'glaz',  label: 'Glazing',      left: hs.glazing_conduction, color: C.glazing     },
    { id: 'roof',  label: 'Roof',         left: hs.roof_conduction,    color: C.roof        },
    { id: 'floor', label: 'Floor',        left: hs.floor_conduction,   color: C.floor       },
  ].filter(r => r.left > 0.01)

  // ── Section B: Gains — asymmetric left (heating offset) / right (cooling driver)
  const solarEWh = (hs.solar_east ?? 0) + (hs.solar_west ?? 0)
  const solarEWc = (cs.solar_east ?? 0) + (cs.solar_west ?? 0)

  const GAIN_ROWS = [
    {
      id: 'sol_s', label: `${fl3} solar`,
      left:  hs.solar_south ?? 0,  lc: C.solar,
      right: cs.solar_south ?? 0,  rc: C.solar,
    },
    {
      id: 'equip', label: 'Equipment',
      left:  hs.equipment ?? 0,    lc: C.equipment,
      right: cs.equipment ?? 0,    rc: C.equipment,
    },
    {
      id: 'light', label: 'Lighting',
      left:  hs.lighting ?? 0,     lc: C.lighting,
      right: cs.lighting ?? 0,     rc: C.lighting,
    },
    {
      id: 'people', label: 'People',
      left:  hs.people ?? 0,       lc: C.people,
      right: cs.people ?? 0,       rc: C.people,
    },
    {
      id: 'sol_ew', label: `${fl2.slice(0,2)}/${fl4.slice(0,2)} solar`,
      left:  solarEWh,              lc: C.solar_dim,
      right: solarEWc,              rc: C.solar_dim,
    },
    {
      id: 'sol_n', label: `${fl1} solar`,
      left:  hs.solar_north ?? 0,  lc: C.solar_dim,
      right: cs.solar_north ?? 0,  rc: C.solar_dim,
    },
    {
      id: 'sol_air', label: 'Sol-air',
      left:  (hs.wall_solar ?? 0) + (hs.roof_solar ?? 0),  lc: C.sol_air,
      right: 0,                                              rc: C.sol_air,
    },
  ].filter(r => r.left > 0.01 || r.right > 0.01)

  // ── Scale: single max across all values ───────────────────────────────────
  const allVals = [
    ...LOSS_ROWS.map(r => r.left),
    ...GAIN_ROWS.flatMap(r => [r.left, r.right]),
    cs.infiltration_cooling ?? 0,
    cs.ventilation_cooling  ?? 0,
  ]
  const maxVal = Math.max(...allVals, 1)

  // ── Dimensions ───────────────────────────────────────────────────────────
  const nLoss = LOSS_ROWS.length
  const nGain = GAIN_ROWS.length
  const SEP   = 5
  const TOTAL_H = HEADER + nLoss * ROW_H + SEP + nGain * ROW_H + 6
  const centerX = PAD_X + BAR_MAX + LABEL_W / 2

  const topLoss = LOSS_ROWS[0]
  const topGain = GAIN_ROWS[0]

  return (
    <div>
      <div className="flex items-center justify-between mb-1">
        <p className="text-xxs uppercase tracking-wider text-mid-grey">Gains &amp; Losses</p>
        <div className="flex items-center gap-2">
          <span className="text-xxs text-mid-grey">◄ Heating</span>
          <span className="text-xxs text-mid-grey">Cooling ►</span>
          {onExpand && (
            <button
              onClick={onExpand}
              className="text-xxs px-1.5 py-0.5 rounded bg-off-white border border-light-grey text-mid-grey hover:bg-light-grey transition-colors leading-none"
              title="Expand to Sankey view"
            >
              ↗
            </button>
          )}
        </div>
      </div>

      <svg width="100%" viewBox={`0 0 ${TOTAL_W} ${TOTAL_H}`} style={{ overflow: 'visible' }}>
        {/* Column headers */}
        <text x={PAD_X + BAR_MAX - 2} y={13} textAnchor="end"    fontSize={5.5} fill="#95A5A6" fontWeight="500">HEATING</text>
        <text x={PAD_X + BAR_MAX + LABEL_W / 2} y={13} textAnchor="middle" fontSize={5.5} fill="#95A5A6" fontWeight="500">ELEMENT</text>
        <text x={PAD_X + BAR_MAX + LABEL_W + 2} y={13} textAnchor="start"  fontSize={5.5} fill="#95A5A6" fontWeight="500">COOLING</text>

        {/* Centre dashed line */}
        <line x1={centerX} y1={HEADER - 2} x2={centerX} y2={TOTAL_H - 4}
          stroke="#D0D0D0" strokeWidth={0.5} strokeDasharray="2,2" />

        {/* Loss rows */}
        {LOSS_ROWS.map((r, i) => (
          <Row key={r.id} label={r.label}
            leftVal={r.left} rightVal={0}
            leftColor={r.color} rightColor={r.color}
            maxVal={maxVal}
            y={HEADER + i * ROW_H + ROW_H / 2}
          />
        ))}

        <Divider y={HEADER + nLoss * ROW_H + SEP / 2} />

        {/* Gain rows — asymmetric: left=heating offset (×0.75), right=cooling driver (×0.25) */}
        {GAIN_ROWS.map((r, i) => (
          <Row key={r.id} label={r.label}
            leftVal={r.left} rightVal={r.right}
            leftColor={r.lc} rightColor={r.rc}
            maxVal={maxVal}
            y={HEADER + nLoss * ROW_H + SEP + i * ROW_H + ROW_H / 2}
          />
        ))}

        {/* Value callout — largest loss */}
        {topLoss && (() => {
          const lw = (topLoss.left / maxVal) * BAR_MAX
          return (
            <text x={PAD_X + BAR_MAX - lw - 1} y={HEADER + ROW_H / 2 + 3.5}
              textAnchor="end" fontSize={5} fill="#777">
              {topLoss.left.toFixed(1)} MWh
            </text>
          )
        })()}

        {/* Value callout — largest gain (right bar) */}
        {topGain && topGain.right > 0.01 && (() => {
          const rw = (topGain.right / maxVal) * BAR_MAX
          const gy = HEADER + nLoss * ROW_H + SEP + ROW_H / 2
          return (
            <text x={PAD_X + BAR_MAX + LABEL_W + rw + 1} y={gy + 3.5}
              textAnchor="start" fontSize={5} fill="#777">
              {topGain.right.toFixed(1)} MWh
            </text>
          )
        })()}

      </svg>
    </div>
  )
}
