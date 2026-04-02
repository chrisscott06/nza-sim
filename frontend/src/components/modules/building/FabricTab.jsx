import { useContext, useEffect, useState } from 'react'
import { ProjectContext } from '../../../context/ProjectContext.jsx'

const ELEMENTS = [
  { key: 'external_wall', label: 'External Wall',  types: ['wall'] },
  { key: 'roof',          label: 'Roof',           types: ['roof'] },
  { key: 'ground_floor',  label: 'Ground Floor',   types: ['floor', 'ground_floor'] },
  { key: 'glazing',       label: 'Glazing',        types: ['glazing', 'window'] },
]

function UValueBadge({ u }) {
  if (u == null) return null
  const color =
    u <= 0.18 ? '#16A34A' :
    u <= 0.28 ? '#ECB01F' :
               '#DC2626'
  return (
    <span
      className="text-xxs font-semibold px-1.5 py-0.5 rounded"
      style={{ backgroundColor: color + '20', color }}
    >
      U = {Number(u).toFixed(2)} W/m²K
    </span>
  )
}

function ThermalMassBadge({ mass }) {
  if (!mass) return null
  const map = {
    heavy:  { label: 'Heavy mass',  cls: 'bg-orange-50 text-orange-700' },
    medium: { label: 'Medium mass', cls: 'bg-amber-50 text-amber-700' },
    light:  { label: 'Light mass',  cls: 'bg-sky-50 text-sky-700' },
    none:   { label: 'No mass',     cls: 'bg-gray-50 text-gray-500' },
  }
  const cfg = map[mass.toLowerCase()] ?? map.light
  return (
    <span className={`text-xxs font-medium px-1.5 py-0.5 rounded ${cfg.cls}`}>
      {cfg.label}
    </span>
  )
}

/** Compact layer stack — coloured bars proportional to thickness */
function MiniBuildup({ layers }) {
  if (!layers || layers.length === 0) return null

  const totalThickness = layers.reduce((s, l) => s + (l.thickness ?? 0), 0)

  return (
    <div className="flex flex-col gap-0.5 mt-1.5">
      {layers.map((layer, i) => {
        const pct = totalThickness > 0
          ? Math.max(8, Math.round((layer.thickness / totalThickness) * 60))
          : 12

        const nameL = layer.name.toLowerCase()
        const barColour =
          nameL.includes('insul')                     ? 'bg-yellow-300' :
          nameL.includes('plaster') || nameL.includes('board') ? 'bg-sky-200' :
          nameL.includes('glass') || nameL.includes('glaz')    ? 'bg-cyan-200' :
          nameL.includes('render') || nameL.includes('finish')  ? 'bg-slate-200' :
                                                                   'bg-gray-300'

        return (
          <div key={i} className="flex items-center gap-1.5">
            <div
              className={`${barColour} rounded-sm flex-shrink-0`}
              style={{ width: `${pct}px`, height: '10px' }}
              title={`${layer.name} — ${layer.thickness != null ? Math.round(layer.thickness * 1000) + ' mm' : '—'}`}
            />
            <span className="text-xxs text-mid-grey truncate">
              {layer.name}
              {layer.thickness != null && ` · ${Math.round(layer.thickness * 1000)} mm`}
            </span>
          </div>
        )
      })}
    </div>
  )
}

function ConstructionSelect({ elementKey, label, constructions, selectedId, onSelect, detail }) {
  const selected = constructions.find(c => c.name === selectedId)

  // Extract layers from the fetched detail (epjson data)
  const layers = (() => {
    if (!detail) return []
    const epjson = detail.definition ?? {}
    const out = []
    for (const matType of Object.keys(epjson)) {
      if (!matType.startsWith('Material') && !matType.startsWith('WindowMaterial')) continue
      for (const [name, mat] of Object.entries(epjson[matType] ?? {})) {
        out.push({ name, thickness: mat.thickness ?? null, conductivity: mat.conductivity ?? null })
      }
    }
    return out
  })()

  return (
    <div className="bg-white rounded-lg border border-light-grey p-3 space-y-1.5">
      <p className="text-xxs uppercase tracking-wider text-mid-grey">{label}</p>

      <select
        value={selectedId ?? ''}
        onChange={e => onSelect(elementKey, e.target.value || null)}
        className="
          w-full px-2 py-1.5 text-caption text-navy
          border border-light-grey rounded bg-white
          focus:outline-none focus:border-teal transition-colors
          appearance-none cursor-pointer
        "
        style={{
          backgroundImage: `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='12' viewBox='0 0 24 24' fill='none' stroke='%2395A5A6' stroke-width='2'%3E%3Cpolyline points='6 9 12 15 18 9'/%3E%3C/svg%3E")`,
          backgroundRepeat: 'no-repeat',
          backgroundPosition: 'right 8px center',
          paddingRight: '28px',
        }}
      >
        <option value="">— select construction —</option>
        {constructions.map(c => (
          <option key={c.name} value={c.name}>{c.description ?? c.name}</option>
        ))}
      </select>

      {selected && (
        <div className="flex flex-wrap gap-1.5 pt-0.5">
          <UValueBadge u={selected.u_value_W_per_m2K} />
          {selected.g_value != null && (
            <span className="text-xxs text-mid-grey">g = {selected.g_value}</span>
          )}
          <ThermalMassBadge mass={selected.thermal_mass} />
        </div>
      )}

      {layers.length > 0 && <MiniBuildup layers={layers} />}
    </div>
  )
}

function AirtightnessGuidance({ ach }) {
  if (ach < 0.3) return <p className="text-xxs text-green-600 mt-1">Very airtight (Passivhaus level)</p>
  if (ach <= 0.6) return <p className="text-xxs text-green-600 mt-1">Good (modern construction)</p>
  if (ach <= 1.0) return <p className="text-xxs text-amber-600 mt-1">Average (typical existing building)</p>
  return <p className="text-xxs text-red-600 mt-1">Leaky (poor airtightness)</p>
}

function achLabel(ach) {
  if (ach < 0.3)  return { text: 'Very airtight', color: 'text-green-600' }
  if (ach <= 0.6) return { text: 'Good',          color: 'text-green-600' }
  if (ach <= 1.0) return { text: 'Average',        color: 'text-amber-600' }
  return                  { text: 'Leaky',          color: 'text-red-600'  }
}

export default function FabricTab({ onDetailChange }) {
  const { constructions: selected, updateConstruction, params, updateParam } = useContext(ProjectContext)

  const [library, setLibrary]   = useState([])
  const [loading, setLoading]   = useState(true)
  const [error, setError]       = useState(null)
  // Cache of full detail by construction name
  const [details, setDetails]   = useState({})

  useEffect(() => {
    fetch('/api/library/constructions')
      .then(r => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`)
        return r.json()
      })
      .then(data => { setLibrary(data.constructions ?? []); setLoading(false) })
      .catch(err => { setError(err.message); setLoading(false) })
  }, [])

  // Fetch detail for each selected construction when selection changes
  useEffect(() => {
    if (!selected) return
    for (const key of Object.keys(selected)) {
      const name = selected[key]
      if (name && !details[name]) {
        fetch(`/api/library/constructions/${name}`)
          .then(r => r.ok ? r.json() : null)
          .then(data => {
            if (data) {
              setDetails(d => ({ ...d, [name]: data }))
              if (onDetailChange) onDetailChange(name, data)
            }
          })
          .catch(() => {})
      }
    }
  }, [selected])

  if (loading) {
    return (
      <div className="p-3 flex items-center justify-center h-40 text-caption text-mid-grey">
        Loading construction library…
      </div>
    )
  }

  if (error) {
    return (
      <div className="p-3 flex items-center justify-center h-40 text-caption text-red-600">
        Failed to load library: {error}
      </div>
    )
  }

  const byType = (types) => {
    const filtered = library.filter(c =>
      types.some(t => (c.type ?? '').toLowerCase() === t)
    )
    return filtered.length > 0 ? filtered : library
  }

  return (
    <div className="p-3 space-y-3">
      {ELEMENTS.map(({ key, label, types }) => (
        <ConstructionSelect
          key={key}
          elementKey={key}
          label={label}
          constructions={byType(types)}
          selectedId={selected?.[key] ?? null}
          onSelect={updateConstruction}
          detail={details[selected?.[key]] ?? null}
        />
      ))}

      {/* Infiltration rate */}
      <div className="bg-white rounded-lg border border-light-grey p-3 space-y-2">
        <p className="text-xxs uppercase tracking-wider text-mid-grey">Air Permeability</p>
        <div className="flex items-center gap-2">
          <input
            type="range"
            min={0.1}
            max={2.0}
            step={0.05}
            value={params?.infiltration_ach ?? 0.5}
            onChange={e => updateParam('infiltration_ach', parseFloat(e.target.value))}
            className="flex-1 accent-teal"
          />
          <span className="text-caption font-semibold text-navy w-14 text-right">
            {(params?.infiltration_ach ?? 0.5).toFixed(2)} ACH
          </span>
        </div>
        <AirtightnessGuidance ach={params?.infiltration_ach ?? 0.5} />
      </div>

      {/* Fabric summary — U-values + infiltration at a glance */}
      <div className="bg-off-white rounded-lg border border-light-grey p-3">
        <p className="text-xxs uppercase tracking-wider text-mid-grey mb-2">Fabric summary</p>
        <div className="space-y-1.5">
          {ELEMENTS.map(({ key, label }) => {
            const name = selected?.[key]
            const u    = details[name]?.config_json?.u_value
            return (
              <div key={key} className="flex items-center justify-between">
                <span className="text-xxs text-dark-grey">{label}</span>
                {u != null
                  ? <UValueBadge u={u} />
                  : <span className="text-xxs text-mid-grey">No selection</span>
                }
              </div>
            )
          })}
          <div className="flex items-center justify-between pt-1.5 border-t border-light-grey">
            <span className="text-xxs text-dark-grey">Air permeability</span>
            <div className="flex items-center gap-2">
              {(() => {
                const a = achLabel(params?.infiltration_ach ?? 0.5)
                return <span className={`text-xxs ${a.color}`}>{a.text}</span>
              })()}
              <span className="text-xxs font-semibold text-navy">{(params?.infiltration_ach ?? 0.5).toFixed(2)} ACH</span>
            </div>
          </div>
        </div>
      </div>

      <p className="text-xxs text-mid-grey pt-1">
        U-values from NZA construction library. Selections are used directly in the EnergyPlus simulation.
      </p>
    </div>
  )
}
