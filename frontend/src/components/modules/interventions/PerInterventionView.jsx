/**
 * PerInterventionView.jsx — Brief 87 Part 4, redesigned in Brief 97 P3
 * (Interventions Studio).
 *
 * The per-intervention isolated view on the Library page. Brief 97 replaces the
 * long grey scroll with a TABBED workspace — one focused view at a time:
 *
 *   Impact  — the four headline cards (lifetime carbon, £/tCO₂e, kWh/EUI Δ,
 *             payback) + EP validation card + a compact calc-trail (which inputs
 *             this measure changed → resulting headline). Semantic colour.
 *   Carbon  — the CRREM trajectory chart alone, breathing.
 *   Demand  — the demand-by-service Δ table, green/red by sign, bold totals.
 *   Cost    — a summary of the intervention's cost plan (total + range + counts)
 *             with an "Edit cost plan →" button that opens the pop-out editor
 *             (Brief 97 P5). No inline editing here.
 *
 * Colour comes from the shared semanticColour helper (Brief 97 P2): savings green,
 * increases red, totals bold navy, grey demoted to labels. Engine UNCHANGED — this
 * is a pure consumer view (Brief 41 patches + Brief 71 isolated outputs).
 */
import { useState } from 'react'
import { toDisplay, KIND, getGia } from './visualiser/unitFmt.js'
import {
  computeLifetimeCarbon, perFuelFromDeltaRecord, defaultLifetimeYears,
} from '../../../utils/lifetimeCarbon.js'
import MiniCrremChart from './crrem/MiniCrremChart.jsx'
import EPCompareCard from './EPCompareCard.jsx'
import {
  emptyCost, computeCostTotal, computeLinesTotal, computeAnnualOperationalSaving,
  computeSimplePayback, computePoundsPerTonne,
} from '../../../utils/costModel.js'
import { SEMANTIC, deltaColour } from './semanticColour.js'

const ACCENT = '#E84393'   // interventions module accent (kept per Brief 97)

const TABS = [
  ['impact', 'Impact'],
  ['carbon', 'Carbon'],
  ['demand', 'Demand'],
  ['cost',   'Cost'],
]

function fmtSigned(value, digits = 1, suffix = '') {
  if (value == null || !Number.isFinite(value)) return '—'
  if (Math.abs(value) < 10 ** -digits / 2) return `0${suffix}`
  const sign = value < 0 ? '−' : '+'
  return `${sign}${Math.abs(value).toFixed(digits)}${suffix}`
}

const gbp0 = n => `£${Math.round(Number(n) || 0).toLocaleString('en-GB')}`

/** A single headline card. `placeholder` renders the muted "TBD" frame. */
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
          <div className="text-lg font-semibold tabular-nums" style={{ color: accent ?? SEMANTIC.heading }}>{value}</div>
          {sub ? <div className="text-xxs text-mid-grey/70 tabular-nums">{sub}</div> : null}
        </>
      )}
    </div>
  )
}

/**
 * One row of the demand-by-service table. `rec` is the engine delta record
 * { delta, delta_pct }. Δ as absolute (Total) + intensity (Per m²) via `kind`,
 * plus the % change. Saving (negative for energy) green, increase red.
 */
function DemandRow({ label, rec, kind = KIND.MWH, gia }) {
  const delta = rec?.delta
  const pct = rec?.delta_pct
  const has = Number.isFinite(delta)
  const abs = toDisplay(delta, kind, 'kwh', gia)
  const per = toDisplay(delta, kind, 'kwh_per_m2', gia)
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

/** Compact calc-trail: which inputs this measure changed → resulting headline. */
function CalcTrail({ patches, euiDelta, totalDelta, carbonDelta }) {
  return (
    <div>
      <div className="text-xxs uppercase tracking-wider text-mid-grey/60 font-semibold mb-1.5">
        Calc trail
        <span className="ml-2 font-normal text-mid-grey/50 normal-case tracking-normal">inputs changed → headline</span>
      </div>
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
    </div>
  )
}

/** Cost tab — a read-only summary of the plan; editing happens in the pop-out. */
function CostSummary({ cost, costTotal, linesTotal, poundsPerTonne, onEdit }) {
  const groups = Array.isArray(cost?.groups) ? cost.groups : []
  const lineCount = groups.reduce((s, g) => s + (Array.isArray(g.lines) ? g.lines.length : 0), 0)
  const hasPlan = groups.length > 0
  return (
    <div className="rounded-lg border border-light-grey/70 bg-white px-4 py-3.5 flex flex-col gap-3">
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="text-xxs uppercase tracking-wider text-mid-grey/70 font-semibold">Total cost plan</div>
          <div className="text-2xl font-semibold tabular-nums mt-0.5" style={{ color: SEMANTIC.cost }}>
            {hasPlan ? gbp0(costTotal) : '—'}
          </div>
          {hasPlan && (
            <div className="text-xxs text-mid-grey/70 mt-0.5">
              works {gbp0(linesTotal)} + on-costs · {groups.length} group{groups.length === 1 ? '' : 's'} · {lineCount} line{lineCount === 1 ? '' : 's'}
            </div>
          )}
          {hasPlan && poundsPerTonne != null && (
            <div className="text-xxs text-mid-grey/70 mt-0.5 tabular-nums">{gbp0(poundsPerTonne)} / tonne CO₂ over lifetime</div>
          )}
        </div>
        <button
          type="button"
          onClick={onEdit}
          className="flex-shrink-0 px-3 py-1.5 rounded-lg text-xs font-semibold text-white transition-colors"
          style={{ backgroundColor: ACCENT }}
        >
          {hasPlan ? 'Edit cost plan →' : 'Build cost plan →'}
        </button>
      </div>
      {!hasPlan && (
        <div className="text-xs text-mid-grey/60 italic border-t border-light-grey/40 pt-2">
          No cost plan yet. Open the editor to build a line-item RICS/NRM2 cost plan (seeded from HIEX benchmark rates).
        </div>
      )}
      {cost?.notes ? (
        <div className="text-xxs text-mid-grey/70 border-t border-light-grey/40 pt-2 whitespace-pre-wrap">{cost.notes}</div>
      ) : null}
    </div>
  )
}

export default function PerInterventionView({ intervention, isolatedRow, crremPick, projectCostDefaults, onCostChange, onEditCost, epIso, epBaseline, epNzaOnly = false }) {
  const [tab, setTab] = useState('impact')
  const d = isolatedRow?.cumulativeDelta ?? null
  const gia = getGia(isolatedRow?.isolatedResult?.baseline)
  const patches = Array.isArray(intervention?.patches) ? intervention.patches : []

  // Brief 97 follow-up — the BASELINE reference ("where we're working from"): the
  // bare-baseline absolute state, NZA-Sim vs EnergyPlus, shown in grey above the
  // isolated impact so every delta is read against a visible starting point. Baseline
  // NZA absolutes are the delta record's `.from` (same bare baseline for every
  // measure); baseline EP comes from the cached `baseline` state.
  const epBaseRes = epBaseline?.result
  const baselineRows = [
    { label: 'EUI', unit: 'kWh/m²', nza: d?.eui_kwh_per_m2?.from, ep: epBaseRes?.eui_kwh_per_m2_yr, digits: 1 },
    { label: 'Heating demand', unit: 'MWh', nza: d?.heating_demand_mwh?.from, ep: epBaseRes?.demand_mwh?.space_heating, digits: 1 },
    { label: 'Cooling demand', unit: 'MWh', nza: d?.cooling_demand_mwh?.from, ep: epBaseRes?.demand_mwh?.space_cooling, digits: 1 },
    { label: 'Operational carbon', unit: 'kgCO₂/m²', nza: d?.carbon_kgco2_per_m2?.from, ep: undefined, digits: 1 },
  ]

  // Brief 95 P7 — isolated EP comparison (this measure alone vs the bare baseline).
  const epRes = epIso?.result
  const epRows = [
    { label: 'EUI', unit: 'kWh/m²', nza: d?.eui_kwh_per_m2?.to, ep: epRes?.eui_kwh_per_m2_yr, digits: 1 },
    { label: 'Heating demand', unit: 'MWh', nza: d?.heating_demand_mwh?.to, ep: epRes?.demand_mwh?.space_heating, digits: 1 },
    { label: 'Cooling demand', unit: 'MWh', nza: d?.cooling_demand_mwh?.to, ep: epRes?.demand_mwh?.space_cooling, digits: 1 },
  ]

  const euiDelta = d?.eui_kwh_per_m2?.delta
  const totalDelta = d?.total_delivered_mwh?.delta
  const carbonDelta = d?.carbon_kgco2_per_m2?.delta

  // Brief 89 (Brief C): lifetime carbon saved, fuel-switching aware.
  const perFuel = perFuelFromDeltaRecord(d?.per_fuel)
  const lifetimeYears = intervention?.lifetime_years
    ?? defaultLifetimeYears(intervention?.theme ?? intervention?.category)
  const hasFuel = gia > 0 && Object.keys(perFuel).length > 0
  const lifetime = hasFuel ? computeLifetimeCarbon(perFuel, { lifetimeYears }) : null
  const lifeTco2e = lifetime?.lifetime_carbon_saved_tco2e
  const baseFuels = {}, postFuels = {}
  for (const [f, v] of Object.entries(perFuel)) { baseFuels[f] = v.from_kwh; postFuels[f] = v.to_kwh }

  // Cost → £/tonne + simple payback. Line-item plan shape (migrate-on-read guarantees it).
  const cost = intervention?.cost ?? emptyCost()
  const costTotal = computeCostTotal(cost, projectCostDefaults)
  const linesTotal = computeLinesTotal(cost)
  const annualSaving = computeAnnualOperationalSaving(d?.per_fuel, projectCostDefaults)
  const poundsPerTonne = costTotal > 0 && Number.isFinite(lifeTco2e) ? computePoundsPerTonne(costTotal, lifeTco2e) : null
  const payback = costTotal > 0 ? computeSimplePayback(costTotal, annualSaving) : null

  return (
    <div className="h-full flex flex-col">
      {/* Header */}
      <div className="flex-shrink-0 px-4 pt-4 pb-2">
        <h3 className="text-xs uppercase tracking-wider font-semibold text-navy">
          Isolated impact
          <span className="ml-2 font-normal text-mid-grey/60 normal-case tracking-normal">
            this measure alone, vs the bare baseline
          </span>
        </h3>
      </div>

      {/* Tab bar (matches the Strategy right-panel pattern) */}
      <div className="flex-shrink-0 flex items-center gap-1 px-4 border-b border-light-grey bg-white">
        {TABS.map(([id, label]) => (
          <button
            key={id}
            type="button"
            onClick={() => setTab(id)}
            className={`px-3 py-2 text-xs font-semibold border-b-2 -mb-px transition-colors ${
              tab === id ? '' : 'text-mid-grey border-transparent hover:text-navy'
            }`}
            style={tab === id ? { borderColor: ACCENT, color: ACCENT } : undefined}
          >
            {label}
          </button>
        ))}
      </div>

      {/* Tab content */}
      <div className="flex-1 min-h-0 overflow-auto p-4">
        {tab === 'impact' && (
          <div className="flex flex-col gap-3">
            {/* Baseline reference — where we're working from (NZA-Sim vs EnergyPlus) */}
            <div className="rounded-lg border border-light-grey/70 bg-off-white/40 px-1 py-0.5">
              <EPCompareCard
                title="Baseline · where we're working from"
                subtitle="the starting point, before this measure"
                epStatus={epBaseline?.status ?? 'none'}
                rows={baselineRows}
              />
            </div>

            <div className="grid grid-cols-2 lg:grid-cols-4 gap-2">
              {Number.isFinite(lifeTco2e) ? (
                <HeadlineCard
                  title="Lifetime carbon saved"
                  accent={deltaColour(lifeTco2e, { savingIsNegative: false })}
                  value={`${fmtSigned(lifeTco2e, 1)} tCO₂e`}
                  sub={`by 2050 · ${lifetimeYears}y life`}
                />
              ) : (
                <HeadlineCard title="Lifetime carbon saved" placeholder="no fuel delta" />
              )}
              {costTotal > 0 ? (
                <HeadlineCard
                  title="£ / tonne CO₂"
                  value={poundsPerTonne != null ? gbp0(poundsPerTonne) : '—'}
                  sub={poundsPerTonne != null ? `${gbp0(costTotal)} total cost` : 'no lifetime carbon saving'}
                />
              ) : (
                <HeadlineCard title="£ / tonne CO₂" placeholder="add a cost plan" />
              )}
              <HeadlineCard
                title="kWh saved / EUI Δ"
                accent={deltaColour(euiDelta)}
                value={`${fmtSigned(euiDelta, 1)} kWh/m²`}
                sub={Number.isFinite(totalDelta) ? `${fmtSigned(totalDelta, 1)} MWh/yr total` : null}
              />
              {costTotal > 0 ? (
                <HeadlineCard
                  title="Simple payback"
                  value={payback == null ? 'Never' : payback >= 999 ? '999+ yr' : `${payback.toFixed(1)} yr`}
                  sub={annualSaving > 0 ? `${gbp0(annualSaving)}/yr saved` : 'no operational £ saving'}
                />
              ) : (
                <HeadlineCard title="Simple payback" placeholder="add a cost plan" />
              )}
            </div>

            {/* EnergyPlus side-by-side for the isolated state (empty-state preserved) */}
            <EPCompareCard
              title="EnergyPlus validation"
              subtitle="this measure alone · absolute state values"
              epStatus={epNzaOnly ? 'none' : (epIso?.status ?? 'none')}
              nzaOnly={epNzaOnly}
              rows={epRows}
            />

            <CalcTrail patches={patches} euiDelta={euiDelta} totalDelta={totalDelta} carbonDelta={carbonDelta} />
          </div>
        )}

        {tab === 'carbon' && (
          hasFuel ? (
            <MiniCrremChart baseFuels={baseFuels} postFuels={postFuels} gia={gia} pick={crremPick} />
          ) : (
            <div className="text-xs text-mid-grey/60 italic py-8 text-center">
              No fuel-level delta for this measure — nothing to plot against the CRREM trajectory.
            </div>
          )
        )}

        {tab === 'demand' && (
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
        )}

        {tab === 'cost' && (
          <CostSummary
            cost={cost}
            costTotal={costTotal}
            linesTotal={linesTotal}
            poundsPerTonne={poundsPerTonne}
            onEdit={() => onEditCost?.(intervention)}
          />
        )}
      </div>
    </div>
  )
}
