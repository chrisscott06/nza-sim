import { useContext, useEffect, useState } from 'react'
import { BuildingContext } from '../../../context/BuildingContext.jsx'

const ELEMENTS = [
  { key: 'external_wall', label: 'External Wall' },
  { key: 'roof',          label: 'Roof' },
  { key: 'ground_floor',  label: 'Ground Floor' },
  { key: 'glazing',       label: 'Glazing' },
]


function UValueBadge({ u }) {
  if (u == null) return null
  // Colour coding: green ≤0.18, amber ≤0.28, red >0.28
  const color =
    u <= 0.18 ? '#16A34A' :
    u <= 0.28 ? '#ECB01F' :
               '#DC2626'
  return (
    <span
      className="text-xxs font-medium px-1.5 py-0.5 rounded"
      style={{ backgroundColor: color + '22', color }}
    >
      U = {u} W/m²K
    </span>
  )
}


function ConstructionSelect({ elementKey, label, constructions, selectedId, onSelect }) {
  // API uses `name` as the identifier; description is the human-readable label
  const selected = constructions.find(c => c.name === selectedId)

  return (
    <div className="bg-white rounded-lg border border-light-grey p-3 space-y-2">
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
        <div className="flex items-center gap-2 pt-0.5">
          <UValueBadge u={selected.u_value_W_per_m2K} />
          {selected.g_value != null && (
            <span className="text-xxs text-mid-grey">g = {selected.g_value}</span>
          )}
        </div>
      )}
    </div>
  )
}

export default function FabricTab() {
  const { constructions: selected, updateConstruction } = useContext(BuildingContext)

  const [library, setLibrary]   = useState([])
  const [loading, setLoading]   = useState(true)
  const [error, setError]       = useState(null)

  useEffect(() => {
    fetch('/api/library/constructions')
      .then(r => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`)
        return r.json()
      })
      .then(data => { setLibrary(data.constructions ?? []); setLoading(false) })
      .catch(err => { setError(err.message); setLoading(false) })
  }, [])

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

  // Filter by the 'type' field returned by the API
  const byType = (elementKey) => {
    const typeMap = {
      external_wall: ['wall'],
      roof:          ['roof'],
      ground_floor:  ['floor', 'ground_floor'],
      glazing:       ['glazing', 'window'],
    }
    const tags = typeMap[elementKey] ?? []
    const filtered = library.filter(c =>
      tags.some(t => (c.type ?? '').toLowerCase() === t)
    )
    return filtered.length > 0 ? filtered : library
  }

  return (
    <div className="p-3 space-y-3">
      {ELEMENTS.map(({ key, label }) => (
        <ConstructionSelect
          key={key}
          elementKey={key}
          label={label}
          constructions={byType(key)}
          selectedId={selected?.[key] ?? null}
          onSelect={updateConstruction}
        />
      ))}

      <p className="text-xxs text-mid-grey pt-1">
        U-values from NZA construction library. Selections are used directly in the EnergyPlus simulation.
      </p>
    </div>
  )
}
