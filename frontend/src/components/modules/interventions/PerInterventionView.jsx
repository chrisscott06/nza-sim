/**
 * PerInterventionView.jsx — Brief 87 Part 4 (interventions UX rework)
 *
 * The new TWO-SECTION per-intervention view that replaces the six-tab
 * visualiser at the per-intervention level (design note §"Per-intervention
 * view"). Lives on the Library page.
 *
 *   Section 1 — Isolated impact (default, leads the page)
 *     Four headline cards + demand-by-service deltas. The isolated impact is
 *     this intervention run ALONE against the bare baseline (singleton stack —
 *     `useIsolatedResults`). No new engine work: consumes the existing
 *     `cumulative_delta` shape (interventionsEngine computeDelta).
 *       - Lifetime carbon saved  → placeholder ("TBD — Brief C")
 *       - £ per tonne CO2        → placeholder ("TBD — Brief B")
 *       - kWh saved / EUI Δ      → LIVE (engine isolated output)
 *       - Simple payback         → placeholder ("TBD — Brief B")
 *
 *   Section 2 — Calc Trail (UI-side diff, no engine trace mode)
 *     Narrates which inputs the patch changed → the resulting headline deltas.
 *     Per the brief, the preferred (engine-change-free) implementation is a
 *     UI-side diff: list the intervention's patches (inputs changed) and the
 *     non-zero headline deltas they produced. Shows only what changed.
 *
 * Engine: UNCHANGED. This is a pure consumer view (Brief 41 patches + Brief 71
 * isolated outputs rearranged).
 *
 * Demand-by-service is a properly-aligned table: each metric shows its Δ as an
 * absolute (MWh / tCO₂), an intensity (kWh/m² / kgCO₂/m²), and a % change — all
 * side-by-side under a header (both unit columns shown, so the global Per m² /
 * Total toggle isn't needed here). Conversions via the shared unitFmt helper.
 */
import { toDisplay, KIND, getGia } from './visualiser/unitFmt.js'

const SAVE_GREEN = '#16A34A'
const INCREASE_RED = '#DC2626'

function fmtSigned(value, digits = 1, suffix = '') {
  if (value == null || !Number.isFinite(value)) return '—'
  if (Math.abs(value) < 10 ** -digits / 2) return `0${suffix}`
  const sign = value < 0 ? '−' : '+'
  return `${sign}${Math.abs(value).toFixed(digits)}${suffix}`
}

function deltaColour(delta, { savingIsNegative = true } = {}) {
  if (delta == null || !Number.isFinite(delta) || Math.abs(delta) < 0.05) return '#6B7280'
  const isSaving = savingIsNegative ? delta < 0 : delta > 0
  return isSaving ? SAVE_GREEN : INCREASE_RED
}

/** A single headline card. `placeholder` renders the "TBD — Brief X" frame. */
function HeadlineCard({ title, value, sub, placeholder, accent }) {
  return (
    <div className="rounded-lg border border-light-grey/70 bg-white px-3 py-2.5 flex flex-col gap-0.5">
      <div className="text-xxs uppercase tracking-wider text-mid-grey/70 font-semibold">{title}</div>
      {placeholder ? (
        <>
          <div className="text-base font-semibold text-mid-grey/40 tabular-nums">TBD</div>
          <div className="text-xxs text-mid-grey/50">{placeholder}</div>
        </>
      ) : (
        <>
          <div className="text-lg font-semibold tabular-nums" style={{ color: accent ?? '#1F2937' }}>{value}</div>
          {sub ? <div className="text-xxs text-mid-grey/70 tabular-nums">{sub}</div> : null}
        </>
      )}
    </div>
  )
}

/**
 * One row of the demand-by-service table. `rec` is the engine delta record
 * { delta, delta_pct }. Renders the Δ as an absolute (Total) and an intensity
 * (Per m²) — `kind` selects the units (KIND.MWH energy → MWh / kWh/m²·yr;
 * KIND.KG_M2 carbon → tCO₂ / kgCO₂/m²·yr) — plus the % change. Saving (negative
 * for energy) is green, increase red. delta_pct is already a percentage.
 */
function DemandRow({ label, rec, kind = KIND.MWH, gia }) {
  const delta = rec?.delta
  const pct = rec?.delta_pct
  const has = Number.isFinite(delta)
  const abs = toDisplay(delta, kind, 'kwh', gia)         // Total: MWh / tCO₂
  const per = toDisplay(delta, kind, 'kwh_per_m2', gia)  // Per m²: kWh/m² / kgCO₂/m²
  const colour = has ? deltaColour(delta) : undefined
  const cell = (conv) => has
    ? <>{fmtSigned(conv.value, 1)} <span className="text-mid-grey/45 font-normal">{conv.label}</span></>
    : <span className="text-mid-grey/40">—</span>
  return (
    <tr className="border-t border-light-grey/40">
      <td className="py-1.5 pr-3 text-mid-grey">{label}</td>
      <td className="py-1.5 px-2 text-right tabular-nums" style={{ color: colour }}>{cell(abs)}</td>
      <td className="py-1.5 px-2 text-right tabular-nums" style={{ color: colour }}>{cell(per)}</td>
      <td className="py-1.5 pl-2 text-right tabular-nums text-mid-grey/70">
        {Number.isFinite(pct) && Math.abs(pct) >= 0.1 ? fmtSigned(pct, 0, '%') : '—'}
      </td>
    </tr>
  )
}

export default function PerInterventionView({ intervention, isolatedRow }) {
  const d = isolatedRow?.cumulativeDelta ?? null
  const gia = getGia(isolatedRow?.isolatedResult?.baseline)
  const patches = Array.isArray(intervention?.patches) ? intervention.patches : []

  const euiDelta = d?.eui_kwh_per_m2?.delta
  const totalDelta = d?.total_delivered_mwh?.delta
  const carbonDelta = d?.carbon_kgco2_per_m2?.delta

  return (
    <div className="flex flex-col gap-5 p-4 overflow-y-auto">
      {/* ── Section 1 — Isolated impact ─────────────────────────────── */}
      <section>
        <h3 className="text-xs uppercase tracking-wider font-semibold text-navy mb-2">
          Isolated impact
          <span className="ml-2 font-normal text-mid-grey/60 normal-case tracking-normal">
            this measure alone, vs the bare baseline
          </span>
        </h3>

        <div className="grid grid-cols-2 lg:grid-cols-4 gap-2 mb-3">
          <HeadlineCard title="Lifetime carbon saved" placeholder="TBD — Brief C (CRREM)" />
          <HeadlineCard title="£ / tonne CO₂" placeholder="TBD — Brief B (cost)" />
          <HeadlineCard
            title="kWh saved / EUI Δ"
            accent={deltaColour(euiDelta)}
            value={`${fmtSigned(euiDelta, 1)} kWh/m²`}
            sub={Number.isFinite(totalDelta) ? `${fmtSigned(totalDelta, 1)} MWh/yr total` : null}
          />
          <HeadlineCard title="Simple payback" placeholder="TBD — Brief B (cost)" />
        </div>

        <div className="rounded-lg border border-light-grey/70 bg-white px-3 py-2">
          <div className="text-xxs uppercase tracking-wider text-mid-grey/70 font-semibold pb-0.5">
            Demand by service (Δ vs baseline)
          </div>
          <table className="w-full text-xs">
            <thead>
              <tr className="text-xxs uppercase tracking-wider text-mid-grey/50">
                <th className="text-left font-semibold py-1 pr-3">Service</th>
                <th className="text-right font-semibold py-1 px-2">Total</th>
                <th className="text-right font-semibold py-1 px-2">Per m²</th>
                <th className="text-right font-semibold py-1 pl-2">Change</th>
              </tr>
            </thead>
            <tbody>
              <DemandRow label="Heating demand" rec={d?.heating_demand_mwh} gia={gia} />
              <DemandRow label="Cooling demand" rec={d?.cooling_demand_mwh} gia={gia} />
              <DemandRow label="DHW demand" rec={d?.per_service?.dhw ?? d?.dhw_demand_mwh} gia={gia} />
              <DemandRow label="Total annual energy" rec={d?.total_delivered_mwh} gia={gia} />
              <DemandRow label="Electricity" rec={d?.per_fuel?.electricity_mwh} gia={gia} />
              <DemandRow label="Gas" rec={d?.per_fuel?.gas_mwh} gia={gia} />
              <DemandRow label="Operational carbon (yr 1)" rec={d?.carbon_kgco2_per_m2} kind={KIND.KG_M2} gia={gia} />
            </tbody>
          </table>
        </div>
      </section>

      {/* ── Section 2 — Calc Trail (UI-side diff) ───────────────────── */}
      <section>
        <h3 className="text-xs uppercase tracking-wider font-semibold text-navy mb-2">
          Calc trail
          <span className="ml-2 font-normal text-mid-grey/60 normal-case tracking-normal">
            inputs this measure changed → resulting headline
          </span>
        </h3>

        {patches.length === 0 ? (
          <div className="text-xs text-mid-grey/60 italic">No input changes recorded for this intervention.</div>
        ) : (
          <div className="rounded-lg border border-light-grey/70 bg-white divide-y divide-light-grey/40">
            {patches.map((p) => (
              <div key={p.id ?? p.path} className="px-3 py-2 flex flex-col gap-0.5">
                <code className="text-xxs text-navy/80 break-all">{p.path}</code>
                <div className="text-xxs text-mid-grey">
                  <span className="uppercase tracking-wider text-mid-grey/50">{p.op}</span>
                  {' → '}
                  <span className="tabular-nums">{typeof p.value === 'object' ? JSON.stringify(p.value) : String(p.value)}</span>
                </div>
              </div>
            ))}
            <div className="px-3 py-2 bg-off-white/50">
              <div className="text-xxs uppercase tracking-wider text-mid-grey/50 mb-0.5">Resulting headline</div>
              <div className="text-xs tabular-nums" style={{ color: deltaColour(euiDelta) }}>
                EUI {fmtSigned(euiDelta, 1)} kWh/m² · {fmtSigned(totalDelta, 1)} MWh/yr · carbon {fmtSigned(carbonDelta, 1)} kgCO₂/m²
              </div>
            </div>
          </div>
        )}
        <p className="text-xxs text-mid-grey/50 mt-1.5">
          Shows only the fields this intervention changed. For the full building state, use the Building module's
          Heat&nbsp;Balance / Energy&nbsp;Flows views.
        </p>
      </section>
    </div>
  )
}
