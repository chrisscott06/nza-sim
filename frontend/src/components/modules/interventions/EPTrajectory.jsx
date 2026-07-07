/**
 * EPTrajectory.jsx — Brief 95 P7
 *
 * Cumulative-EUI trajectory with an EnergyPlus overlay. Two series over the same
 * x-axis (Baseline → each enabled measure, in strategy order):
 *   • NZA-Sim — solid line, filled dots (the existing engine's cumulative EUI)
 *   • EnergyPlus — dashed line, hollow dots, distinct colour (the EP re-run)
 *
 * NZA-Sim's own charts (EUIWaterfall etc.) are untouched — this is an ADDITIVE
 * overlay, per the P7 requirement that NZA-Sim's line stays unchanged. EP points
 * that are stale (config changed since the run) or never run are simply absent
 * from the EP series, so the overlay never draws a stale EP value as if current.
 */
const NZA = '#E84393'   // interventions accent (matches the rest of the module)
const EP = '#2563EB'    // blue — clearly distinct from NZA pink

function niceMax(raw) {
  if (!Number.isFinite(raw) || raw <= 0) return 1
  for (const step of [10, 20, 25, 50, 100, 200, 250, 500]) {
    if (raw / step <= 6) return Math.ceil(raw / step) * step
  }
  return Math.ceil(raw / 1000) * 1000
}

export default function EPTrajectory({ steps = [] }) {
  const withNza = steps.filter(s => Number.isFinite(s.nza))
  if (withNza.length < 1) {
    return <p className="text-xxs text-mid-grey/60 italic">Add interventions to see the cumulative trajectory.</p>
  }

  const pad = { top: 22, right: 16, bottom: 52, left: 44 }
  const colW = 96
  const innerH = 220
  const innerW = Math.max(1, steps.length - 1) * colW
  const totalW = pad.left + pad.right + innerW
  const totalH = pad.top + innerH + pad.bottom

  const allVals = steps.flatMap(s => [s.nza, s.ep].filter(Number.isFinite))
  const yMax = niceMax(Math.max(...allVals) * 1.1)
  const x = (i) => pad.left + (steps.length === 1 ? innerW / 2 : i * colW)
  const y = (v) => pad.top + innerH - innerH * (v / yMax)
  const ticks = [0, 0.25, 0.5, 0.75, 1].map(f => f * yMax)

  const line = (key) => steps
    .map((s, i) => (Number.isFinite(s[key]) ? `${x(i)},${y(s[key])}` : null))
    .filter(Boolean)
    .map((p, idx) => (idx === 0 ? `M ${p}` : `L ${p}`))
    .join(' ')

  return (
    <div className="rounded-xl border border-light-grey bg-white p-4 space-y-2">
      <div className="flex items-baseline justify-between">
        <p className="text-caption font-semibold text-navy">Cumulative EUI trajectory</p>
        <div className="flex items-center gap-3 text-xxs text-mid-grey">
          <span className="inline-flex items-center gap-1.5">
            <svg width="18" height="8"><line x1="0" y1="4" x2="18" y2="4" stroke={NZA} strokeWidth="2" /></svg>NZA-Sim
          </span>
          <span className="inline-flex items-center gap-1.5">
            <svg width="18" height="8"><line x1="0" y1="4" x2="18" y2="4" stroke={EP} strokeWidth="2" strokeDasharray="4 3" /></svg>EnergyPlus
          </span>
        </div>
      </div>
      <div className="overflow-x-auto">
        <svg width={totalW} height={totalH} role="img" aria-label="Cumulative EUI trajectory, NZA-Sim vs EnergyPlus">
          {ticks.map((t, i) => (
            <g key={i}>
              <line x1={pad.left} y1={y(t)} x2={pad.left + innerW} y2={y(t)} stroke="#E5E7EB" strokeWidth={1} />
              <text x={pad.left - 6} y={y(t) + 3} textAnchor="end" fontSize="10" fill="#6B7280">{t.toFixed(0)}</text>
            </g>
          ))}

          {/* EP first (behind NZA) */}
          <path d={line('ep')} fill="none" stroke={EP} strokeWidth={2} strokeDasharray="4 3" opacity={0.9} />
          <path d={line('nza')} fill="none" stroke={NZA} strokeWidth={2} />

          {steps.map((s, i) => (
            <g key={i}>
              {Number.isFinite(s.ep) && <circle cx={x(i)} cy={y(s.ep)} r={3.5} fill="white" stroke={EP} strokeWidth={1.5} />}
              {Number.isFinite(s.nza) && <circle cx={x(i)} cy={y(s.nza)} r={3.5} fill={NZA} />}
              <text x={x(i)} y={pad.top + innerH + 16} textAnchor="middle" fontSize="10" fill="#6B7280">
                {(s.label || '').length > 12 ? (s.label || '').slice(0, 11) + '…' : s.label}
                <title>{s.label}</title>
              </text>
            </g>
          ))}
        </svg>
      </div>
      <p className="text-xxs text-mid-grey/50 italic">
        NZA-Sim cumulative EUI (pink) with the EnergyPlus re-run overlaid (blue, dashed). EP points appear only where a
        fresh run exists for the current config — stale or un-run steps are omitted, never drawn as current.
      </p>
    </div>
  )
}
