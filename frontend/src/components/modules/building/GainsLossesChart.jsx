/**
 * GainsLossesChart.jsx
 *
 * Sefaira-style butterfly diagram showing:
 *   LEFT  — heat losses (fabric, infiltration, ventilation) extending left from centre
 *   RIGHT — heat gains (solar by facade, internal gains) extending right from centre
 *
 * The same gains appear on BOTH sides:
 *   • On the left  → they REDUCE heating demand (heating offset, good)
 *   • On the right → they DRIVE cooling demand  (cooling driver, bad)
 *
 * All values normalised to MWh for display.
 * solar_gains from instantCalc are already in MWh (they were divided by 1000 in calc).
 * fabric_losses and internal_gains are in kWh → divide by 1000 here.
 */

// ── Constants ─────────────────────────────────────────────────────────────────

const ROW_H   = 13    // px per row
const BAR_MAX = 88    // max half-bar width (px)
const LABEL_W = 52    // central label column width (px)
const PAD_X   = 4
const TOTAL_W = PAD_X + BAR_MAX + LABEL_W + BAR_MAX + PAD_X  // 240px
const HEADER  = 20

// Colors: warm earth for losses, amber/yellow for solar, slate/purple for internal
const C = {
  infiltration: '#9E9E9E',
  wall:         '#A1887F',
  ventilation:  '#06B6D4',
  glazing:      '#4FC3F7',
  roof:         '#8D6E63',
  floor:        '#6D4C41',
  solar_s:      '#F59E0B',
  solar_ew:     '#FCD34D',
  solar_n:      '#FDE68A',
  equipment:    '#64748B',
  lighting:     '#8B5CF6',
  people:       '#EC4899',
}

// ── Row renderer ─────────────────────────────────────────────────────────────

function Row({ label, leftVal, rightVal, leftColor, rightColor, maxVal, y }) {
  const lw = maxVal > 0 ? (leftVal  / maxVal) * BAR_MAX : 0
  const rw = maxVal > 0 ? (rightVal / maxVal) * BAR_MAX : 0

  const lx = PAD_X + BAR_MAX - lw    // left bar starts here (extends to PAD_X+BAR_MAX)
  const rx = PAD_X + BAR_MAX + LABEL_W  // right bar starts here

  const barH  = ROW_H * 0.62
  const barY  = y - barH / 2
  const textY = y + 3.5

  return (
    <g>
      {/* Left bar */}
      {lw > 0.5 && (
        <rect x={lx} y={barY} width={lw} height={barH} rx={1.5} fill={leftColor} opacity={0.9} />
      )}
      {/* Label */}
      <text x={PAD_X + BAR_MAX + LABEL_W / 2} y={textY} textAnchor="middle" fontSize={6} fill="#58595B">
        {label}
      </text>
      {/* Right bar */}
      {rw > 0.5 && (
        <rect x={rx} y={barY} width={rw} height={barH} rx={1.5} fill={rightColor ?? leftColor} opacity={0.9} />
      )}
    </g>
  )
}

// ── Main component ─────────────────────────────────────────────────────────────

export default function GainsLossesChart({ result }) {
  if (!result || result.gia_m2 === 0) return null

  const fabric = result.fabric_losses   // values in kWh
  const solar  = result.solar_gains     // values already in MWh (named _kWh but are MWh)
  const ig     = result.internal_gains  // values in kWh

  // Normalise everything to MWh
  const f = kWh => kWh / 1000

  // ── Loss rows (left bar only, no right bar) ───────────────────────────────
  const LOSS_ROWS = [
    { id: 'infil', label: 'Infiltration', left: f(fabric.infiltration_kWh), color: C.infiltration },
    { id: 'walls', label: 'Walls',        left: f(fabric.walls_kWh),        color: C.wall        },
    { id: 'vent',  label: 'Ventilation',  left: f(fabric.ventilation_kWh),  color: C.ventilation },
    { id: 'glaz',  label: 'Glazing',      left: f(fabric.glazing_kWh),      color: C.glazing     },
    { id: 'roof',  label: 'Roof',         left: f(fabric.roof_kWh),         color: C.roof        },
    { id: 'floor', label: 'Floor',        left: f(fabric.floor_kWh),        color: C.floor       },
  ].filter(r => r.left > 0)

  // ── Gain rows (left bar = heating reduction, right bar = cooling driver) ──
  const ew = ((solar.east_kWh ?? 0) + (solar.west_kWh ?? 0)) / 2
  const GAIN_ROWS = [
    { id: 'sol_s',  label: 'S solar',   left: solar.south_kWh ?? 0, right: solar.south_kWh ?? 0, lc: C.solar_s,  rc: C.solar_s  },
    { id: 'equip',  label: 'Equipment', left: f(ig.equipment_kWh),  right: f(ig.equipment_kWh),  lc: C.equipment, rc: C.equipment },
    { id: 'light',  label: 'Lighting',  left: f(ig.lighting_kWh),   right: f(ig.lighting_kWh),   lc: C.lighting,  rc: C.lighting  },
    { id: 'people', label: 'People',    left: f(ig.people_kWh),     right: f(ig.people_kWh),     lc: C.people,    rc: C.people    },
    { id: 'sol_ew', label: 'E/W solar', left: ew,                   right: ew,                   lc: C.solar_ew,  rc: C.solar_ew  },
    { id: 'sol_n',  label: 'N solar',   left: solar.north_kWh ?? 0, right: solar.north_kWh ?? 0, lc: C.solar_n,   rc: C.solar_n   },
  ].filter(r => r.left > 0 || r.right > 0)

  // ── Scale: single max across all left and right values ────────────────────
  const allVals = [
    ...LOSS_ROWS.map(r => r.left),
    ...GAIN_ROWS.flatMap(r => [r.left, r.right]),
  ]
  const maxVal = Math.max(...allVals, 1)

  // ── SVG dimensions ────────────────────────────────────────────────────────
  const sepRowPad = 4   // extra gap between losses and gains section
  const totalRows = LOSS_ROWS.length + GAIN_ROWS.length
  const TOTAL_H = HEADER + LOSS_ROWS.length * ROW_H + sepRowPad + GAIN_ROWS.length * ROW_H + 6

  const centerX = PAD_X + BAR_MAX + LABEL_W / 2

  // ── Value labels for the largest bars ────────────────────────────────────
  const topLoss = LOSS_ROWS[0]
  const topGain = GAIN_ROWS[0]

  return (
    <div>
      <div className="flex items-center justify-between mb-1">
        <p className="text-xxs uppercase tracking-wider text-mid-grey">Gains &amp; Losses</p>
        <div className="flex gap-2">
          <span className="text-xxs text-mid-grey">◄ Heating</span>
          <span className="text-xxs text-mid-grey">Cooling ►</span>
        </div>
      </div>
      <svg width="100%" viewBox={`0 0 ${TOTAL_W} ${TOTAL_H}`} style={{ overflow: 'visible' }}>

        {/* Column headers */}
        <text x={PAD_X + BAR_MAX - 2} y={14} textAnchor="end"   fontSize={6} fill="#95A5A6" fontWeight="500">LOSSES</text>
        <text x={PAD_X + BAR_MAX + LABEL_W / 2} y={14} textAnchor="middle" fontSize={6} fill="#95A5A6" fontWeight="500">ELEMENT</text>
        <text x={PAD_X + BAR_MAX + LABEL_W + 2} y={14} textAnchor="start"  fontSize={6} fill="#95A5A6" fontWeight="500">GAINS</text>

        {/* Centre dashed line */}
        <line
          x1={centerX} y1={HEADER - 2}
          x2={centerX} y2={TOTAL_H - 4}
          stroke="#D0D0D0" strokeWidth={0.5} strokeDasharray="2,2"
        />

        {/* Loss rows */}
        {LOSS_ROWS.map((r, i) => (
          <Row
            key={r.id}
            label={r.label}
            leftVal={r.left}
            rightVal={0}
            leftColor={r.color}
            rightColor={r.color}
            maxVal={maxVal}
            y={HEADER + i * ROW_H + ROW_H / 2}
          />
        ))}

        {/* Separator line between losses and gains */}
        <line
          x1={PAD_X + 8}
          y1={HEADER + LOSS_ROWS.length * ROW_H + sepRowPad / 2}
          x2={TOTAL_W - PAD_X - 8}
          y2={HEADER + LOSS_ROWS.length * ROW_H + sepRowPad / 2}
          stroke="#EBEBEB" strokeWidth={0.5}
        />

        {/* Gain rows */}
        {GAIN_ROWS.map((r, i) => {
          const y = HEADER + LOSS_ROWS.length * ROW_H + sepRowPad + i * ROW_H + ROW_H / 2
          return (
            <Row
              key={r.id}
              label={r.label}
              leftVal={r.left}
              rightVal={r.right}
              leftColor={r.lc}
              rightColor={r.rc}
              maxVal={maxVal}
              y={y}
            />
          )
        })}

        {/* Value callout on largest loss bar */}
        {topLoss && (() => {
          const lw = (topLoss.left / maxVal) * BAR_MAX
          const barX = PAD_X + BAR_MAX - lw
          const y = HEADER + ROW_H / 2
          return (
            <text x={barX - 1} y={y + 3} textAnchor="end" fontSize={5.5} fill="#58595B">
              {Math.round(topLoss.left)} MWh
            </text>
          )
        })()}

        {/* Value callout on largest gain bar */}
        {topGain && (() => {
          const rw = (topGain.right / maxVal) * BAR_MAX
          const barX = PAD_X + BAR_MAX + LABEL_W + rw
          const y = HEADER + LOSS_ROWS.length * ROW_H + sepRowPad + ROW_H / 2
          return (
            <text x={barX + 1} y={y + 3} textAnchor="start" fontSize={5.5} fill="#58595B">
              {Math.round(topGain.right)} MWh
            </text>
          )
        })()}

      </svg>
    </div>
  )
}
