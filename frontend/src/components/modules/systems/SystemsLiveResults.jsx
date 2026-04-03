/**
 * SystemsLiveResults.jsx
 *
 * Right column of the Systems module three-column layout.
 * Shows instant-calc results for all energy end uses, fuel split,
 * and system efficiency metrics. Updates live as system inputs change.
 */

import { useContext, useMemo } from 'react'
import { ProjectContext } from '../../../context/ProjectContext.jsx'
import { calculateInstant } from '../../../utils/instantCalc.js'
import { ENDUSE_COLORS } from '../../../data/chartTokens.js'

// ── EUI gauge (reused from building module pattern) ───────────────────────────

const EUI_MAX = 200
const CRREM_TARGET = 85

function EUIGauge({ eui }) {
  const pct = Math.min(eui / EUI_MAX, 1)
  const cx = 60, cy = 60, r = 46
  const bgStart  = { x: cx - r, y: cy }
  const bgEnd    = { x: cx + r, y: cy }
  const bgPath   = `M ${bgStart.x} ${bgStart.y} A ${r} ${r} 0 0 1 ${bgEnd.x} ${bgEnd.y}`
  const valEndAngle = Math.PI * (1 - pct)
  const valEnd = { x: cx + r * Math.cos(valEndAngle), y: cy - r * Math.sin(valEndAngle) }
  const largeArc = pct > 0.5 ? 1 : 0
  const valPath = pct > 0
    ? `M ${bgStart.x} ${bgStart.y} A ${r} ${r} 0 ${largeArc} 1 ${valEnd.x} ${valEnd.y}`
    : null
  const targetAngle = Math.PI * (1 - CRREM_TARGET / EUI_MAX)
  const targetOuter = { x: cx + (r + 4) * Math.cos(targetAngle), y: cy - (r + 4) * Math.sin(targetAngle) }
  const targetInner = { x: cx + (r - 4) * Math.cos(targetAngle), y: cy - (r - 4) * Math.sin(targetAngle) }
  const arcColor = eui <= CRREM_TARGET ? '#16A34A' : eui <= CRREM_TARGET * 1.3 ? '#F59E0B' : '#DC2626'

  return (
    <div className="flex flex-col items-center">
      <p className="text-xxs uppercase tracking-wider text-mid-grey mb-1">EUI (instant estimate)</p>
      <svg width="120" height="72" viewBox="0 0 120 72">
        <path d={bgPath} fill="none" stroke="#E6E6E6" strokeWidth="8" strokeLinecap="round" />
        {valPath && <path d={valPath} fill="none" stroke={arcColor} strokeWidth="8" strokeLinecap="round" />}
        <line x1={targetInner.x} y1={targetInner.y} x2={targetOuter.x} y2={targetOuter.y} stroke="#ECB01F" strokeWidth="2" strokeLinecap="round" />
        <text x="60" y="55" textAnchor="middle" fontSize="18" fontWeight="600" fill={arcColor}>{Math.round(eui)}</text>
        <text x="60" y="65" textAnchor="middle" fontSize="7" fill="#95A5A6">kWh/m²</text>
      </svg>
      <p className="text-xxs text-mid-grey -mt-1">
        CRREM target <span className="text-gold font-medium">{CRREM_TARGET}</span> kWh/m²
      </p>
    </div>
  )
}

// ── End-use energy bars ───────────────────────────────────────────────────────

const END_USES = [
  { key: 'annual_heating_kWh',   label: 'Heating',   color: ENDUSE_COLORS.heating },
  { key: 'annual_cooling_kWh',   label: 'Cooling',   color: ENDUSE_COLORS.cooling },
  { key: 'annual_fans_kWh',      label: 'Fans',      color: ENDUSE_COLORS.fans },
  { key: 'annual_lighting_kWh',  label: 'Lighting',  color: ENDUSE_COLORS.lighting },
  { key: 'annual_equipment_kWh', label: 'Small power', color: ENDUSE_COLORS.equipment },
  { key: 'annual_dhw_kWh',       label: 'DHW',       color: ENDUSE_COLORS.dhw },
]

function EndUseBars({ result }) {
  const total = END_USES.reduce((s, u) => s + (result[u.key] ?? 0), 0)
  if (total === 0) return null
  const max = Math.max(...END_USES.map(u => result[u.key] ?? 0), 1)

  return (
    <div>
      <div className="flex items-center justify-between mb-1.5">
        <p className="text-xxs uppercase tracking-wider text-mid-grey">Energy by end use</p>
        <span className="text-xxs text-navy font-medium">{Math.round(total / 1000)} MWh/yr</span>
      </div>
      <div className="space-y-1.5">
        {END_USES.map(u => {
          const val = result[u.key] ?? 0
          const pct = (val / max) * 100
          return (
            <div key={u.key} className="flex items-center gap-1.5">
              <span className="text-xxs text-mid-grey w-16 truncate">{u.label}</span>
              <div className="flex-1 bg-off-white rounded h-3 overflow-hidden">
                <div
                  className="h-full rounded transition-all duration-200"
                  style={{ width: `${pct}%`, backgroundColor: u.color }}
                />
              </div>
              <span className="text-xxs text-dark-grey w-10 text-right">{Math.round(val / 1000)} MWh</span>
            </div>
          )
        })}
      </div>
    </div>
  )
}

// ── Fuel split bar ────────────────────────────────────────────────────────────

function FuelSplit({ fuel }) {
  const { electricity_kWh, gas_kWh, electricity_pct, gas_pct, total_kWh } = fuel
  if (total_kWh === 0) return null

  return (
    <div>
      <div className="flex items-center justify-between mb-1.5">
        <p className="text-xxs uppercase tracking-wider text-mid-grey">Fuel split</p>
        <span className="text-xxs text-navy font-medium">{Math.round(total_kWh / 1000)} MWh total</span>
      </div>
      <div className="flex h-4 rounded overflow-hidden">
        <div
          className="transition-all duration-200"
          style={{ width: `${electricity_pct}%`, backgroundColor: '#ECB01F' }}
          title={`Electricity: ${electricity_pct}%`}
        />
        <div
          className="transition-all duration-200"
          style={{ width: `${gas_pct}%`, backgroundColor: '#DC2626' }}
          title={`Gas: ${gas_pct}%`}
        />
      </div>
      <div className="flex gap-3 mt-1">
        <div className="flex items-center gap-1">
          <div className="w-2 h-2 rounded-sm" style={{ backgroundColor: '#ECB01F' }} />
          <span className="text-xxs text-dark-grey">Elec {electricity_pct}% · {Math.round(electricity_kWh / 1000)} MWh</span>
        </div>
        {gas_kWh > 0 && (
          <div className="flex items-center gap-1">
            <div className="w-2 h-2 rounded-sm" style={{ backgroundColor: '#DC2626' }} />
            <span className="text-xxs text-dark-grey">Gas {gas_pct}% · {Math.round(gas_kWh / 1000)} MWh</span>
          </div>
        )}
      </div>
    </div>
  )
}

// ── Metric row ────────────────────────────────────────────────────────────────

function Metric({ label, value, unit }) {
  return (
    <div className="flex items-center justify-between py-1 border-b border-light-grey last:border-0">
      <span className="text-xxs text-dark-grey">{label}</span>
      <span className="text-xxs font-semibold text-navy">
        {value} <span className="font-normal text-mid-grey">{unit}</span>
      </span>
    </div>
  )
}

// ── Main panel ────────────────────────────────────────────────────────────────

export default function SystemsLiveResults({ libraryData = {} }) {
  const { params, constructions, systems } = useContext(ProjectContext)

  const result = useMemo(
    () => calculateInstant(params, constructions, systems, libraryData),
    [params, constructions, systems, libraryData]
  )

  const isIdeal = systems.mode !== 'detailed'
  const isMVHR  = systems.ventilation_type?.startsWith('mvhr')
  const fanPct  = result.fuel_split.total_kWh > 0
    ? Math.round((result.annual_fans_kWh / result.fuel_split.total_kWh) * 100)
    : 0

  return (
    <div className="h-full overflow-y-auto overflow-x-hidden bg-white border-l border-light-grey">
      <div className="p-3 space-y-4">
        {/* Header */}
        <div className="flex items-center justify-between">
          <p className="text-xxs uppercase tracking-wider text-mid-grey">Live Results</p>
          <span className="text-xxs px-1.5 py-0.5 rounded bg-amber-50 text-amber-700 border border-amber-200">
            ⚡ Instant estimate
          </span>
        </div>

        {isIdeal && (
          <div className="bg-amber-50 border border-amber-200 rounded p-2">
            <p className="text-xxs text-amber-700">Ideal Loads: all energy shown as electricity. Switch to Detailed for real fuel split.</p>
          </div>
        )}

        {/* EUI gauge */}
        <EUIGauge eui={result.eui_kWh_m2} />

        {/* End use breakdown */}
        <EndUseBars result={result} />

        {/* Fuel split */}
        <FuelSplit fuel={result.fuel_split} />

        {/* System efficiency metrics */}
        <div>
          <p className="text-xxs uppercase tracking-wider text-mid-grey mb-1.5">System metrics</p>
          <div>
            <Metric label="Carbon intensity" value={result.carbon_kgCO2_m2} unit="kgCO₂/m²" />
            <Metric
              label="Heat recovery"
              value={isMVHR ? `${systems.hre_override ?? 85}%` : 'None'}
              unit=""
            />
            <Metric
              label="Fan energy share"
              value={fanPct}
              unit="% of total"
            />
            <Metric
              label="DHW thermal"
              value={Math.round(result.annual_dhw_kWh / 1000)}
              unit="MWh/yr"
            />
          </div>
        </div>

        {/* Run full simulation link */}
        <div className="pt-1 border-t border-light-grey">
          <p className="text-xxs text-mid-grey">
            These are simplified estimates.{' '}
            <button
              className="text-teal hover:underline"
              onClick={() => window.dispatchEvent(new CustomEvent('nza:run-simulation'))}
            >
              Run full EnergyPlus simulation →
            </button>
          </p>
        </div>
      </div>
    </div>
  )
}
