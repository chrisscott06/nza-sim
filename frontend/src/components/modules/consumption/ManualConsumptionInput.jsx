/**
 * ManualConsumptionInput.jsx
 *
 * Full-area workspace for entering annual consumption when half-hourly
 * data isn't available. Replaces the cramped sidebar form.
 *
 * Layout:
 *   - One card per year, with generous fuel-row inputs
 *   - "+ Add another year" button between cards
 *   - When ≥2 years have data, a multi-year comparison chart appears
 *
 * Reads existing manual datasets via /api/projects/{id}/consumption,
 * groups them by year, and pre-populates each year card.
 *
 * Props:
 *   projectId — string
 *   gia       — number (m², from project geometry)
 *   onSaved   — callback after a successful per-year save (to refresh list)
 *   onClose   — callback to exit Manual mode
 */

import { useState, useEffect, useMemo } from 'react'
import {
  Plus, Trash2, CheckCircle2, AlertTriangle, AlertOctagon,
  X as XIcon, ChevronDown, ChevronUp,
} from 'lucide-react'
import {
  ComposedChart, Bar, Line, XAxis, YAxis, CartesianGrid,
  Tooltip, Legend, ReferenceLine, ResponsiveContainer,
} from 'recharts'

// ── Carbon factors (kgCO₂e/kWh) — UK Gov GHG 2023 ─────────────────────────────
const CARBON_FACTORS = {
  electricity:      0.207,
  gas:              0.183,
  oil:              0.247,
  lpg:              0.214,
  biomass:          0.015,
  district_heating: 0.168,
}

// ── CRREM V2.07 1.5°C UK Hotel EUI targets (kWh/m²) ──────────────────────────
const CRREM_EUI = {
  2020: 264.0, 2021: 248.6, 2022: 234.1, 2023: 220.4, 2024: 207.6,
  2025: 195.5, 2026: 184.1, 2027: 173.3, 2028: 163.2, 2029: 153.7,
  2030: 144.7, 2031: 136.3, 2032: 128.3, 2033: 120.8, 2034: 113.8,
  2035: 107.1, 2036: 100.9, 2037: 95.0,
}

function crremTarget(year) {
  if (year in CRREM_EUI) return CRREM_EUI[year]
  const years = Object.keys(CRREM_EUI).map(Number).sort((a, b) => a - b)
  const lo = Math.max(...years.filter(y => y <= year))
  const hi = Math.min(...years.filter(y => y >= year))
  if (!isFinite(lo)) return CRREM_EUI[years[0]]
  if (!isFinite(hi) || lo === hi) return CRREM_EUI[lo]
  return CRREM_EUI[lo] + ((year - lo) / (hi - lo)) * (CRREM_EUI[hi] - CRREM_EUI[lo])
}

const FUEL_OPTIONS = [
  { id: 'electricity',      label: 'Electricity',     color: '#F59E0B' },
  { id: 'gas',              label: 'Natural Gas',     color: '#DC2626' },
  { id: 'oil',              label: 'Oil',             color: '#7F1D1D' },
  { id: 'lpg',              label: 'LPG',             color: '#A16207' },
  { id: 'biomass',          label: 'Biomass',         color: '#15803D' },
  { id: 'district_heating', label: 'District Heating',color: '#9333EA' },
]
const FUEL_BY_ID = Object.fromEntries(FUEL_OPTIONS.map(f => [f.id, f]))

const SOURCE_OPTIONS = [
  { id: 'invoice',      label: 'Invoice'      },
  { id: 'utility_bill', label: 'Utility Bill' },
  { id: 'estimate',     label: 'Estimate'     },
  { id: 'dec',          label: 'DEC'          },
  { id: 'sub_metered',  label: 'Sub-metered'  },
]

const CURRENT_YEAR = new Date().getFullYear()

// Format on display, parse on edit
const formatNumber = n => n != null ? Math.round(n).toLocaleString() : '—'
const stripCommas  = s => String(s ?? '').replace(/[^\d.-]/g, '')

// ── Main workspace ─────────────────────────────────────────────────────────────

export default function ManualConsumptionInput({ projectId, gia = 0, onSaved, onClose }) {
  // years: { [year]: { fuels: [{id, type, kwh, source}], saving, savedAt, error } }
  const [years, setYears] = useState({})

  // Load existing manual datasets and prefill cards
  useEffect(() => {
    if (!projectId) return
    fetch(`/api/projects/${projectId}/consumption`)
      .then(r => r.ok ? r.json() : { datasets: [] })
      .then(d => {
        const datasets = d.datasets ?? []
        const byYear = {}
        let id = 1
        for (const ds of datasets) {
          const yr = Number(ds.data_start?.slice(0, 4))
          if (!yr || isNaN(yr)) continue
          if (!byYear[yr]) byYear[yr] = { fuels: [] }
          const fuel = ds.fuel_type?.toLowerCase()
          if (fuel && FUEL_BY_ID[fuel]) {
            byYear[yr].fuels.push({
              id: id++,
              type: fuel,
              kwh: String(Math.round(ds.total_kwh ?? 0)),
              source: 'invoice',
            })
          }
        }
        // If nothing exists, seed with the current year, electricity + gas
        if (Object.keys(byYear).length === 0) {
          byYear[CURRENT_YEAR] = {
            fuels: [
              { id: id++, type: 'electricity', kwh: '', source: 'invoice' },
              { id: id++, type: 'gas',         kwh: '', source: 'invoice' },
            ],
          }
        }
        setYears(byYear)
      })
      .catch(() => {
        setYears({
          [CURRENT_YEAR]: {
            fuels: [
              { id: 1, type: 'electricity', kwh: '', source: 'invoice' },
              { id: 2, type: 'gas',         kwh: '', source: 'invoice' },
            ],
          },
        })
      })
  }, [projectId])

  const sortedYears = Object.keys(years).map(Number).sort((a, b) => b - a)

  function addYear() {
    const existing = sortedYears
    const newYear = existing.length > 0 ? Math.min(...existing) - 1 : CURRENT_YEAR
    if (years[newYear]) return
    const baseId = Date.now()
    setYears(y => ({
      ...y,
      [newYear]: {
        fuels: [
          { id: baseId,     type: 'electricity', kwh: '', source: 'invoice' },
          { id: baseId + 1, type: 'gas',         kwh: '', source: 'invoice' },
        ],
      },
    }))
  }

  function changeYear(oldYear, newYear) {
    if (years[newYear] && newYear !== oldYear) return // collision — no-op
    setYears(y => {
      const { [oldYear]: data, ...rest } = y
      return { ...rest, [newYear]: data }
    })
  }

  function removeYear(yr) {
    setYears(y => {
      const { [yr]: _omit, ...rest } = y
      return rest
    })
  }

  function updateYearFuels(yr, updater) {
    setYears(y => ({ ...y, [yr]: { ...y[yr], fuels: updater(y[yr].fuels) } }))
  }

  async function saveYear(yr) {
    const data = years[yr]
    const validFuels = data.fuels.filter(f => parseFloat(stripCommas(f.kwh)) > 0)
    if (!validFuels.length) {
      setYears(y => ({ ...y, [yr]: { ...y[yr], error: 'Enter at least one non-zero value', savedAt: null } }))
      return
    }
    setYears(y => ({ ...y, [yr]: { ...y[yr], saving: true, error: null } }))
    try {
      const res = await fetch(`/api/projects/${projectId}/consumption/manual`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          year: yr,
          fuels: validFuels.map(f => ({
            type:   f.type,
            kwh:    parseFloat(stripCommas(f.kwh)),
            source: f.source,
          })),
          gia_m2: gia,
        }),
      })
      if (!res.ok) {
        const err = await res.json().catch(() => ({ detail: `HTTP ${res.status}` }))
        throw new Error(err.detail ?? `HTTP ${res.status}`)
      }
      setYears(y => ({ ...y, [yr]: { ...y[yr], saving: false, savedAt: Date.now(), error: null } }))
      onSaved?.()
    } catch (e) {
      setYears(y => ({ ...y, [yr]: { ...y[yr], saving: false, error: e.message } }))
    }
  }

  // ── Multi-year comparison data ──────────────────────────────────────────────
  const chartData = useMemo(() => {
    return sortedYears
      .slice() // copy
      .sort((a, b) => a - b) // chart ascending
      .map(yr => {
        const fuels = years[yr]?.fuels ?? []
        const row = { year: yr }
        let totalKwh = 0
        for (const f of fuels) {
          const kwh = parseFloat(stripCommas(f.kwh)) || 0
          row[f.type] = (row[f.type] ?? 0) + kwh
          totalKwh += kwh
        }
        row.eui = gia > 0 && totalKwh > 0 ? Math.round(totalKwh / gia) : null
        row.target = Math.round(crremTarget(yr))
        return row
      })
      .filter(row => Object.entries(row).some(([k, v]) => k !== 'year' && k !== 'target' && v))
  }, [years, sortedYears, gia])

  const showChart = chartData.length >= 2

  return (
    <div className="flex flex-col h-full overflow-hidden">

      {/* Header */}
      <div className="flex-shrink-0 flex items-center justify-between px-6 py-3 border-b border-light-grey bg-white">
        <div>
          <h2 className="text-caption font-semibold text-navy">Annual consumption — manual entry</h2>
          <p className="text-xxs text-mid-grey mt-0.5">
            Enter total annual kWh by fuel for each year you have data for.
            {gia > 0 && <> GIA <span className="font-medium text-dark-grey">{gia.toLocaleString()} m²</span> from project geometry.</>}
          </p>
        </div>
        {onClose && (
          <button
            onClick={onClose}
            className="text-mid-grey hover:text-navy transition-colors p-1"
            title="Close manual entry"
          >
            <XIcon size={16} />
          </button>
        )}
      </div>

      {/* Scrollable body */}
      <div className="flex-1 overflow-y-auto bg-off-white">
        <div className="max-w-3xl mx-auto px-6 py-6 space-y-4">

          {sortedYears.map(yr => (
            <YearCard
              key={yr}
              year={yr}
              data={years[yr]}
              gia={gia}
              isOnly={sortedYears.length === 1}
              existingYears={sortedYears}
              onYearChange={newYr => changeYear(yr, newYr)}
              onRemoveYear={() => removeYear(yr)}
              onFuelsChange={updater => updateYearFuels(yr, updater)}
              onSave={() => saveYear(yr)}
            />
          ))}

          <button
            onClick={addYear}
            className="w-full flex items-center justify-center gap-2 py-3 rounded-xl border border-dashed border-light-grey hover:border-teal hover:bg-teal/5 transition-colors text-caption text-mid-grey hover:text-teal"
          >
            <Plus size={14} />
            Add another year
          </button>

          {showChart && (
            <div className="bg-white rounded-xl border border-light-grey overflow-hidden">
              <div className="px-5 py-3 border-b border-light-grey">
                <h3 className="text-caption font-semibold text-navy">Multi-year comparison</h3>
                <p className="text-xxs text-mid-grey mt-0.5">
                  Stacked bars show fuel split per year. The line shows EUI versus the CRREM 1.5°C target.
                </p>
              </div>
              <div className="p-5">
                <MultiYearChart data={chartData} />
              </div>
            </div>
          )}

        </div>
      </div>
    </div>
  )
}

// ── YearCard ───────────────────────────────────────────────────────────────────

function YearCard({ year, data, gia, isOnly, existingYears, onYearChange, onRemoveYear, onFuelsChange, onSave }) {
  const [collapsed, setCollapsed] = useState(false)
  const fuels = data?.fuels ?? []
  const saving  = !!data?.saving
  const error   = data?.error
  const savedAt = data?.savedAt
  const justSaved = savedAt && (Date.now() - savedAt < 4000)

  // ── Derived ─────────────────────────────────────────────────────────────────
  const metrics = useMemo(() => {
    const totalKwh = fuels.reduce((s, f) => s + (parseFloat(stripCommas(f.kwh)) || 0), 0)
    const eui      = gia > 0 && totalKwh > 0 ? totalKwh / gia : null
    const carbon   = fuels.reduce((s, f) => {
      const kwh = parseFloat(stripCommas(f.kwh)) || 0
      return s + kwh * (CARBON_FACTORS[f.type] ?? 0)
    }, 0)
    const carbonIntensity = gia > 0 && carbon > 0 ? carbon / gia : null
    const target = crremTarget(year)
    const gap    = eui != null ? eui - target : null
    const status = gap == null ? null : gap <= 0 ? 'aligned' : gap <= 20 ? 'at-risk' : 'non-compliant'
    return { totalKwh, eui, carbonIntensity, target, gap, status }
  }, [fuels, gia, year])

  function addFuel() {
    const used = fuels.map(f => f.type)
    const next = FUEL_OPTIONS.find(o => !used.includes(o.id))
    if (!next) return
    onFuelsChange(prev => [
      ...prev,
      { id: Date.now(), type: next.id, kwh: '', source: 'invoice' },
    ])
  }
  function removeFuel(id) {
    onFuelsChange(prev => prev.filter(f => f.id !== id))
  }
  function updateFuel(id, field, value) {
    onFuelsChange(prev => prev.map(f => f.id === id ? { ...f, [field]: value } : f))
  }

  const yearOptions = []
  for (let y = CURRENT_YEAR + 1; y >= 2018; y--) {
    if (y === year || !existingYears.includes(y)) yearOptions.push(y)
  }

  const statusConfig = {
    aligned:        { Icon: CheckCircle2,  color: '#16A34A', bg: '#F0FDF4', border: '#BBF7D0', label: 'ALIGNED' },
    'at-risk':      { Icon: AlertTriangle, color: '#D97706', bg: '#FFFBEB', border: '#FDE68A', label: 'AT RISK' },
    'non-compliant':{ Icon: AlertOctagon,  color: '#DC2626', bg: '#FEF2F2', border: '#FECACA', label: 'NON-COMPLIANT' },
  }
  const sc = metrics.status ? statusConfig[metrics.status] : null

  return (
    <div className="bg-white rounded-xl border border-light-grey overflow-hidden">

      {/* Card header */}
      <div className="flex items-center justify-between px-5 py-3 border-b border-light-grey">
        <div className="flex items-center gap-3">
          <select
            value={year}
            onChange={e => onYearChange(Number(e.target.value))}
            className="text-heading font-bold text-navy bg-transparent border-none focus:outline-none cursor-pointer"
          >
            {yearOptions.map(y => <option key={y} value={y}>{y}</option>)}
          </select>
          {metrics.totalKwh > 0 && (
            <span className="text-xxs text-mid-grey tabular-nums">
              · {formatNumber(metrics.totalKwh)} kWh total
            </span>
          )}
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => setCollapsed(c => !c)}
            className="text-mid-grey hover:text-navy transition-colors p-1"
            title={collapsed ? 'Expand' : 'Collapse'}
          >
            {collapsed ? <ChevronDown size={14} /> : <ChevronUp size={14} />}
          </button>
          {!isOnly && (
            <button
              onClick={onRemoveYear}
              className="text-mid-grey hover:text-red-500 transition-colors p-1"
              title="Remove this year"
            >
              <Trash2 size={13} />
            </button>
          )}
        </div>
      </div>

      {!collapsed && (
        <div className="px-5 py-4 space-y-3">

          {/* Fuel rows */}
          <div className="space-y-2">
            {fuels.map(fuel => {
              const fuelMeta = FUEL_BY_ID[fuel.type]
              return (
                <div key={fuel.id} className="flex items-center gap-3">
                  {/* Fuel type pill */}
                  <div className="flex items-center gap-2 w-44 flex-shrink-0">
                    <span
                      className="w-2 h-2 rounded-full flex-shrink-0"
                      style={{ backgroundColor: fuelMeta?.color ?? '#9CA3AF' }}
                    />
                    <select
                      value={fuel.type}
                      onChange={e => updateFuel(fuel.id, 'type', e.target.value)}
                      className="flex-1 px-2 py-2 text-caption text-navy border border-light-grey rounded-lg focus:outline-none focus:border-teal bg-white"
                    >
                      {FUEL_OPTIONS.map(o => (
                        <option key={o.id} value={o.id}>{o.label}</option>
                      ))}
                    </select>
                  </div>

                  {/* kWh input — the star of the show */}
                  <div className="flex-1 relative">
                    <input
                      type="text"
                      inputMode="numeric"
                      value={fuel.kwh ? formatNumber(parseFloat(stripCommas(fuel.kwh))) : ''}
                      onChange={e => updateFuel(fuel.id, 'kwh', stripCommas(e.target.value))}
                      placeholder="0"
                      className="w-full px-4 py-2 text-lg font-semibold text-navy border border-light-grey rounded-lg focus:outline-none focus:border-teal focus:ring-2 focus:ring-teal/20 bg-white text-right tabular-nums pr-14"
                    />
                    <span className="absolute right-4 top-1/2 -translate-y-1/2 text-xxs text-mid-grey font-medium pointer-events-none">
                      kWh
                    </span>
                  </div>

                  {/* Source */}
                  <select
                    value={fuel.source}
                    onChange={e => updateFuel(fuel.id, 'source', e.target.value)}
                    className="w-28 flex-shrink-0 px-2 py-2 text-xxs text-dark-grey border border-light-grey rounded-lg focus:outline-none focus:border-teal bg-white"
                  >
                    {SOURCE_OPTIONS.map(o => (
                      <option key={o.id} value={o.id}>{o.label}</option>
                    ))}
                  </select>

                  {/* Remove */}
                  {fuels.length > 1 && (
                    <button
                      onClick={() => removeFuel(fuel.id)}
                      className="text-mid-grey hover:text-red-500 transition-colors p-1.5 flex-shrink-0"
                      title="Remove fuel"
                    >
                      <Trash2 size={13} />
                    </button>
                  )}
                </div>
              )
            })}

            {fuels.length < FUEL_OPTIONS.length && (
              <button
                onClick={addFuel}
                className="flex items-center gap-1.5 text-xxs text-mid-grey hover:text-teal transition-colors py-1"
              >
                <Plus size={12} />
                Add fuel
              </button>
            )}
          </div>

          {/* Live metrics */}
          {metrics.totalKwh > 0 && (
            <div className="flex flex-wrap items-center gap-x-5 gap-y-1 pt-3 border-t border-light-grey/60 text-xxs">
              {metrics.eui != null && (
                <Stat label="EUI" value={`${metrics.eui.toFixed(0)} kWh/m²`} bold />
              )}
              <Stat label={`CRREM ${year}`} value={`${metrics.target.toFixed(0)} kWh/m²`} />
              {metrics.gap != null && (
                <Stat
                  label="Gap"
                  value={`${metrics.gap > 0 ? '+' : ''}${metrics.gap.toFixed(0)} kWh/m²`}
                  color={metrics.gap <= 0 ? '#16A34A' : metrics.gap <= 20 ? '#D97706' : '#DC2626'}
                />
              )}
              {metrics.carbonIntensity != null && (
                <Stat label="Carbon" value={`${metrics.carbonIntensity.toFixed(1)} kgCO₂/m²`} />
              )}
            </div>
          )}

          {/* Status badge */}
          {sc && (
            <div
              className="flex items-center gap-2 px-3 py-2 rounded-lg border"
              style={{ backgroundColor: sc.bg, borderColor: sc.border }}
            >
              <sc.Icon size={13} style={{ color: sc.color }} />
              <span className="text-xxs font-semibold" style={{ color: sc.color }}>{sc.label}</span>
              {metrics.gap != null && metrics.gap > 0 && (
                <span className="text-xxs text-mid-grey">
                  — {metrics.gap.toFixed(0)} kWh/m² above target
                </span>
              )}
              {metrics.gap != null && metrics.gap <= 0 && (
                <span className="text-xxs text-mid-grey">
                  — {Math.abs(metrics.gap).toFixed(0)} kWh/m² headroom
                </span>
              )}
            </div>
          )}

          {/* Errors */}
          {error && <p className="text-xxs text-red-600">{error}</p>}

          {/* Save row */}
          <div className="flex items-center justify-between pt-2">
            <p className="text-xxs text-mid-grey">
              {justSaved ? '✓ Saved' : 'Changes are not saved until you click Save.'}
            </p>
            <button
              onClick={onSave}
              disabled={saving || metrics.totalKwh === 0}
              className="px-4 py-2 text-caption font-medium text-white rounded-lg transition-colors disabled:opacity-40"
              style={{ backgroundColor: justSaved ? '#16A34A' : '#2D6A7A' }}
            >
              {saving ? 'Saving…' : justSaved ? 'Saved' : `Save ${year} data`}
            </button>
          </div>

        </div>
      )}
    </div>
  )
}

function Stat({ label, value, color, bold }) {
  return (
    <span className="flex items-baseline gap-1">
      <span className="text-mid-grey">{label}</span>
      <span
        className={`tabular-nums ${bold ? 'font-semibold' : 'font-medium'}`}
        style={{ color: color ?? '#1F2937' }}
      >
        {value}
      </span>
    </span>
  )
}

// ── MultiYearChart ─────────────────────────────────────────────────────────────

function MultiYearChart({ data }) {
  // Determine which fuels are actually present across years
  const fuelTypesPresent = FUEL_OPTIONS
    .map(f => f.id)
    .filter(t => data.some(row => row[t] && row[t] > 0))

  const formatTooltip = (value, name) => {
    if (name === 'EUI') return [`${value} kWh/m²`, 'EUI']
    if (name === 'CRREM target') return [`${value} kWh/m²`, 'CRREM target']
    const label = FUEL_BY_ID[name]?.label ?? name
    return [`${formatNumber(value)} kWh`, label]
  }

  return (
    <div className="w-full h-[320px]">
      <ResponsiveContainer width="100%" height="100%">
        <ComposedChart data={data} margin={{ top: 10, right: 30, left: 0, bottom: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#F0F0F0" vertical={false} />
          <XAxis dataKey="year" tick={{ fontSize: 11, fill: '#6B7280' }} tickLine={false} axisLine={{ stroke: '#E5E7EB' }} />
          <YAxis
            yAxisId="kwh"
            tick={{ fontSize: 11, fill: '#6B7280' }}
            tickLine={false}
            axisLine={false}
            tickFormatter={v => `${(v / 1000).toFixed(0)}k`}
          />
          <YAxis
            yAxisId="eui"
            orientation="right"
            tick={{ fontSize: 11, fill: '#6B7280' }}
            tickLine={false}
            axisLine={false}
            tickFormatter={v => `${v}`}
          />
          <Tooltip
            formatter={formatTooltip}
            contentStyle={{ fontSize: 11, padding: '6px 10px', borderRadius: 6, border: '1px solid #E5E7EB' }}
          />
          <Legend wrapperStyle={{ fontSize: 11, paddingTop: 10 }} iconType="circle" iconSize={8} />

          {/* Stacked fuel bars */}
          {fuelTypesPresent.map(fuelId => (
            <Bar
              key={fuelId}
              yAxisId="kwh"
              dataKey={fuelId}
              stackId="fuel"
              name={fuelId}
              fill={FUEL_BY_ID[fuelId].color}
              radius={[0, 0, 0, 0]}
            />
          ))}

          {/* EUI vs CRREM target lines */}
          <Line
            yAxisId="eui"
            type="monotone"
            dataKey="eui"
            name="EUI"
            stroke="#1F2937"
            strokeWidth={2}
            dot={{ r: 4, fill: '#1F2937', stroke: '#fff', strokeWidth: 1.5 }}
            connectNulls
          />
          <Line
            yAxisId="eui"
            type="monotone"
            dataKey="target"
            name="CRREM target"
            stroke="#DC2626"
            strokeWidth={1.5}
            strokeDasharray="5 3"
            dot={false}
          />
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  )
}
