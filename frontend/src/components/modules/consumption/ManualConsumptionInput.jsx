/**
 * ManualConsumptionInput.jsx
 *
 * Form for entering annual consumption by fuel type when HH data isn't available.
 * Supports multiple fuels. Shows live EUI, carbon, and CRREM status.
 *
 * Props:
 *   projectId  — string
 *   gia        — number (m², from project params)
 *   onSaved    — callback after successful save (to refresh dataset list)
 */

import { useState, useMemo } from 'react'
import { Plus, Trash2, CheckCircle2, AlertTriangle, AlertOctagon } from 'lucide-react'

// ── Carbon factors (kgCO₂e/kWh) ──────────────────────────────────────────────
// Sources: UK Gov GHG Conversion Factors 2023
const CARBON_FACTORS = {
  electricity:       0.207,  // UK grid 2023 average (DESNZ) — actual grid factor not used here
  gas:               0.183,
  oil:               0.247,
  lpg:               0.214,
  biomass:           0.015,  // scope 1 only
  district_heating:  0.168,
}

// CRREM V2.07 1.5°C UK Hotel EUI targets (kWh/m²)
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
  { id: 'electricity',      label: 'Electricity' },
  { id: 'gas',              label: 'Natural Gas' },
  { id: 'oil',              label: 'Oil' },
  { id: 'lpg',              label: 'LPG' },
  { id: 'biomass',          label: 'Biomass' },
  { id: 'district_heating', label: 'District Heating' },
]

const SOURCE_OPTIONS = [
  { id: 'invoice',      label: 'Invoice' },
  { id: 'utility_bill', label: 'Utility Bill' },
  { id: 'estimate',     label: 'Estimate' },
  { id: 'dec',          label: 'DEC' },
  { id: 'sub_metered',  label: 'Sub-metered' },
]

const CURRENT_YEAR = new Date().getFullYear()
const YEAR_OPTIONS = Array.from({ length: CURRENT_YEAR - 2019 }, (_, i) => CURRENT_YEAR - i)

function fmtNum(n) {
  return n != null ? Math.round(n).toLocaleString() : '—'
}

export default function ManualConsumptionInput({ projectId, gia = 0, onSaved }) {
  const [year, setYear]     = useState(CURRENT_YEAR)
  const [fuels, setFuels]   = useState([
    { id: 1, type: 'electricity', kwh: '', source: 'invoice' },
    { id: 2, type: 'gas',         kwh: '', source: 'invoice' },
  ])
  const [saving,  setSaving]  = useState(false)
  const [error,   setError]   = useState(null)
  const [success, setSuccess] = useState(false)

  let nextId = Math.max(...fuels.map(f => f.id)) + 1

  // ── Derived metrics ─────────────────────────────────────────────────────────
  const metrics = useMemo(() => {
    const totalKwh = fuels.reduce((s, f) => s + (parseFloat(f.kwh) || 0), 0)
    const eui      = gia > 0 && totalKwh > 0 ? totalKwh / gia : null
    const carbon   = fuels.reduce((s, f) => {
      const kwh = parseFloat(f.kwh) || 0
      return s + kwh * (CARBON_FACTORS[f.type] ?? 0)
    }, 0)
    const carbonIntensity = gia > 0 && carbon > 0 ? carbon / gia : null
    const target   = crremTarget(year)
    const gap      = eui != null ? eui - target : null
    const elecKwh  = fuels.filter(f => f.type === 'electricity').reduce((s, f) => s + (parseFloat(f.kwh) || 0), 0)
    const elecPct  = totalKwh > 0 ? (elecKwh / totalKwh) * 100 : 0

    const status = gap == null ? null : gap <= 0 ? 'aligned' : gap <= 20 ? 'at-risk' : 'non-compliant'

    return { totalKwh, eui, carbon, carbonIntensity, target, gap, elecPct, status }
  }, [fuels, gia, year])

  // ── Fuel row controls ───────────────────────────────────────────────────────
  function addFuel() {
    const usedTypes = fuels.map(f => f.type)
    const next = FUEL_OPTIONS.find(o => !usedTypes.includes(o.id))
    if (!next) return
    setFuels(prev => [...prev, { id: nextId++, type: next.id, kwh: '', source: 'invoice' }])
  }

  function removeFuel(id) {
    setFuels(prev => prev.filter(f => f.id !== id))
  }

  function updateFuel(id, field, value) {
    setFuels(prev => prev.map(f => f.id === id ? { ...f, [field]: value } : f))
  }

  // ── Save ────────────────────────────────────────────────────────────────────
  async function handleSave() {
    const validFuels = fuels.filter(f => parseFloat(f.kwh) > 0)
    if (!validFuels.length) {
      setError('Enter at least one non-zero fuel consumption value.')
      return
    }
    setSaving(true)
    setError(null)
    setSuccess(false)
    try {
      const res = await fetch(`/api/projects/${projectId}/consumption/manual`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          year,
          fuels: validFuels.map(f => ({
            type:   f.type,
            kwh:    parseFloat(f.kwh),
            source: f.source,
          })),
          gia_m2: gia,
        }),
      })
      if (!res.ok) {
        const err = await res.json().catch(() => ({ detail: `HTTP ${res.status}` }))
        throw new Error(err.detail ?? `HTTP ${res.status}`)
      }
      setSuccess(true)
      onSaved?.()
      setTimeout(() => setSuccess(false), 3000)
    } catch (e) {
      setError(e.message)
    } finally {
      setSaving(false)
    }
  }

  const { totalKwh, eui, carbon, carbonIntensity, target, gap, elecPct, status } = metrics

  const statusConfig = {
    aligned:       { icon: CheckCircle2, color: 'text-green-600', bg: 'bg-green-50 border-green-200', label: 'ALIGNED' },
    'at-risk':     { icon: AlertTriangle, color: 'text-amber-600', bg: 'bg-amber-50 border-amber-200', label: 'AT RISK' },
    'non-compliant': { icon: AlertOctagon, color: 'text-red-600', bg: 'bg-red-50 border-red-200', label: 'NON-COMPLIANT' },
  }
  const sc = status ? statusConfig[status] : null

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="text-caption font-semibold text-navy">Manual Annual Entry</h3>
        {/* Year selector */}
        <select
          value={year}
          onChange={e => setYear(Number(e.target.value))}
          className="px-2 py-1 text-xxs border border-light-grey rounded focus:outline-none focus:border-teal"
        >
          {YEAR_OPTIONS.map(y => (
            <option key={y} value={y}>{y}</option>
          ))}
        </select>
      </div>

      {/* Fuel rows */}
      <div className="space-y-2">
        {fuels.map(fuel => (
          <div key={fuel.id} className="flex items-center gap-2">
            {/* Fuel type */}
            <select
              value={fuel.type}
              onChange={e => updateFuel(fuel.id, 'type', e.target.value)}
              className="flex-shrink-0 w-32 px-2 py-1.5 text-xxs border border-light-grey rounded focus:outline-none focus:border-teal"
            >
              {FUEL_OPTIONS.map(o => (
                <option key={o.id} value={o.id}>{o.label}</option>
              ))}
            </select>

            {/* kWh input */}
            <input
              type="number"
              min={0}
              step={1}
              placeholder="kWh"
              value={fuel.kwh}
              onChange={e => updateFuel(fuel.id, 'kwh', e.target.value)}
              className="flex-1 min-w-0 px-2 py-1.5 text-xxs border border-light-grey rounded focus:outline-none focus:border-teal text-right"
            />
            <span className="text-xxs text-mid-grey flex-shrink-0">kWh</span>

            {/* Source */}
            <select
              value={fuel.source}
              onChange={e => updateFuel(fuel.id, 'source', e.target.value)}
              className="flex-shrink-0 w-24 px-1 py-1.5 text-xxs border border-light-grey rounded focus:outline-none focus:border-teal"
            >
              {SOURCE_OPTIONS.map(o => (
                <option key={o.id} value={o.id}>{o.label}</option>
              ))}
            </select>

            {/* Remove */}
            {fuels.length > 1 && (
              <button
                onClick={() => removeFuel(fuel.id)}
                className="text-mid-grey hover:text-coral transition-colors flex-shrink-0"
                title="Remove fuel"
              >
                <Trash2 size={12} />
              </button>
            )}
          </div>
        ))}

        {/* Add fuel */}
        {fuels.length < FUEL_OPTIONS.length && (
          <button
            onClick={addFuel}
            className="flex items-center gap-1 text-xxs text-teal hover:text-navy transition-colors"
          >
            <Plus size={11} />
            Add fuel
          </button>
        )}
      </div>

      {/* GIA note */}
      {gia > 0 && (
        <p className="text-xxs text-mid-grey">
          GIA: <span className="font-medium text-navy">{gia.toLocaleString()} m²</span>
          {' '}(from project geometry)
        </p>
      )}

      {/* Live metrics */}
      {totalKwh > 0 && (
        <div className="border border-light-grey rounded-lg p-3 space-y-1.5 bg-off-white">
          <div className="grid grid-cols-2 gap-x-4 gap-y-1">
            <MetricLine label="Total" value={`${fmtNum(totalKwh)} kWh`} />
            {eui != null && <MetricLine label="EUI" value={`${eui.toFixed(1)} kWh/m²`} bold />}
            {carbonIntensity != null && <MetricLine label="Carbon" value={`${carbonIntensity.toFixed(1)} kgCO₂/m²`} />}
            <MetricLine label="Elec share" value={`${elecPct.toFixed(0)}%`} />
            <MetricLine label={`CRREM ${year}`} value={`${target.toFixed(1)} kWh/m²`} />
            {gap != null && (
              <MetricLine
                label="Gap"
                value={`${gap > 0 ? '+' : ''}${gap.toFixed(1)} kWh/m²`}
                color={gap <= 0 ? 'text-green-600' : gap <= 20 ? 'text-amber-600' : 'text-red-600'}
              />
            )}
          </div>

          {/* Status badge */}
          {sc && (
            <div className={`flex items-center gap-1.5 mt-2 px-2 py-1.5 rounded border ${sc.bg}`}>
              <sc.icon size={12} className={sc.color} />
              <span className={`text-xxs font-semibold ${sc.color}`}>{sc.label}</span>
              {gap != null && gap > 0 && (
                <span className="text-xxs text-mid-grey ml-1">
                  — {gap.toFixed(1)} kWh/m² above {year} target
                </span>
              )}
              {gap != null && gap <= 0 && (
                <span className="text-xxs text-mid-grey ml-1">
                  — {Math.abs(gap).toFixed(1)} kWh/m² headroom
                </span>
              )}
            </div>
          )}
        </div>
      )}

      {/* Error / success */}
      {error && (
        <p className="text-xxs text-coral">{error}</p>
      )}
      {success && (
        <p className="text-xxs text-green-600 flex items-center gap-1">
          <CheckCircle2 size={11} /> Saved
        </p>
      )}

      {/* Save button */}
      <button
        onClick={handleSave}
        disabled={saving || fuels.every(f => !parseFloat(f.kwh))}
        className="w-full px-3 py-2 text-xs font-medium text-white bg-teal hover:bg-teal/90 disabled:opacity-40 rounded transition-colors"
      >
        {saving ? 'Saving…' : `Save ${year} Data`}
      </button>
    </div>
  )
}

function MetricLine({ label, value, bold, color }) {
  return (
    <div className="flex items-baseline justify-between gap-1">
      <span className="text-xxs text-mid-grey">{label}</span>
      <span className={`text-xxs ${bold ? 'font-semibold text-navy' : color ?? 'text-dark-grey'}`}>{value}</span>
    </div>
  )
}
