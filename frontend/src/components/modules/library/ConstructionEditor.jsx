/**
 * ConstructionEditor.jsx
 *
 * Modal editor for creating custom constructions.
 *
 * Two modes:
 *   Quick U-value — enter target U-value, tool generates a buildup that achieves it
 *   Layer editor  — add/remove/edit individual layers; U-value recalculates in real time
 *
 * When initialItem is provided, starts in layer-editor mode with that item's layers
 * pre-populated (used for Duplicate workflow).
 */

import { useState, useEffect } from 'react'
import { X, Plus, Trash2, RefreshCw } from 'lucide-react'

// ── U-value calculation ───────────────────────────────────────────────────────
// Surface resistances (m²K/W): external 0.04, internal 0.13
const R_SURFACE = 0.17

// Fixed layer R-values per element type (excluding insulation + surface resistances)
const FIXED_R = {
  wall:        0.49,  // brick 0.12 + cavity 0.18 + block 0.13 + plasterboard 0.06 = 0.49
  roof:        0.20,  // concrete deck 0.10 + screed/membrane 0.10
  ground_floor:0.15,  // concrete slab 0.10 + screed 0.05
  glazing:     0,     // no fixed layers for glazing
}

// Default insulation material per element type
const INSULATION_DEFAULTS = {
  wall:         { name: 'Mineral Wool Insulation', conductivity: 0.035, density: 30,   specific_heat: 1030 },
  roof:         { name: 'Mineral Wool Insulation', conductivity: 0.038, density: 40,   specific_heat: 1030 },
  ground_floor: { name: 'PIR Insulation',          conductivity: 0.022, density: 30,   specific_heat: 1400 },
}

// Pre-built fixed layers per element type (displayed below insulation)
const FIXED_LAYERS = {
  wall: [
    { name: 'Facing Brick',   conductivity: 0.84, density: 2000, specific_heat: 840,  thickness: 0.105 },
    { name: 'Cavity',         conductivity: null, density: null, specific_heat: null, thickness: 0.050, note: 'Air cavity — R=0.18 assumed' },
    { name: 'Concrete Block', conductivity: 0.51, density: 1200, specific_heat: 840,  thickness: 0.100 },
    { name: 'Plasterboard',   conductivity: 0.25, density: 900,  specific_heat: 1000, thickness: 0.0125 },
  ],
  roof: [
    { name: 'Concrete Deck',  conductivity: 0.53, density: 1700, specific_heat: 840,  thickness: 0.150 },
    { name: 'Screed',         conductivity: 0.41, density: 1200, specific_heat: 840,  thickness: 0.050 },
  ],
  ground_floor: [
    { name: 'Concrete Slab',  conductivity: 0.53, density: 1700, specific_heat: 840,  thickness: 0.150 },
    { name: 'Screed',         conductivity: 0.41, density: 1200, specific_heat: 840,  thickness: 0.050 },
  ],
}

function calcUValueFromLayers(layers) {
  const R_layers = layers.reduce((sum, l) => {
    if (l.conductivity && l.conductivity > 0 && l.thickness > 0) {
      return sum + l.thickness / l.conductivity
    }
    // Air cavity: R = 0.18 m²K/W
    if (!l.conductivity && l.thickness > 0) return sum + 0.18
    return sum
  }, 0)
  const R_total = R_SURFACE + R_layers
  return R_total > 0 ? 1 / R_total : null
}

function insThicknessForUTarget(uTarget, elementType) {
  const insDef = INSULATION_DEFAULTS[elementType]
  if (!insDef || uTarget <= 0) return 0
  const R_target = 1 / uTarget
  const R_ins = R_target - R_SURFACE - FIXED_R[elementType]
  if (R_ins <= 0) return 0
  return R_ins * insDef.conductivity
}

function buildLayersFromUTarget(uTarget, elementType) {
  const insDef = INSULATION_DEFAULTS[elementType]
  if (!insDef) return []
  const thickness = insThicknessForUTarget(uTarget, elementType)
  return [
    { name: insDef.name, conductivity: insDef.conductivity, density: insDef.density, specific_heat: insDef.specific_heat, thickness: Math.max(0.010, Math.round(thickness * 1000) / 1000) },
    ...(FIXED_LAYERS[elementType] ?? []),
  ]
}

function buildEpJson(name, elementType, layers, uValue, gValue) {
  if (elementType === 'glazing') {
    const matName = `${name}_Glazing`
    return {
      Construction: {
        [name]: { outside_layer: matName },
      },
      'WindowMaterial:SimpleGlazingSystem': {
        [matName]: {
          u_factor: uValue,
          solar_heat_gain_coefficient: gValue,
        },
      },
    }
  }

  const matType = 'Material'
  const materials = {}
  const constructionLayers = {}

  layers.forEach((layer, idx) => {
    if (!layer.conductivity) return  // skip air cavities (no material object needed, represented by R-value)
    const mName = `${name}_${layer.name.replace(/\s+/g, '_')}`
    materials[mName] = {
      roughness: 'MediumRough',
      thickness: layer.thickness,
      conductivity: layer.conductivity,
      density: layer.density ?? 1000,
      specific_heat: layer.specific_heat ?? 840,
    }
    const key = idx === 0 ? 'outside_layer' : `layer_${idx + 1}`
    constructionLayers[key] = mName
  })

  return {
    Construction: { [name]: constructionLayers },
    [matType]: materials,
  }
}

// ── Layer Row ─────────────────────────────────────────────────────────────────

function LayerRow({ layer, idx, onChange, onRemove, isFirst }) {
  return (
    <div className={`flex gap-2 items-center py-2 ${isFirst ? '' : 'border-t border-light-grey'}`}>
      <div className="flex-1 min-w-0">
        <input
          type="text"
          value={layer.name}
          onChange={e => onChange(idx, 'name', e.target.value)}
          placeholder="Layer name"
          className="w-full px-2 py-1 text-xxs border border-light-grey rounded focus:outline-none focus:border-teal text-navy"
        />
      </div>
      <div className="w-16">
        <input
          type="number"
          value={Math.round((layer.thickness ?? 0) * 1000)}
          onChange={e => onChange(idx, 'thickness', parseFloat(e.target.value) / 1000 || 0)}
          placeholder="mm"
          className="w-full px-2 py-1 text-xxs border border-light-grey rounded focus:outline-none focus:border-teal text-navy"
        />
        <p className="text-xxs text-mid-grey text-center">mm</p>
      </div>
      <div className="w-16">
        <input
          type="number"
          step="0.001"
          value={layer.conductivity ?? ''}
          onChange={e => onChange(idx, 'conductivity', parseFloat(e.target.value) || null)}
          placeholder="λ"
          className="w-full px-2 py-1 text-xxs border border-light-grey rounded focus:outline-none focus:border-teal text-navy"
        />
        <p className="text-xxs text-mid-grey text-center">W/mK</p>
      </div>
      <button
        onClick={() => onRemove(idx)}
        className="text-mid-grey hover:text-red-500 flex-shrink-0"
      >
        <Trash2 size={12} />
      </button>
    </div>
  )
}

// ── Main component ────────────────────────────────────────────────────────────

export default function ConstructionEditor({ initialItem = null, onSave, onClose }) {
  const [name,        setName]        = useState('')
  const [displayName, setDisplayName] = useState('')
  const [description, setDescription] = useState('')
  const [elementType, setElementType] = useState('wall')
  const [uTarget,     setUTarget]     = useState(0.18)
  const [gValue,      setGValue]      = useState(0.40)
  const [layers,      setLayers]      = useState([])
  const [mode,        setMode]        = useState('quick')  // 'quick' | 'layers'
  const [saving,      setSaving]      = useState(false)
  const [error,       setError]       = useState(null)

  // Pre-populate from initialItem (duplicate workflow)
  useEffect(() => {
    if (!initialItem) return
    const cfg = initialItem.config_json ?? {}
    setName(`${initialItem.name}_copy`)
    setDisplayName(`${initialItem.display_name || initialItem.name} (Copy)`)
    setDescription(cfg.description ?? '')
    setElementType(cfg.type ?? 'wall')
    setGValue(cfg.g_value ?? 0.40)
    setMode('layers')

    // Extract layers from epjson
    const epjson = cfg.epjson ?? cfg.definition ?? {}
    const matLayers = []
    const matKeys = Object.keys(epjson).filter(k => k.startsWith('Material') && k !== 'Material:NoMass')
    for (const matType of matKeys) {
      for (const [matName, mat] of Object.entries(epjson[matType] ?? {})) {
        matLayers.push({
          name: matName,
          thickness: mat.thickness ?? 0.1,
          conductivity: mat.conductivity ?? 0.5,
          density: mat.density ?? 1000,
          specific_heat: mat.specific_heat ?? 840,
        })
      }
    }
    if (matLayers.length > 0) setLayers(matLayers)
    else setLayers(buildLayersFromUTarget(cfg.u_value_W_per_m2K ?? 0.18, cfg.type ?? 'wall'))
  }, [])

  // Regenerate layers when quick-mode params change
  function applyQuickMethod() {
    if (elementType === 'glazing') {
      setMode('layers')
      return
    }
    setLayers(buildLayersFromUTarget(uTarget, elementType))
    setMode('layers')
  }

  const uValue = elementType === 'glazing' ? uTarget : calcUValueFromLayers(layers)

  function updateLayer(idx, field, value) {
    setLayers(prev => prev.map((l, i) => i === idx ? { ...l, [field]: value } : l))
  }

  function removeLayer(idx) {
    setLayers(prev => prev.filter((_, i) => i !== idx))
  }

  function addLayer() {
    setLayers(prev => [...prev, { name: 'New Layer', thickness: 0.05, conductivity: 0.5, density: 1000, specific_heat: 840 }])
  }

  async function handleSave() {
    if (!name.trim()) { setError('Name is required'); return }
    if (elementType !== 'glazing' && layers.length === 0) { setError('Add at least one layer'); return }
    setError(null)
    setSaving(true)

    const epjson = buildEpJson(name.trim(), elementType, layers, uValue ?? uTarget, gValue)
    const config = {
      name:              name.trim(),
      display_name:      displayName.trim() || name.trim(),
      type:              elementType,
      u_value_W_per_m2K: uValue ?? uTarget,
      g_value:           elementType === 'glazing' ? gValue : undefined,
      thermal_mass:      elementType === 'ground_floor' ? 'heavy' : elementType === 'wall' ? 'medium' : 'light',
      description:       description.trim(),
      epjson,
    }

    try {
      const res = await fetch('/api/library', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          library_type: 'construction',
          name:         name.trim(),
          display_name: displayName.trim() || name.trim(),
          description:  description.trim(),
          config_json:  config,
        }),
      })
      if (!res.ok) {
        const detail = await res.json().catch(() => ({}))
        throw new Error(detail.detail ?? `HTTP ${res.status}`)
      }
      const created = await res.json()
      onSave(created)
    } catch (err) {
      setError(err.message)
    } finally {
      setSaving(false)
    }
  }

  const TYPE_OPTIONS = [
    { value: 'wall',         label: 'External Wall' },
    { value: 'roof',         label: 'Roof' },
    { value: 'ground_floor', label: 'Ground Floor' },
    { value: 'glazing',      label: 'Glazing' },
  ]

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center bg-black/40 overflow-y-auto py-8">
      <div className="bg-white rounded-xl shadow-xl border border-light-grey w-full max-w-lg mx-4">
        {/* Header */}
        <div className="px-5 py-4 border-b border-light-grey flex items-center justify-between">
          <div>
            <h2 className="text-section font-semibold text-navy">
              {initialItem ? 'Duplicate Construction' : 'New Construction'}
            </h2>
            <p className="text-xxs text-mid-grey mt-0.5">
              {initialItem ? 'Editing a copy of ' + (initialItem.display_name || initialItem.name) : 'Define a custom construction for use in simulations'}
            </p>
          </div>
          <button onClick={onClose} className="text-mid-grey hover:text-navy">
            <X size={18} />
          </button>
        </div>

        <div className="p-5 space-y-4">
          {/* Name and type */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xxs uppercase tracking-wider text-mid-grey block mb-1">Name (internal)</label>
              <input
                type="text"
                value={name}
                onChange={e => setName(e.target.value.replace(/\s+/g, '_').toLowerCase())}
                placeholder="e.g. my_wall_2030"
                className="w-full px-2 py-1.5 text-caption text-navy border border-light-grey rounded focus:outline-none focus:border-teal"
              />
            </div>
            <div>
              <label className="text-xxs uppercase tracking-wider text-mid-grey block mb-1">Element type</label>
              <select
                value={elementType}
                onChange={e => { setElementType(e.target.value); setLayers([]) }}
                className="w-full px-2 py-1.5 text-caption text-navy border border-light-grey rounded bg-white focus:outline-none focus:border-teal appearance-none"
              >
                {TYPE_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
              </select>
            </div>
          </div>

          <div>
            <label className="text-xxs uppercase tracking-wider text-mid-grey block mb-1">Display name</label>
            <input
              type="text"
              value={displayName}
              onChange={e => setDisplayName(e.target.value)}
              placeholder="e.g. My Custom Wall (2030)"
              className="w-full px-2 py-1.5 text-caption text-navy border border-light-grey rounded focus:outline-none focus:border-teal"
            />
          </div>

          {/* Quick U-value method (non-glazing) */}
          {elementType !== 'glazing' && (
            <div className="bg-off-white rounded-lg border border-light-grey p-4">
              <p className="text-xxs uppercase tracking-wider text-mid-grey mb-2">Quick U-value method</p>
              <div className="flex items-end gap-3">
                <div className="flex-1">
                  <label className="text-xxs text-mid-grey block mb-1">Target U-value (W/m²K)</label>
                  <input
                    type="number"
                    min={0.05} max={3.0} step={0.01}
                    value={uTarget}
                    onChange={e => setUTarget(parseFloat(e.target.value) || 0.18)}
                    className="w-full px-2 py-1.5 text-caption text-navy border border-light-grey rounded focus:outline-none focus:border-teal"
                  />
                </div>
                <button
                  onClick={applyQuickMethod}
                  className="flex items-center gap-1.5 px-3 py-1.5 text-xxs text-white bg-navy rounded hover:bg-navy/80 transition-colors"
                >
                  <RefreshCw size={11} />
                  Generate
                </button>
              </div>
              {elementType !== 'glazing' && uTarget > 0 && (
                <p className="text-xxs text-mid-grey mt-1.5">
                  Insulation: {Math.round(insThicknessForUTarget(uTarget, elementType) * 1000)}mm {INSULATION_DEFAULTS[elementType]?.name} (λ = {INSULATION_DEFAULTS[elementType]?.conductivity} W/mK)
                </p>
              )}
            </div>
          )}

          {/* Glazing properties */}
          {elementType === 'glazing' && (
            <div className="bg-off-white rounded-lg border border-light-grey p-4 grid grid-cols-2 gap-3">
              <div>
                <label className="text-xxs text-mid-grey block mb-1">U-value (W/m²K)</label>
                <input
                  type="number" min={0.5} max={6.0} step={0.1}
                  value={uTarget}
                  onChange={e => setUTarget(parseFloat(e.target.value) || 1.4)}
                  className="w-full px-2 py-1.5 text-caption text-navy border border-light-grey rounded focus:outline-none focus:border-teal"
                />
              </div>
              <div>
                <label className="text-xxs text-mid-grey block mb-1">g-value (SHGC)</label>
                <input
                  type="number" min={0.05} max={0.90} step={0.01}
                  value={gValue}
                  onChange={e => setGValue(parseFloat(e.target.value) || 0.40)}
                  className="w-full px-2 py-1.5 text-caption text-navy border border-light-grey rounded focus:outline-none focus:border-teal"
                />
              </div>
            </div>
          )}

          {/* Layer editor */}
          {elementType !== 'glazing' && layers.length > 0 && (
            <div>
              <div className="flex items-center justify-between mb-2">
                <p className="text-xxs uppercase tracking-wider text-mid-grey">Layer buildup (outer → inner)</p>
                {uValue != null && (
                  <span className={`text-xxs font-semibold px-2 py-0.5 rounded ${
                    uValue <= 0.18 ? 'text-green-700 bg-green-50' :
                    uValue <= 0.28 ? 'text-amber-700 bg-amber-50' :
                                     'text-red-700 bg-red-50'
                  }`}>
                    U = {uValue.toFixed(3)} W/m²K
                  </span>
                )}
              </div>
              <div className="bg-white border border-light-grey rounded-lg p-3">
                {layers.map((layer, idx) => (
                  <LayerRow
                    key={idx}
                    layer={layer}
                    idx={idx}
                    onChange={updateLayer}
                    onRemove={removeLayer}
                    isFirst={idx === 0}
                  />
                ))}
                <button
                  onClick={addLayer}
                  className="mt-2 flex items-center gap-1.5 text-xxs text-teal hover:text-teal/70"
                >
                  <Plus size={11} />
                  Add layer
                </button>
              </div>
              <p className="text-xxs text-mid-grey mt-1">
                Surface resistances included (R_se=0.04, R_si=0.13 m²K/W). Omit cavity conductivity to use R=0.18 m²K/W air gap.
              </p>
            </div>
          )}

          {/* Error */}
          {error && (
            <p className="text-xxs text-red-600 bg-red-50 border border-red-200 rounded px-3 py-2">{error}</p>
          )}
        </div>

        {/* Footer */}
        <div className="px-5 py-4 border-t border-light-grey flex justify-end gap-2">
          <button
            onClick={onClose}
            className="px-4 py-2 text-caption text-mid-grey hover:text-navy"
          >
            Cancel
          </button>
          <button
            onClick={handleSave}
            disabled={saving}
            className="px-4 py-2 text-caption bg-navy text-white rounded-lg hover:bg-navy/80 disabled:opacity-50"
          >
            {saving ? 'Saving…' : 'Save to Library'}
          </button>
        </div>
      </div>
    </div>
  )
}
