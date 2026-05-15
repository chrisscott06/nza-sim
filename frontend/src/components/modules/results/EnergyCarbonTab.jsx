/**
 * EnergyCarbonTab.jsx — Results module's 4th tab (Brief 28f Part 5.5, Path C).
 *
 * Renders State 3 v2.5 output (energy_use × system_performance × carbon)
 * from the live engine. The engine auto-detects v2.5 mode when the project's
 * building_config.systems_config_v25 is present and non-empty (dispatcher
 * landed in commit 9ebe0ac). Legacy projects without v2.5 systems config
 * see the empty state below — invite to configure systems once the input UI
 * (sub-piece 5.4) ships.
 *
 * Data flow:
 *   ProjectContext (params + constructions)
 *   WeatherContext (weatherData + hourlySolar)
 *   /api/library?type=construction  →  libraryData.constructions
 *   SYSTEM_TEMPLATES_LIBRARY        →  libraryData.system_templates
 *     → calculateInstant(...) → result.{energy_use, system_performance, carbon_kg_co2_per_m2}
 *
 * Charts: SVG export via direct DOM serialization (recharts is SVG-native;
 * no extra deps needed for V1). PNG/PDF export deferred to a follow-up if/
 * when measured-data ingest reveals the need for richer export pipeline.
 */

import { useContext, useEffect, useMemo, useState, useRef } from 'react'
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer, Cell } from 'recharts'
import { Settings2, Download, AlertTriangle, Zap, Flame, Thermometer, Wind } from 'lucide-react'

import { ProjectContext } from '../../../context/ProjectContext.jsx'
import { WeatherContext } from '../../../context/WeatherContext.jsx'
import { useHourlySolar } from '../../../hooks/useHourlySolar.js'
import { calculateInstant, MissingLibraryField } from '../../../utils/instantCalc.js'
import { SYSTEM_TEMPLATES_LIBRARY } from '../../../data/systemTemplatesLibrary.js'
import DataCard from '../../chart/DataCard.jsx'
import ChartContainer from '../../chart/ChartContainer.jsx'
import ModuleEmptyState from '../../ui/ModuleEmptyState.jsx'
import {
  AXIS_PROPS,
  TOOLTIP_STYLE,
  TOOLTIP_WRAPPER_STYLE,
  LEGEND_STYLE,
  GRID_STYLE,
  ENDUSE_COLORS,
} from '../../../data/chartTokens.js'

// ── Helpers ─────────────────────────────────────────────────────────────────

const FUEL_COLORS = {
  electricity: '#00AEEF',   // teal
  gas:         '#ECB01F',   // gold
}

function fmtKwh(n) {
  if (n == null || !Number.isFinite(n)) return '—'
  return Math.round(n).toLocaleString()
}

function fmtMwh(n, dp = 2) {
  if (n == null || !Number.isFinite(n)) return '—'
  return Number(n).toFixed(dp)
}

function downloadSvg(svgNode, filename) {
  if (!svgNode) return
  const clone = svgNode.cloneNode(true)
  // Inline minimal styling so the standalone file looks the same as in-app.
  clone.setAttribute('xmlns', 'http://www.w3.org/2000/svg')
  const serializer = new XMLSerializer()
  const source = '<?xml version="1.0" standalone="no"?>\n' + serializer.serializeToString(clone)
  const blob = new Blob([source], { type: 'image/svg+xml;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  URL.revokeObjectURL(url)
}

function ExportSvgButton({ chartRef, filename }) {
  const onClick = () => {
    const node = chartRef.current?.querySelector('svg')
    downloadSvg(node, filename)
  }
  return (
    <button
      onClick={onClick}
      className="flex items-center gap-1 px-2 py-1 text-xxs text-mid-grey hover:text-navy hover:bg-off-white rounded transition-colors"
      title="Download chart as SVG"
    >
      <Download size={11} />
      SVG
    </button>
  )
}

function ServiceIcon({ service, size = 14 }) {
  const map = {
    heating:    <Flame      size={size} style={{ color: ENDUSE_COLORS.heating }} />,
    cooling:    <Thermometer size={size} style={{ color: ENDUSE_COLORS.cooling }} />,
    dhw:        <Flame      size={size} style={{ color: ENDUSE_COLORS.dhw }} />,
    ventilation:<Wind       size={size} style={{ color: ENDUSE_COLORS.fans }} />,
  }
  return map[service] ?? null
}

// ── Per-system performance table row ────────────────────────────────────────

function SystemRow({ label, role, delivered_mwh, fuel_mwh, avg, fuel, note }) {
  return (
    <tr className="border-t border-light-grey">
      <td className="px-3 py-2 text-caption text-dark-grey">
        {role && <span className="text-xxs uppercase tracking-wider text-mid-grey mr-2">{role}</span>}
        {label}
      </td>
      <td className="px-3 py-2 text-caption text-navy tabular-nums text-right">{fmtMwh(delivered_mwh)}</td>
      <td className="px-3 py-2 text-caption text-navy tabular-nums text-right">{fmtMwh(fuel_mwh)}</td>
      <td className="px-3 py-2 text-caption text-mid-grey tabular-nums text-right">{avg != null ? avg.toFixed(2) : '—'}</td>
      <td className="px-3 py-2 text-xxs text-mid-grey">
        {fuel && (
          <span className="inline-flex items-center gap-1">
            <span className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: FUEL_COLORS[fuel] }} />
            {fuel}
          </span>
        )}
        {note && <span className="ml-2 italic">{note}</span>}
      </td>
    </tr>
  )
}

// ── Main tab ────────────────────────────────────────────────────────────────

export default function EnergyCarbonTab() {
  const { params, constructions, comfortBand } = useContext(ProjectContext)
  const weatherCtx = useContext(WeatherContext)
  const hourlySolar = useHourlySolar(weatherCtx?.weatherData, Number(params?.orientation ?? 0))

  const [constructionsLibrary, setConstructionsLibrary] = useState([])
  useEffect(() => {
    // Use /api/library/constructions (NOT /api/library?type=construction).
    // The latter returns a stripped-down config_json that omits the `layers`
    // array — but State 2/3 multi-node wall physics (Brief 28b Part 3+)
    // needs layers for thermal-mass modelling. Without layers, walls revert
    // to massless single-resistance and the free-running T trace becomes
    // unrealistic in winter (heating demand explodes by ~75×).
    // Matches the shape used by scripts/seed_bridgewater_v25_systems.mjs and
    // the State 3 test fixtures.
    fetch('/api/library/constructions')
      .then(r => r.ok ? r.json() : { constructions: [] })
      .then(data => {
        const items = Array.isArray(data) ? data : (data?.constructions ?? [])
        const normalised = items.map(c => ({
          name: c.name,
          u_value_W_per_m2K: c.config_json?.u_value_W_per_m2K ?? c.u_value_W_per_m2K,
          y_factor:          c.config_json?.y_factor          ?? c.y_factor ?? 1.0,
          g_value:           c.config_json?.g_value           ?? c.g_value,
          config_json:       c.config_json ?? c,
          layers:            c.config_json?.layers ?? c.layers,   // multi-node engine needs these
        }))
        setConstructionsLibrary(normalised)
      })
      .catch(() => setConstructionsLibrary([]))
  }, [])

  const libraryData = useMemo(() => ({
    constructions: constructionsLibrary,
    system_templates: SYSTEM_TEMPLATES_LIBRARY,
  }), [constructionsLibrary])

  // ProjectContext stores occupancy at params.occupancy (a top-level field),
  // but the engine reads building.gains.occupancy. Reshape here so the State 2
  // gains computation has occupancy where it expects. Comfort band: similar
  // mismatch — project row has comfort_band_lower_c / _upper_c at top level,
  // engine reads via options.comfortBand or building.comfort_band. We carry
  // both into the building object so existing engine fallbacks all hit.
  const building = useMemo(() => ({
    ...params,
    gains: {
      ...(params?.gains ?? {}),
      occupancy: params?.gains?.occupancy ?? params?.occupancy ?? null,
    },
  }), [params])

  // Run engine. Auto-detects v2.5 when params.systems_config_v25 is present.
  // If validation fails (missing library_id, missing required field, etc.),
  // catch MissingLibraryField and surface it as a config-error panel instead
  // of crashing the tab.
  const [engineError, setEngineError] = useState(null)
  const result = useMemo(() => {
    if (!weatherCtx?.weatherData || !hourlySolar) return null
    try {
      const r = calculateInstant(
        building, constructions || {}, {}, libraryData,
        weatherCtx.weatherData, hourlySolar, null,
        { comfortBand: comfortBand ?? { lower_c: 20, upper_c: 26 } },
      )
      setEngineError(null)
      return r
    } catch (e) {
      // MissingLibraryField errors carry .subSystemPath + .fieldName for
      // inline display once the Systems form UI lands. For now we show a
      // single error panel with the same information.
      setEngineError(e)
      return null
    }
  }, [building, constructions, libraryData, weatherCtx?.weatherData, hourlySolar, comfortBand])

  // ── Empty state: no v2.5 systems config yet ─────────────────────────────
  const hasV25 = params?.systems_config_v25 && Object.keys(params.systems_config_v25).length > 0
  if (!hasV25) {
    return (
      <ModuleEmptyState
        icon={Settings2}
        title="Systems not configured"
        description={
          "This project has no v2.5 systems_config yet. Once you add heating / cooling / DHW / ventilation systems on the Systems page (input UI coming in the next sub-piece), this tab will render energy use and carbon. For now, the seed script in scripts/seed_bridgewater_v25_systems.mjs is the canonical way to populate this for Bridgewater."
        }
        className="p-6"
      />
    )
  }

  // ── Validation error (MissingLibraryField) ──────────────────────────────
  if (engineError instanceof MissingLibraryField) {
    return (
      <div className="p-6">
        <div className="bg-coral/5 border border-coral/30 rounded-lg p-4 max-w-2xl">
          <div className="flex items-start gap-2">
            <AlertTriangle size={16} className="text-coral flex-shrink-0 mt-0.5" />
            <div className="flex-1 min-w-0">
              <p className="text-caption font-medium text-coral">Systems config has a missing library reference</p>
              <p className="text-caption text-dark-grey mt-1 break-words">{engineError.message}</p>
              <div className="grid grid-cols-3 gap-2 mt-3 text-xxs">
                <div>
                  <p className="uppercase tracking-wider text-mid-grey">Sub-system</p>
                  <p className="text-navy font-mono mt-0.5 break-all">{engineError.subSystemPath}</p>
                </div>
                <div>
                  <p className="uppercase tracking-wider text-mid-grey">Library ID</p>
                  <p className="text-navy font-mono mt-0.5 break-all">{engineError.libraryId ?? '(missing)'}</p>
                </div>
                <div>
                  <p className="uppercase tracking-wider text-mid-grey">Missing field</p>
                  <p className="text-navy font-mono mt-0.5 break-all">{engineError.fieldName}</p>
                </div>
              </div>
              <p className="text-xxs text-mid-grey mt-3 italic">
                Fix the systems_config_v25 in the project or library file, then this tab will render.
              </p>
            </div>
          </div>
        </div>
      </div>
    )
  }

  // ── Generic error ───────────────────────────────────────────────────────
  if (engineError) {
    return (
      <div className="p-6">
        <div className="bg-coral/5 border border-coral/30 rounded-lg p-4">
          <p className="text-caption font-medium text-coral">Engine error</p>
          <p className="text-caption text-dark-grey mt-1">{String(engineError?.message ?? engineError)}</p>
        </div>
      </div>
    )
  }

  // ── Weather still loading ───────────────────────────────────────────────
  if (!result) {
    return (
      <div className="p-6">
        <p className="text-caption text-mid-grey">Loading weather data…</p>
      </div>
    )
  }

  // ── Live result rendering ───────────────────────────────────────────────
  const eu  = result.energy_use ?? {}
  const sp  = result.system_performance ?? {}
  const gia = result.metadata?.gia_m2 ?? result.heat_balance?.metadata?.gia_m2 ?? 0
  const eui = eu.totals?.eui_kwh_per_m2 ?? 0
  const carbon = result.carbon_kg_co2_per_m2 ?? 0
  const electricity_kwh = eu.totals?.electricity_kwh ?? 0
  const gas_kwh         = eu.totals?.gas_kwh ?? 0

  // Per-service stacked bar data (electricity + gas).
  const fuelSplitData = [
    { service: 'Heating',   electricity: eu.electricity?.heating?.total ?? 0, gas: eu.gas?.heating?.total ?? 0 },
    { service: 'Cooling',   electricity: eu.electricity?.cooling?.total ?? 0, gas: eu.gas?.cooling?.total ?? 0 },
    { service: 'DHW',       electricity: eu.electricity?.dhw?.total     ?? 0, gas: eu.gas?.dhw?.total     ?? 0 },
    { service: 'Fans',      electricity: eu.electricity?.fans?.total    ?? 0, gas: 0 },
    { service: 'Lighting',  electricity: eu.electricity?.lighting       ?? 0, gas: 0 },
    { service: 'Equipment', electricity: eu.electricity?.equipment      ?? 0, gas: 0 },
  ].filter(d => d.electricity > 0 || d.gas > 0)

  // Per-fuel single-bar data (one electricity bar, one gas bar) — alternative view.
  const fuelTotalData = [
    { fuel: 'Electricity', value: electricity_kwh, color: FUEL_COLORS.electricity },
    { fuel: 'Gas',         value: gas_kwh,         color: FUEL_COLORS.gas },
  ].filter(d => d.value > 0)

  // Per-system performance table data.
  const ventSystems = sp.ventilation?.systems ?? []
  const recoveryEff = sp.ventilation?.total?.recovery_mwh ?? 0
  const recoveryTheoretical = sp.ventilation?.total?.recovery_theoretical_mwh ?? 0
  const recoveryCapped = recoveryTheoretical > recoveryEff && recoveryTheoretical > 0.01

  // Occupancy banner (per State 3 validation Finding 2 — Bridgewater specifically;
  // any project with occupancy_rate=1 and num_bedrooms × ppr at design-peak is similar).
  const occupancyRate  = params?.occupancy_rate ?? params?.gains?.occupancy?.occupancy_rate
  const showOccupancyBanner = Number(occupancyRate) === 1 && (params?.num_bedrooms ?? 0) > 50

  // Measured comparison (per Chris's flag (c) — show "Model output (uncalibrated)"
  // alongside Bridgewater's measured 2024-25 numbers so external readers don't
  // misread the modelled headlines as a real-world estimate). V1 hardcodes the
  // Bridgewater comparison; once measured-data ingest (Brief 28g) lands, this
  // pulls from a project-level measured_summary field instead.
  const BRIDGEWATER_PROJECT_ID = '14b4a5b1-8c73-4acb-8b65-1d22f05ec969'
  const isBridgewater = params?.id === BRIDGEWATER_PROJECT_ID || params?.name === 'HIX Bridgewater'
  const measuredComparison = isBridgewater
    ? { eui_low: 178, eui_high: 199, carbon: 36, period: '2024–25' }
    : null

  const chartFuelSplitRef = useRef(null)
  const chartFuelTotalRef = useRef(null)

  return (
    <div className="p-4 space-y-5">
      {/* ─── Uncalibrated-model banner (flag (c) — protects against the tab
            being misread as a real-world estimate). Always shown until
            calibration workflow lands (Brief 28g+). Project-specific
            measured comparison appears when available. */}
      <div className="bg-coral/5 border border-coral/30 rounded-lg px-3 py-2.5 flex items-start gap-2">
        <AlertTriangle size={14} className="text-coral flex-shrink-0 mt-0.5" />
        <div className="flex-1 min-w-0">
          <p className="text-caption font-medium text-dark-grey">Model output (uncalibrated)</p>
          <p className="text-xxs text-mid-grey mt-0.5 leading-snug">
            These are engine outputs against design-intent inputs — not a real-world consumption estimate.
            {measuredComparison && (
              <>
                {' '}
                <strong className="text-dark-grey">Bridgewater measured {measuredComparison.period}:</strong>{' '}
                EUI {measuredComparison.eui_low}–{measuredComparison.eui_high} kWh/m²,
                carbon ~{measuredComparison.carbon} kg CO₂e/m² (vs modelled EUI {eui.toFixed(1)}, carbon {carbon.toFixed(1)}).
              </>
            )}
            {' '}Calibration against measured data (Brief 28g+) will close the gap.
          </p>
        </div>
      </div>

      {/* ─── Occupancy banner (Finding 2 surfacing) ──────────────────────── */}
      {showOccupancyBanner && (
        <div className="bg-gold/5 border border-gold/30 rounded-lg px-3 py-2.5 flex items-start gap-2">
          <AlertTriangle size={14} className="text-gold flex-shrink-0 mt-0.5" />
          <div className="flex-1 min-w-0">
            <p className="text-caption font-medium text-dark-grey">Occupancy at design peak</p>
            <p className="text-xxs text-mid-grey mt-0.5 leading-snug">
              This project is configured at design-peak occupancy (occupancy_rate = 1.0, full bedroom complement at people-per-room).
              Modelled DHW and internal gains reflect this peak — real annual operation is typically 60–75% of peak.
              Measured-data ingest will ground-truth the actual annual-average; until then, treat DHW as an upper bound.
            </p>
          </div>
        </div>
      )}

      {/* ─── Headline KPI tiles ──────────────────────────────────────────────
        DataCard accent-colour semantics (per flag (d) — Pablo design system
        principle: accent colour maps to data semantics):
          - navy  / slate : headline aggregates (intensity, carbon — neutral palette)
          - teal  / gold  : per-fuel cards matching the chart fuel palette
                            (chartTokens.ENDUSE_COLORS + the fans/dhw mapping)
        Future fuel additions (district heat, oil, biomass) get their own
        chart palette entry + DataCard accent — never re-use existing fuel
        colours. */}
      <div>
        <p className="text-xxs uppercase tracking-wider text-mid-grey mb-2">Annual energy & carbon</p>
        <div className="grid grid-cols-4 gap-3">
          <DataCard
            label="EUI"
            value={eui.toFixed(1)}
            unit="kWh/m²"
            accent="navy"
            icon={Zap}
            large
          />
          <DataCard
            label="Carbon"
            value={carbon.toFixed(1)}
            unit="kg CO₂e/m²"
            accent="slate"
            large
          />
          <DataCard
            label="Electricity"
            value={fmtKwh(electricity_kwh)}
            unit="kWh"
            accent="teal"
            icon={Zap}
          />
          <DataCard
            label="Gas"
            value={fmtKwh(gas_kwh)}
            unit="kWh"
            accent="gold"
            icon={Flame}
          />
        </div>
      </div>

      {/* ─── Building summary inline ─────────────────────────────────────── */}
      <div className="bg-off-white rounded-lg border border-light-grey px-3 py-2.5">
        <div className="flex flex-wrap gap-x-4 gap-y-1 text-xxs">
          <span className="text-dark-grey">GIA <span className="font-semibold text-navy">{Math.round(gia).toLocaleString()} m²</span></span>
          <span className="text-dark-grey">Floors <span className="font-semibold text-navy">{params?.num_floors ?? '—'}</span></span>
          <span className="text-dark-grey">Total delivered <span className="font-semibold text-navy">{fmtKwh(eu.totals?.delivered_energy_kwh)} kWh</span></span>
          <span className="text-dark-grey">Engine <span className="font-semibold text-navy">v2.5</span></span>
        </div>
      </div>

      {/* ─── Per-service energy split by fuel ─────────────────────────────── */}
      {fuelSplitData.length > 0 && (
        <div>
          <div className="flex items-center justify-between mb-2">
            <p className="text-xxs uppercase tracking-wider text-mid-grey">Energy by service & fuel</p>
            <ExportSvgButton chartRef={chartFuelSplitRef} filename="energy_by_service_fuel.svg" />
          </div>
          <div ref={chartFuelSplitRef}>
            <ChartContainer title="" height={240}>
              <BarChart data={fuelSplitData} margin={{ top: 10, right: 12, left: 0, bottom: 0 }}>
                <CartesianGrid {...GRID_STYLE} vertical={false} />
                <XAxis dataKey="service" {...AXIS_PROPS} />
                <YAxis {...AXIS_PROPS} tickFormatter={(v) => v >= 1000 ? `${(v/1000).toFixed(0)}k` : v} />
                <Tooltip
                  contentStyle={TOOLTIP_STYLE}
                  wrapperStyle={TOOLTIP_WRAPPER_STYLE}
                  formatter={(value, name) => [`${Math.round(value).toLocaleString()} kWh`, name]}
                />
                <Legend wrapperStyle={LEGEND_STYLE} iconType="square" iconSize={8} />
                <Bar dataKey="electricity" stackId="fuel" name="Electricity" fill={FUEL_COLORS.electricity} />
                <Bar dataKey="gas"         stackId="fuel" name="Gas"         fill={FUEL_COLORS.gas} />
              </BarChart>
            </ChartContainer>
          </div>
        </div>
      )}

      {/* ─── Total energy by fuel (alternative view) ──────────────────────── */}
      {fuelTotalData.length > 0 && (
        <div>
          <div className="flex items-center justify-between mb-2">
            <p className="text-xxs uppercase tracking-wider text-mid-grey">Total by fuel</p>
            <ExportSvgButton chartRef={chartFuelTotalRef} filename="total_by_fuel.svg" />
          </div>
          <div ref={chartFuelTotalRef}>
            <ChartContainer title="" height={160}>
              <BarChart data={fuelTotalData} layout="vertical" margin={{ top: 10, right: 24, left: 56, bottom: 0 }}>
                <CartesianGrid {...GRID_STYLE} horizontal={false} />
                <XAxis type="number" {...AXIS_PROPS} tickFormatter={(v) => v >= 1000 ? `${(v/1000).toFixed(0)}k` : v} />
                <YAxis type="category" dataKey="fuel" {...AXIS_PROPS} width={50} />
                <Tooltip
                  contentStyle={TOOLTIP_STYLE}
                  wrapperStyle={TOOLTIP_WRAPPER_STYLE}
                  formatter={(value) => [`${Math.round(value).toLocaleString()} kWh`, 'Total']}
                />
                <Bar dataKey="value" name="Total">
                  {fuelTotalData.map((d, i) => <Cell key={i} fill={d.color} />)}
                </Bar>
              </BarChart>
            </ChartContainer>
          </div>
        </div>
      )}

      {/* ─── Per-system performance table ─────────────────────────────────── */}
      <div>
        <p className="text-xxs uppercase tracking-wider text-mid-grey mb-2">Per-system performance</p>
        <div className="bg-white rounded-lg border border-light-grey overflow-hidden">
          <table className="w-full text-caption">
            <thead className="bg-off-white">
              <tr>
                <th className="px-3 py-2 text-left text-xxs uppercase tracking-wider text-mid-grey font-medium">System</th>
                <th className="px-3 py-2 text-right text-xxs uppercase tracking-wider text-mid-grey font-medium">Delivered (MWh)</th>
                <th className="px-3 py-2 text-right text-xxs uppercase tracking-wider text-mid-grey font-medium">Fuel (MWh)</th>
                <th className="px-3 py-2 text-right text-xxs uppercase tracking-wider text-mid-grey font-medium">Avg COP/SEER</th>
                <th className="px-3 py-2 text-left text-xxs uppercase tracking-wider text-mid-grey font-medium">Fuel · Notes</th>
              </tr>
            </thead>
            <tbody>
              {/* Heating — flag (a): when MVHR covers full demand, replace
                   the 0/0 primary/secondary/total rows with a single italic
                   explainer line so the zeros don't read as a calculated
                   headline ("Heating: 0 kWh" looking like the engine is
                   broken). Show full rows otherwise. */}
              <tr><td colSpan={5} className="px-3 pt-3 pb-1 text-xxs uppercase tracking-wider text-mid-grey bg-off-white/50 border-t border-light-grey">
                <span className="inline-flex items-center gap-1.5"><ServiceIcon service="heating" />Heating</span>
              </td></tr>
              {(sp.heating?.total?.delivered_mwh ?? 0) === 0 && recoveryCapped ? (
                <tr className="border-t border-light-grey">
                  <td colSpan={5} className="px-3 py-3 text-caption text-mid-grey italic leading-snug">
                    Heating demand fully offset by MVHR heat recovery (see Ventilation below — recovery {recoveryEff.toFixed(1)} MWh equals full State 2 heating demand). Primary and secondary heating systems remain configured ({params?.systems_config_v25?.heating?.primary?.library_id} {sp.heating?.secondary ? `+ ${params?.systems_config_v25?.heating?.secondary?.library_id}` : ''}) but contribute zero fuel under the current annual-aggregate model.
                  </td>
                </tr>
              ) : (
                <>
                  <SystemRow role="Primary"   label={params?.systems_config_v25?.heating?.primary?.library_id ?? '—'}
                    delivered_mwh={sp.heating?.primary?.delivered_mwh ?? 0}
                    fuel_mwh={sp.heating?.primary?.fuel_mwh ?? 0}
                    avg={sp.heating?.primary?.avg_cop_or_eff}
                    fuel={sp.heating?.primary?.fuel} />
                  {sp.heating?.secondary && (
                    <SystemRow role="Secondary" label={params?.systems_config_v25?.heating?.secondary?.library_id ?? '—'}
                      delivered_mwh={sp.heating.secondary.delivered_mwh}
                      fuel_mwh={sp.heating.secondary.fuel_mwh}
                      avg={sp.heating.secondary.avg_cop_or_eff}
                      fuel={sp.heating.secondary.fuel} />
                  )}
                  <SystemRow role="Total" label="Heating total"
                    delivered_mwh={sp.heating?.total?.delivered_mwh ?? 0}
                    fuel_mwh={sp.heating?.total?.fuel_mwh ?? 0}
                  />
                </>
              )}

              {/* Cooling */}
              <tr><td colSpan={5} className="px-3 pt-3 pb-1 text-xxs uppercase tracking-wider text-mid-grey bg-off-white/50 border-t border-light-grey">
                <span className="inline-flex items-center gap-1.5"><ServiceIcon service="cooling" />Cooling</span>
              </td></tr>
              <SystemRow role="Primary"   label={params?.systems_config_v25?.cooling?.primary?.library_id ?? '—'}
                delivered_mwh={sp.cooling?.primary?.delivered_mwh ?? 0}
                fuel_mwh={sp.cooling?.primary?.fuel_mwh ?? 0}
                avg={sp.cooling?.primary?.avg_cop_or_eff}
                fuel={sp.cooling?.primary?.fuel} />
              {sp.cooling?.secondary && (
                <SystemRow role="Secondary" label={params?.systems_config_v25?.cooling?.secondary?.library_id ?? '—'}
                  delivered_mwh={sp.cooling.secondary.delivered_mwh}
                  fuel_mwh={sp.cooling.secondary.fuel_mwh}
                  avg={sp.cooling.secondary.avg_cop_or_eff}
                  fuel={sp.cooling.secondary.fuel} />
              )}
              <SystemRow role="Total" label="Cooling total"
                delivered_mwh={sp.cooling?.total?.delivered_mwh ?? 0}
                fuel_mwh={sp.cooling?.total?.fuel_mwh ?? 0}
              />

              {/* DHW */}
              <tr><td colSpan={5} className="px-3 pt-3 pb-1 text-xxs uppercase tracking-wider text-mid-grey bg-off-white/50 border-t border-light-grey">
                <span className="inline-flex items-center gap-1.5"><ServiceIcon service="dhw" />DHW</span>
              </td></tr>
              <SystemRow role="Primary"   label={params?.systems_config_v25?.dhw?.primary?.library_id ?? '—'}
                delivered_mwh={sp.dhw?.primary?.delivered_mwh ?? 0}
                fuel_mwh={sp.dhw?.primary?.fuel_mwh ?? 0}
                avg={sp.dhw?.primary?.avg_cop_or_eff}
                fuel={sp.dhw?.primary?.fuel} />
              {sp.dhw?.secondary && (
                <SystemRow role="Secondary" label={params?.systems_config_v25?.dhw?.secondary?.library_id ?? '—'}
                  delivered_mwh={sp.dhw.secondary.delivered_mwh}
                  fuel_mwh={sp.dhw.secondary.fuel_mwh}
                  avg={sp.dhw.secondary.avg_cop_or_eff}
                  fuel={sp.dhw.secondary.fuel} />
              )}
              <SystemRow role="" label="Circulation pump"
                delivered_mwh={0}
                fuel_mwh={(sp.dhw?.circulation_pump_kwh ?? 0) / 1000}
                avg={null}
                fuel={'electricity'}
                note="continuous baseload" />
              <SystemRow role="Total" label="DHW total"
                delivered_mwh={sp.dhw?.total?.delivered_mwh ?? 0}
                fuel_mwh={sp.dhw?.total?.fuel_mwh ?? 0}
              />

              {/* Ventilation */}
              <tr><td colSpan={5} className="px-3 pt-3 pb-1 text-xxs uppercase tracking-wider text-mid-grey bg-off-white/50 border-t border-light-grey">
                <span className="inline-flex items-center gap-1.5"><ServiceIcon service="ventilation" />Ventilation</span>
              </td></tr>
              {ventSystems.map(v => (
                <tr key={v.id} className="border-t border-light-grey">
                  <td className="px-3 py-2 text-caption text-dark-grey">{v.id}</td>
                  <td className="px-3 py-2 text-caption text-mid-grey tabular-nums text-right">—</td>
                  <td className="px-3 py-2 text-caption text-navy tabular-nums text-right">{((v.fan_kwh ?? 0) / 1000).toFixed(2)}</td>
                  <td className="px-3 py-2 text-caption text-mid-grey tabular-nums text-right">HRE {((v.recovery_mwh > 0 ? 1 : 0) * 100).toFixed(0)}%</td>
                  <td className="px-3 py-2 text-xxs text-mid-grey">
                    <span className="inline-flex items-center gap-1">
                      <span className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: FUEL_COLORS.electricity }} />
                      electricity
                    </span>
                    <span className="ml-2 italic">{v.hours_active} h/yr · schedule_source = {v.schedule_source}</span>
                  </td>
                </tr>
              ))}
              <SystemRow role="Total" label="Fans total"
                delivered_mwh={null}
                fuel_mwh={(sp.ventilation?.total?.fan_kwh ?? 0) / 1000}
                avg={null}
              />
            </tbody>
          </table>
        </div>
      </div>

      {/* ─── HRE recovery callout (when MVHR is reducing heating demand) ──── */}
      {recoveryEff > 0 && (
        <div className="bg-teal/5 border border-teal/30 rounded-lg px-3 py-2.5 flex items-start gap-2">
          <Wind size={14} className="text-teal flex-shrink-0 mt-0.5" />
          <div className="flex-1 min-w-0">
            <p className="text-caption font-medium text-dark-grey">
              MVHR heat recovery applied: {recoveryEff.toFixed(2)} MWh
              {recoveryCapped && ' (capped at State 2 heating demand)'}
            </p>
            <p className="text-xxs text-mid-grey mt-0.5 leading-snug">
              Theoretical recovery (flow × air heat capacity × HRE × ΔT_integral) = {recoveryTheoretical.toFixed(2)} MWh.
              {recoveryCapped
                ? ` Annual aggregate exceeds heating demand (${recoveryEff.toFixed(2)} MWh) — effective recovery clipped to demand. Real-world peak-winter heating still occurs; the annual model under-represents winter-peak need when MVHR is oversized.`
                : ' Within heating demand envelope; recovery applies fully.'}
            </p>
          </div>
        </div>
      )}

      {/* ─── Cooling caveat (flag (b) — Cooling is the largest electrical
            load and propagates State 2's free-running comfort-band integral
            with no HVAC clamping. Without this note, a consultant could read
            80 MWh as real measured cooling). */}
      {(sp.cooling?.total?.fuel_mwh ?? 0) > 0 && (
        <div className="bg-gold/5 border border-gold/30 rounded-lg px-3 py-2.5 flex items-start gap-2">
          <AlertTriangle size={14} className="text-gold flex-shrink-0 mt-0.5" />
          <div className="flex-1 min-w-0">
            <p className="text-caption font-medium text-dark-grey">
              Cooling demand is an upper bound: {sp.cooling.total.fuel_mwh.toFixed(2)} MWh fuel against
              State 2 free-running comfort-band integral of {result.demand?.cooling_demand_mwh?.toFixed?.(1) ?? '—'} MWh demand
            </p>
            <p className="text-xxs text-mid-grey mt-0.5 leading-snug">
              State 2's cooling demand is integrated over hours when the free-running zone
              exceeds the comfort band's upper bound, assuming an idealised system. No HVAC clamping
              (plant capacity, deadband, operable-window mitigation) is applied yet — measured
              consumption is likely materially lower. HVAC-clamped cooling demand becomes available
              once calibration against measured data lands.
            </p>
          </div>
        </div>
      )}

      {/* ─── Disclosure ───────────────────────────────────────────────────── */}
      <div className="text-xxs text-mid-grey leading-relaxed border-t border-light-grey pt-3">
        <p className="italic">
          State 3 v2.5 engine output. Library efficiencies are scalar (SCOP / SEER / seasonal_efficiency / COP) per V1 contract — no performance-curve lookups.
          Cooling-demand input from State 2 (free-running comfort-band integral) is a known upper bound — HVAC-clamped demand is a future refinement.
          Carbon factors: electricity 0.207, gas 0.183 kg CO₂e/kWh (BEIS 2024).
        </p>
      </div>
    </div>
  )
}
