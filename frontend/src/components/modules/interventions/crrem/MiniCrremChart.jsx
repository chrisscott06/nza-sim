/**
 * MiniCrremChart.jsx — Brief 89 (Brief C) Part 4: the simpler per-intervention
 * CRREM trajectory chart for the Library Isolated view.
 *
 * Single y-axis (carbon, kgCO₂e/m²·yr), three lines — CRREM target (dark navy),
 * baseline trajectory (grey, no intervention), post-intervention trajectory
 * (blue) — and the lifetime saving as the translucent band between baseline and
 * post. No misalignment marker (that's a strategy-level concept, design note
 * §"per-intervention view"). All carbon factors + CRREM targets via the
 * canonical helpers (Bible Rule 11).
 */
import {
  ComposedChart, Area, Line, XAxis, YAxis, Tooltip, ResponsiveContainer,
} from 'recharts'
import {
  carbonIntensityForYear, CRREM_ANALYSIS_START, CRREM_ANALYSIS_END,
} from '../../../../utils/lifetimeCarbon.js'
import { readCrremTarget } from '../../../../utils/carbonReads.js'

const TARGET = '#2B2A4C'   // CRREM target — dark navy (report palette)
const BASE   = '#94A3B8'   // baseline trajectory — grey
const POST   = '#3B82F6'   // post-intervention — blue
const r1 = n => (n == null || !Number.isFinite(n)) ? null : Math.round(n * 10) / 10

/**
 * @param baseFuels  { electricity, gas } baseline annual kWh (whole building)
 * @param postFuels  { electricity, gas } post-intervention annual kWh
 * @param gia        m²
 * @param pick       CRREM project pick (country/property/pathway)
 */
export default function MiniCrremChart({ baseFuels, postFuels, gia, pick }) {
  if (!(gia > 0)) return null
  const data = []
  for (let y = CRREM_ANALYSIS_START; y <= CRREM_ANALYSIS_END; y++) {
    const baseC = r1(carbonIntensityForYear(baseFuels, gia, y))
    const postC = r1(carbonIntensityForYear(postFuels, gia, y))
    const tgt   = r1(readCrremTarget(y, pick)?.carbon_kg_m2)
    data.push({ year: y, target: tgt, baseline: baseC, post: postC, saving: [postC, baseC] })
  }

  return (
    <div className="rounded-lg border border-light-grey/70 bg-white px-3 pt-2 pb-1">
      <div className="text-xxs uppercase tracking-wider text-mid-grey/70 font-semibold pb-1">
        Carbon trajectory · saving vs baseline (kgCO₂/m²·yr)
      </div>
      <ResponsiveContainer width="100%" height={150}>
        <ComposedChart data={data} margin={{ top: 6, right: 8, left: -18, bottom: 0 }}>
          <XAxis dataKey="year" tick={{ fontSize: 9, fill: '#95A5A6' }} ticks={[2025, 2030, 2035, 2040, 2045, 2050]} />
          <YAxis tick={{ fontSize: 9, fill: '#95A5A6' }} width={34} />
          <Tooltip
            contentStyle={{ fontSize: 11, borderRadius: 8, border: '1px solid #E5E7EB' }}
            formatter={(v, name) => [v == null ? '—' : `${v} kgCO₂/m²`, name]}
            labelFormatter={y => `Year ${y}`}
          />
          {/* lifetime saving band — translucent fill between post and baseline */}
          <Area dataKey="saving" stroke="none" fill={POST} fillOpacity={0.12} name="Saving" isAnimationActive={false} />
          <Line dataKey="target"   stroke={TARGET} strokeWidth={2} strokeDasharray="5 3" dot={false} name="CRREM target" isAnimationActive={false} />
          <Line dataKey="baseline" stroke={BASE}   strokeWidth={1.5} dot={false} name="Baseline" isAnimationActive={false} />
          <Line dataKey="post"     stroke={POST}   strokeWidth={2} dot={false} name="With measure" isAnimationActive={false} />
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  )
}
