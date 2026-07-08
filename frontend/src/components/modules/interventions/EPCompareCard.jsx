/**
 * EPCompareCard.jsx — Brief 95 P7
 *
 * A NZA-Sim | EP | Δ% side-by-side table for one building STATE (baseline, an
 * isolated measure, or a cumulative-through step). Pure presentation — the caller
 * resolves the NZA numbers from its own engine result and the EP numbers from
 * `useEpResults`, and passes an `epStatus` ('fresh' | 'stale' | 'none') that drives
 * the stale-guard:
 *   - fresh → EP value + Δ% shown
 *   - stale → EP value greyed with a "stale — re-run" pill, Δ% suppressed (never
 *             present a stale number as if it matched the current config)
 *   - none  → em-dash (never run for this config)
 *
 * Δ% is EP relative to NZA-Sim: (EP − NZA) / NZA × 100 — "how far EP diverges from
 * NZA-Sim for this quantity". Sign kept; magnitude is the validation signal.
 */
const MUTED = '#9CA3AF'

function fmt(v, digits = 1) {
  if (v == null || !Number.isFinite(v)) return '—'
  return v.toFixed(digits)
}

function pctCell(nza, ep) {
  if (![nza, ep].every(Number.isFinite) || nza === 0) return <span className="text-mid-grey/40">—</span>
  const pct = ((ep - nza) / Math.abs(nza)) * 100
  const sign = pct < 0 ? '−' : '+'
  // Amber past ±25 %, red past ±50 % — a divergence cue, not a pass/fail gate.
  const mag = Math.abs(pct)
  const colour = mag >= 50 ? '#DC2626' : mag >= 25 ? '#D97706' : '#6B7280'
  return <span style={{ color: colour }} className="tabular-nums">{sign}{mag.toFixed(mag >= 10 ? 0 : 1)}%</span>
}

function StalePill() {
  return (
    <span className="ml-1.5 align-middle text-[9px] uppercase tracking-wider px-1 py-0.5 rounded bg-amber-100 text-amber-700">
      stale · re-run
    </span>
  )
}

/**
 * @param {string} title
 * @param {string} [subtitle]
 * @param {'fresh'|'stale'|'none'} epStatus  state-level EP status (drives the guard)
 * @param {Array<{label,nza,ep,unit,digits}>} rows
 * @param {boolean} [nzaOnly]  render the "NZA-Sim only" badge; EP columns disabled
 */
export default function EPCompareCard({ title, subtitle, epStatus = 'none', rows = [], nzaOnly = false }) {
  return (
    <div className="rounded-lg border border-light-grey/70 bg-white px-3 py-2">
      <div className="flex items-baseline gap-2 pb-1">
        <span className="text-xxs uppercase tracking-wider text-mid-grey/70 font-semibold">{title}</span>
        {subtitle ? <span className="text-xxs text-mid-grey/50">{subtitle}</span> : null}
        {nzaOnly ? (
          <span className="ml-auto text-[10px] text-mid-grey/70 border border-light-grey rounded px-1.5 py-0.5">
            NZA-Sim only · not modelled in EP
          </span>
        ) : epStatus === 'stale' ? <span className="ml-auto"><StalePill /></span> : null}
      </div>
      <table className="w-full text-xs">
        <thead>
          <tr className="text-xxs uppercase tracking-wider text-mid-grey/50">
            <th className="text-left font-semibold py-1 pr-3">Metric</th>
            <th className="text-right font-semibold py-1 px-2">NZA-Sim</th>
            <th className="text-right font-semibold py-1 px-2">EnergyPlus</th>
            <th className="text-right font-semibold py-1 pl-2">Δ%</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => {
            const showEp = !nzaOnly && epStatus !== 'none' && Number.isFinite(r.ep)
            const epColour = epStatus === 'stale' ? MUTED : '#1F2937'
            return (
              <tr key={r.label} className="border-t border-light-grey/40">
                <td className="py-1.5 pr-3 text-mid-grey">{r.label}</td>
                <td className="py-1.5 px-2 text-right tabular-nums text-navy">
                  {fmt(r.nza, r.digits ?? 1)} <span className="text-mid-grey/45 font-normal">{r.unit}</span>
                </td>
                <td className="py-1.5 px-2 text-right tabular-nums" style={{ color: showEp ? epColour : undefined }}>
                  {nzaOnly
                    ? <span className="text-mid-grey/40">n/a</span>
                    : showEp
                      ? <>{fmt(r.ep, r.digits ?? 1)} <span className="text-mid-grey/45 font-normal">{r.unit}</span></>
                      : <span className="text-mid-grey/40">—</span>}
                </td>
                <td className="py-1.5 pl-2 text-right tabular-nums">
                  {showEp && epStatus === 'fresh' ? pctCell(r.nza, r.ep) : <span className="text-mid-grey/40">—</span>}
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
      {epStatus === 'none' && !nzaOnly ? (
        <p className="text-xxs text-mid-grey/50 pt-1 italic">
          Not yet run in EnergyPlus for this config. Use “Validate with EnergyPlus” on the Strategy page.
        </p>
      ) : null}
    </div>
  )
}
