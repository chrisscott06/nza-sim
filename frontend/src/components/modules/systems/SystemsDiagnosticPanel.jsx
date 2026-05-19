/**
 * SystemsDiagnosticPanel.jsx — Brief 40 Part 3 (2026-05-19)
 *
 * Comfort-vs-setpoint diagnostic summary table. Reads
 * `consumption.brief40.{service}` from the engine output and surfaces:
 *
 *   - Per-service: demand at comfort vs delivered at setpoint vs delta
 *   - DHW: tap-mix delta (delivered_no_mix vs demand_at_comfort)
 *   - Per-system drill-down when a row has a non-zero delta (expandable)
 *
 * Audit doc §5 (diagnostic mathematics) + brief Part 3 step 3.7.
 *
 * Renders nothing when `consumption.brief40` is null (pre-Brief-40 path).
 */

import { useState } from 'react'
import { SERVICE_COLOURS } from './SystemEditorCard.jsx'

const SERVICE_LABELS = {
  heating:     'Heating',
  cooling:     'Cooling',
  dhw:         'DHW',
  ventilation: 'Ventilation',
  lighting:    'Lighting',
  small_power: 'Small power',
}

function fmtMwh(x) {
  if (typeof x !== 'number') return '—'
  return Math.abs(x) < 0.05 ? '0' : x.toFixed(1)
}

function fmtPct(x) {
  if (typeof x !== 'number') return '—'
  return `${x > 0 ? '+' : ''}${x.toFixed(1)}%`
}

function deltaCellColour(deltaMwh) {
  if (typeof deltaMwh !== 'number' || Math.abs(deltaMwh) < 0.1) return 'text-mid-grey'
  return deltaMwh > 0 ? 'text-amber-700' : 'text-cyan-700'
}

export default function SystemsDiagnosticPanel({ consumption }) {
  const brief40 = consumption?.brief40
  const [expanded, setExpanded] = useState({})

  if (!brief40) {
    return (
      <div className="p-3 text-xxs text-mid-grey">
        Comfort-vs-setpoint diagnostic available once `systems_config_v40` is populated (Brief 40 Part 5 migration writes this on Bridgewater).
      </div>
    )
  }

  // Per-service rows — only show services that have systems configured
  const rows = []

  for (const service of ['heating', 'cooling', 'dhw', 'ventilation', 'lighting', 'small_power']) {
    const block = brief40[service]
    if (!block || (Array.isArray(block.systems) && block.systems.length === 0)) continue

    if (service === 'heating' || service === 'cooling') {
      const demand    = block.demand_at_comfort_mwh ?? 0
      const delivered = block.delivered_total_mwh ?? 0
      const delta     = delivered - demand
      const pct       = demand > 0 ? (delta / demand) * 100 : 0
      rows.push({ service, demand, delivered, delta, pct, systems: block.systems ?? [] })
    } else if (service === 'dhw') {
      const demand    = block.demand_at_comfort_mwh ?? 0
      const delivered = block.delivered_total_mwh ?? 0
      // DHW diagnostic is the "no-tap-mix" delta from §5.2
      const diagDelta = block.diagnostic?.delta_mwh ?? 0
      const diagPct   = block.diagnostic?.delta_pct ?? 0
      rows.push({
        service, demand, delivered,
        delta: diagDelta,
        pct: diagPct,
        systems: block.systems ?? [],
        dhwNote: `tap-mix correction in effect (${((block.hot_fraction ?? 0) * 100).toFixed(0)}% hot fraction)`,
      })
    } else {
      // Ventilation / lighting / small_power — no comfort-vs-setpoint, just total
      const delivered = block.total_fan_electrical_mwh ?? block.total_delivered_electrical_mwh ?? 0
      rows.push({ service, demand: null, delivered, delta: null, pct: null, systems: block.systems ?? [] })
    }
  }

  if (rows.length === 0) {
    return (
      <div className="p-3 text-xxs text-mid-grey">
        No systems configured yet. Add systems in the left panel to see the comfort-vs-setpoint diagnostic.
      </div>
    )
  }

  const totals = brief40.totals ?? null

  return (
    <div className="p-3 space-y-3">
      <div>
        <p className="text-caption font-semibold text-navy mb-1">Comfort vs setpoint diagnostic</p>
        <p className="text-xxs text-mid-grey leading-tight max-w-2xl">
          Demand at the homepage comfort band setpoint vs delivered at each
          system's configured setpoint. Positive Δ means the system delivers more
          than the building strictly needs at comfort (overdelivery); negative Δ
          means underdelivery. DHW row shows the no-tap-mix delta — what the
          building would deliver without thermostatic mixing.
        </p>
      </div>

      <div className="border border-light-grey rounded overflow-hidden">
        <table className="w-full text-xxs">
          <thead className="bg-off-white">
            <tr className="text-left">
              <th className="px-2 py-1.5 text-mid-grey font-medium">Service</th>
              <th className="px-2 py-1.5 text-mid-grey font-medium text-right">Demand</th>
              <th className="px-2 py-1.5 text-mid-grey font-medium text-right">Delivered</th>
              <th className="px-2 py-1.5 text-mid-grey font-medium text-right">Δ</th>
              <th className="px-2 py-1.5 text-mid-grey font-medium text-right">% over</th>
              <th className="px-2 py-1.5 w-6"></th>
            </tr>
          </thead>
          <tbody>
            {rows.map(row => {
              const isExpanded = !!expanded[row.service]
              const hasSystems = row.systems.length > 0
              return (
                <Fragment key={row.service}>
                  <tr
                    className={`border-t border-light-grey ${hasSystems ? 'hover:bg-off-white/50 cursor-pointer' : ''}`}
                    onClick={hasSystems ? () => setExpanded(e => ({ ...e, [row.service]: !e[row.service] })) : undefined}
                  >
                    <td className="px-2 py-1.5">
                      <span className="flex items-center gap-1.5">
                        <span className="w-2 h-2 rounded-full" style={{ backgroundColor: SERVICE_COLOURS[row.service] }} />
                        <span className="text-navy">{SERVICE_LABELS[row.service]}</span>
                      </span>
                    </td>
                    <td className="px-2 py-1.5 text-right tabular-nums text-navy">
                      {row.demand != null ? `${fmtMwh(row.demand)} MWh` : '—'}
                    </td>
                    <td className="px-2 py-1.5 text-right tabular-nums text-navy">{fmtMwh(row.delivered)} MWh</td>
                    <td className={`px-2 py-1.5 text-right tabular-nums ${deltaCellColour(row.delta)}`}>
                      {row.delta != null ? `${row.delta > 0 ? '+' : ''}${fmtMwh(row.delta)} MWh` : '—'}
                    </td>
                    <td className={`px-2 py-1.5 text-right tabular-nums ${deltaCellColour(row.delta)}`}>
                      {row.pct != null ? fmtPct(row.pct) : '—'}
                    </td>
                    <td className="px-2 py-1.5 text-right text-mid-grey">
                      {hasSystems ? (isExpanded ? '▴' : '▾') : ''}
                    </td>
                  </tr>
                  {row.dhwNote && (
                    <tr className="border-t border-light-grey/50">
                      <td colSpan={6} className="px-2 py-1 text-xxs text-mid-grey/80 bg-off-white/30">
                        {row.dhwNote}
                      </td>
                    </tr>
                  )}
                  {isExpanded && hasSystems && (
                    <tr className="bg-off-white/40">
                      <td colSpan={6} className="px-2 py-1.5">
                        <PerSystemBreakdown service={row.service} systems={row.systems} />
                      </td>
                    </tr>
                  )}
                </Fragment>
              )
            })}
          </tbody>
        </table>
      </div>

      {/* Totals roll-up */}
      {totals && (
        <div>
          <p className="text-xxs uppercase tracking-wider text-mid-grey mb-1">Totals</p>
          <div className="grid grid-cols-3 gap-2 text-xxs">
            <Stat label="EUI"    value={`${totals.eui_kWh_per_m2 ?? 0} kWh/m²`} />
            <Stat label="Source" value={`${((totals.annual_source_kWh ?? 0) / 1000).toFixed(1)} MWh`} />
            <Stat label="Carbon" value={`${totals.carbon_kgCO2_per_m2 ?? 0} kgCO₂/m²`} />
          </div>
          {totals.fuel_split && (
            <div className="mt-2">
              <p className="text-xxs uppercase tracking-wider text-mid-grey mb-1">Fuel split</p>
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 text-xxs">
                {Object.entries(totals.fuel_split)
                  .filter(([, kwh]) => kwh > 0)
                  .map(([fuel, kwh]) => (
                    <Stat key={fuel} label={fuel.replace(/_kWh$/, '').replace(/_/g, ' ')} value={`${(kwh / 1000).toFixed(1)} MWh`} />
                  ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

// React.Fragment shorthand without importing — local alias
function Fragment({ children }) { return <>{children}</> }

function Stat({ label, value }) {
  return (
    <div className="px-2 py-1 bg-off-white rounded">
      <p className="text-mid-grey">{label}</p>
      <p className="text-navy font-semibold tabular-nums">{value}</p>
    </div>
  )
}

function PerSystemBreakdown({ service, systems }) {
  const accent = SERVICE_COLOURS[service]
  return (
    <div className="space-y-1">
      {systems.map((sys, i) => (
        <div key={sys.id ?? i} className="flex items-center gap-2 text-xxs">
          <span className="w-1.5 h-1.5 rounded-full flex-shrink-0" style={{ backgroundColor: accent }} />
          <span className="text-navy w-32 truncate">{sys.label ?? `system ${i + 1}`}</span>
          <span className="text-mid-grey">{sys.share_pct}%</span>
          {service === 'heating' || service === 'cooling' ? (
            <>
              <span className="text-mid-grey">
                {sys.setpoint != null ? `${sys.setpoint}°C` : 'comfort'}
              </span>
              <span className="text-navy tabular-nums">{fmtMwh(sys.delivered_mwh)} MWh</span>
              {typeof sys.delta_vs_comfort_mwh === 'number' && Math.abs(sys.delta_vs_comfort_mwh) > 0.1 && (
                <span className={`tabular-nums ${deltaCellColour(sys.delta_vs_comfort_mwh)}`}>
                  Δ {sys.delta_vs_comfort_mwh > 0 ? '+' : ''}{fmtMwh(sys.delta_vs_comfort_mwh)} MWh
                </span>
              )}
            </>
          ) : (
            <span className="text-navy tabular-nums">
              {fmtMwh(sys.delivered_mwh ?? sys.fan_electrical_mwh ?? sys.delivered_electrical_mwh)} MWh
            </span>
          )}
        </div>
      ))}
    </div>
  )
}
