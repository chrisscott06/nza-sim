import { useContext } from 'react'
import { useNavigate } from 'react-router-dom'
import { PieChart, Pie, Cell, Tooltip, ResponsiveContainer, Legend } from 'recharts'
import { SimulationContext } from '../../../context/SimulationContext.jsx'
import { ProjectContext } from '../../../context/ProjectContext.jsx'
import DataCard from '../../ui/DataCard.jsx'
import ModuleEmptyState from '../../ui/ModuleEmptyState.jsx'
import { TOOLTIP_STYLE, TOOLTIP_WRAPPER_STYLE, LEGEND_STYLE } from '../../../data/chartTokens.js'
import { BarChart3, AlertTriangle, CheckCircle2, GitCompareArrows } from 'lucide-react'

/* ── Donut chart colours (end-use breakdown) ──────────────────────────────── */
const END_USE_COLORS = {
  Heating:   '#DC2626',
  Cooling:   '#3B82F6',
  Lighting:  '#ECB01F',
  Equipment: '#8B5CF6',
  Other:     '#95A5A6',
}

/* ── Custom tooltip for donut ─────────────────────────────────────────────── */
function DonutTooltip({ active, payload }) {
  if (!active || !payload?.length) return null
  const d = payload[0]
  return (
    <div style={TOOLTIP_STYLE}>
      <p className="font-medium">{d.name}</p>
      <p>{d.value?.toLocaleString(undefined, { maximumFractionDigits: 0 })} kWh</p>
      <p className="text-mid-grey">{d.payload.pct}%</p>
    </div>
  )
}

/* ── Sanity check item ────────────────────────────────────────────────────── */
function SanityItem({ label, value, unit, status, note }) {
  const icon = status === 'ok'
    ? <CheckCircle2 size={12} className="text-green-600 flex-shrink-0 mt-0.5" />
    : <AlertTriangle size={12} className="text-gold flex-shrink-0 mt-0.5" />

  return (
    <div className="flex items-start gap-2 py-1.5 border-b border-light-grey last:border-0">
      {icon}
      <div className="flex-1 min-w-0">
        <span className="text-caption text-dark-grey">{label}</span>
        {note && <p className="text-xxs text-mid-grey mt-0.5">{note}</p>}
      </div>
      <span className="text-caption text-navy font-medium whitespace-nowrap">
        {value}{unit ? <span className="text-xxs text-mid-grey ml-1">{unit}</span> : null}
      </span>
    </div>
  )
}

export default function OverviewTab() {
  const { status, results } = useContext(SimulationContext)
  const { params } = useContext(ProjectContext)
  const navigate = useNavigate()

  if (status !== 'complete' || !results) {
    return (
      <ModuleEmptyState
        icon={BarChart3}
        title="No results yet"
        description="Run a simulation to see the energy overview."
        className="p-6"
      />
    )
  }

  // API response shape:
  //   results.summary   — { eui_kWh_per_m2, annual_heating_kWh, annual_cooling_kWh, peak_*_W_per_m2, unmet_* }
  //   results.annual_energy — { heating_kWh, cooling_kWh, lighting_kWh, equipment_kWh, total_kWh }
  const s   = results.summary      ?? {}
  const ae  = results.annual_energy ?? {}
  const gia = s.total_gia_m2 ?? ((params.length ?? 60) * (params.width ?? 15) * (params.num_floors ?? 4))

  const totalHeating = s.annual_heating_kWh ?? ae.heating_kWh  ?? 0
  const totalCooling = s.annual_cooling_kWh ?? ae.cooling_kWh  ?? 0
  const eui          = s.eui_kWh_per_m2     ?? 0

  // Build donut data from annual_energy dict
  const donutRaw = {
    Heating:   ae.heating_kWh   ?? totalHeating,
    Cooling:   ae.cooling_kWh   ?? totalCooling,
    Lighting:  ae.lighting_kWh  ?? 0,
    Equipment: ae.equipment_kWh ?? 0,
  }
  const donutTotal = Object.values(donutRaw).reduce((a, b) => a + b, 0)
  const donutData = Object.entries(donutRaw)
    .filter(([, v]) => v > 0)
    .map(([name, value]) => ({
      name,
      value: Math.round(value),
      pct: donutTotal > 0 ? Math.round((value / donutTotal) * 100) : 0,
    }))

  // --- Sanity checks ---
  const euiStatus = eui > 0 && eui < 300 ? 'ok' : 'warn'
  const peakHeat  = s.peak_heating_W_per_m2 ?? 0
  const peakCool  = s.peak_cooling_W_per_m2 ?? 0
  const unmetH    = s.unmet_heating_hours    ?? 0
  const unmetC    = s.unmet_cooling_hours    ?? 0
  const warnings  = results.warnings         ?? 0
  const severes   = 0  // not currently exposed in API response

  return (
    <div className="p-4 space-y-5">

      {/* KPI DataCards */}
      <div>
        <p className="text-xxs uppercase tracking-wider text-mid-grey mb-2">Annual energy</p>
        <div className="grid grid-cols-2 gap-3">
          <DataCard
            label="EUI"
            value={eui.toFixed(1)}
            unit="kWh/m²"
            accent="navy"
            large
          />
          <DataCard
            label="Total Heating"
            value={Math.round(totalHeating).toLocaleString()}
            unit="kWh"
            accent="heating-red"
          />
          <DataCard
            label="Total Cooling"
            value={Math.round(totalCooling).toLocaleString()}
            unit="kWh"
            accent="cooling-blue"
          />
          <DataCard
            label="GIA"
            value={Math.round(gia).toLocaleString()}
            unit="m²"
            accent="slate"
            large={false}
          />
        </div>
      </div>

      {/* Peak loads */}
      <div>
        <p className="text-xxs uppercase tracking-wider text-mid-grey mb-2">Peak loads</p>
        <div className="grid grid-cols-2 gap-3">
          <DataCard label="Peak Heating" value={peakHeat.toFixed(1)} unit="W/m²" accent="heating-red" />
          <DataCard label="Peak Cooling" value={peakCool.toFixed(1)} unit="W/m²" accent="cooling-blue" />
        </div>
      </div>

      {/* End-use donut */}
      {donutData.length > 0 && (
        <div>
          <p className="text-xxs uppercase tracking-wider text-mid-grey mb-2">End-use breakdown</p>
          <div className="bg-white rounded-lg border border-light-grey p-3">
            <ResponsiveContainer width="100%" height={180}>
              <PieChart>
                <Pie
                  data={donutData}
                  cx="50%"
                  cy="50%"
                  innerRadius={50}
                  outerRadius={72}
                  paddingAngle={2}
                  dataKey="value"
                >
                  {donutData.map((entry) => (
                    <Cell
                      key={entry.name}
                      fill={END_USE_COLORS[entry.name] ?? END_USE_COLORS.Other}
                    />
                  ))}
                </Pie>
                <Tooltip content={<DonutTooltip />} wrapperStyle={TOOLTIP_WRAPPER_STYLE} />
                <Legend
                  iconType="circle"
                  iconSize={7}
                  wrapperStyle={LEGEND_STYLE}
                  formatter={(value, entry) => `${value} (${entry.payload.pct}%)`}
                />
              </PieChart>
            </ResponsiveContainer>
          </div>
        </div>
      )}

      {/* Sanity checks */}
      <div>
        <p className="text-xxs uppercase tracking-wider text-mid-grey mb-2">Sanity checks</p>
        <div className="bg-white rounded-lg border border-light-grey px-3">
          <SanityItem
            label="EUI in CIBSE TM54 range"
            value={eui.toFixed(1)}
            unit="kWh/m²"
            status={euiStatus}
            note={euiStatus !== 'ok' ? 'Expected 50–250 kWh/m² for hotels' : null}
          />
          <SanityItem
            label="Peak heating load"
            value={peakHeat.toFixed(1)}
            unit="W/m²"
            status={peakHeat > 0 && peakHeat < 150 ? 'ok' : 'warn'}
            note={peakHeat >= 150 ? 'Unusually high — check construction U-values' : null}
          />
          <SanityItem
            label="Peak cooling load"
            value={peakCool.toFixed(1)}
            unit="W/m²"
            status={peakCool >= 0 && peakCool < 150 ? 'ok' : 'warn'}
            note={peakCool >= 150 ? 'Unusually high — check glazing and orientation' : null}
          />
          <SanityItem
            label="Unmet heating hours"
            value={unmetH}
            unit="hrs"
            status={unmetH === 0 ? 'ok' : 'warn'}
            note={unmetH > 0 ? 'Ideal HVAC should meet setpoints — check schedule' : null}
          />
          <SanityItem
            label="Unmet cooling hours"
            value={unmetC}
            unit="hrs"
            status={unmetC === 0 ? 'ok' : 'warn'}
            note={unmetC > 0 ? 'Ideal HVAC should meet setpoints — check schedule' : null}
          />
          <SanityItem
            label="EnergyPlus warnings"
            value={warnings}
            status={warnings < 10 ? 'ok' : 'warn'}
          />
          {severes > 0 && (
            <SanityItem
              label="EnergyPlus severe errors"
              value={severes}
              status="warn"
              note="Review simulation log"
            />
          )}
        </div>
      </div>

      {/* Cross-navigation */}
      <div className="flex gap-3">
        <button
          className="flex items-center gap-1.5 px-3 py-2 rounded-lg border border-light-grey text-xxs font-medium text-dark-grey hover:border-navy hover:text-navy transition-colors"
          onClick={() => navigate('/scenarios')}
        >
          <GitCompareArrows size={12} />
          Compare Scenarios →
        </button>
      </div>

    </div>
  )
}
