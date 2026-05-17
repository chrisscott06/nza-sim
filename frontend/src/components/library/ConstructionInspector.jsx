/**
 * ConstructionInspector.jsx — opaque construction layer build-up + U-value calc.
 *
 * Reusable from Building (click U-value badge in the Fabric section) and
 * Library (centre detail panel). Slides in from the right as a side panel.
 *
 * Reads:
 *   GET /api/library/constructions/{name}
 *
 * Renders the layer stack (outside → inside) with each layer's thickness,
 * conductivity λ, density, specific heat, and per-layer R-value. Sums to
 * the centre-of-element R, adds standard surface resistances Rsi+Rse, then
 * 1/R_total → U-value (W/m²K).
 *
 * Includes a thermal-bridging Y-factor input (default 1.15 = BR443
 * new-build) which uplifts the U-value to an "as-built effective" U used
 * in the simulation.
 *
 * Edit mode (mode='edit') makes layer thickness + λ editable. Saving:
 *  - Built-in (is_default=1) records: 403 from backend → prompts
 *    "Save as a custom copy" which POSTs a new library item with
 *    is_default=0.
 *  - Custom records: PUT updates in place.
 */

import { useEffect, useMemo, useState } from 'react'
import { deriveConstructionMass } from '../../utils/thermalMass.js'
import {
  X as XIcon, Save, Copy, Lock, AlertCircle, ChevronDown, Plus, Trash2,
} from 'lucide-react'

// Standard surface resistances (BS EN ISO 6946) for vertical wall, in m²K/W.
// We default to 0.13 (Rsi internal) + 0.04 (Rse external) = 0.17 total.
// Roof / floor would use slightly different values — for v1 we use the
// wall figures across all element types since the difference is small.
const RSI = 0.13
const RSE = 0.04

const Y_FACTOR_PRESETS = [
  { value: 1.00, label: 'None — Passivhaus / certified detailing'        },
  { value: 1.05, label: 'Light — good detailing, robust junctions'       },
  { value: 1.15, label: 'BR443 default — new-build typical'              },
  { value: 1.25, label: 'Existing building — uncertain detailing'        },
]

// ── Helpers ──────────────────────────────────────────────────────────────────

function rValueForLayer(layer) {
  // Materials with mass: R = thickness / conductivity
  if (layer.thickness != null && layer.conductivity != null && layer.conductivity > 0) {
    return layer.thickness / layer.conductivity
  }
  // Resistance-only (Material:NoMass) layers
  if (layer.thermal_resistance != null) return Number(layer.thermal_resistance)
  return 0
}

function computeUValue(layers, yFactor = 1.0) {
  const r_layers = layers.reduce((s, l) => s + rValueForLayer(l), 0)
  const r_total = r_layers + RSI + RSE
  if (r_total <= 0) return { u: 0, u_eff: 0, r_layers, r_total }
  const u = 1 / r_total
  const u_eff = u * (Number(yFactor) || 1.0)
  return { u, u_eff, r_layers, r_total }
}

/**
 * Pull layer objects out of a `definition` (the legacy epJSON-like dict
 * returned by /constructions/{name}). The construction itself is keyed
 * inside `definition.Construction` with one entry; its outside_layer /
 * layer_2 / ... reference Material or Material:NoMass entries.
 *
 * Returns: [{ name, thickness, conductivity, density, specific_heat,
 *             thermal_resistance, roughness, source: 'mass' | 'nomass' }]
 */
function extractLayers(definition) {
  if (!definition) return []
  const constr = definition['Construction'] || {}
  const constrName = Object.keys(constr)[0]
  if (!constrName) return []
  const cdef = constr[constrName]

  const ordered = []
  const fields = ['outside_layer', 'layer_2', 'layer_3', 'layer_4', 'layer_5',
                  'layer_6', 'layer_7', 'layer_8', 'layer_9', 'layer_10']
  for (const f of fields) {
    if (cdef[f]) ordered.push(cdef[f])
  }

  const mat   = definition['Material']           || {}
  const noma  = definition['Material:NoMass']    || {}
  return ordered.map(name => {
    if (mat[name]) {
      const m = mat[name]
      return {
        name,
        roughness:     m.roughness,
        thickness:     m.thickness,
        conductivity:  m.conductivity,
        density:       m.density,
        specific_heat: m.specific_heat,
        source: 'mass',
      }
    }
    if (noma[name]) {
      return {
        name,
        roughness:          noma[name].roughness,
        thermal_resistance: noma[name].thermal_resistance,
        source: 'nomass',
      }
    }
    return { name, source: 'unknown' }
  })
}

// ── Main ─────────────────────────────────────────────────────────────────────

export default function ConstructionInspector({
  open,
  onClose,
  constructionName,    // string — required
  initialMode = 'view', // 'view' | 'edit'
  onSaved,             // callback(name) when a save lands so consumers can refresh
}) {
  const [mode, setMode]       = useState(initialMode)
  const [data, setData]       = useState(null)
  const [error, setError]     = useState(null)
  const [loading, setLoading] = useState(false)
  const [layers, setLayers]   = useState([])
  const [yFactor, setYFactor] = useState(1.15)
  const [yFactorMode, setYFactorMode] = useState('preset') // 'preset' | 'custom'
  const [saveBusy, setSaveBusy] = useState(false)
  const [saveMsg, setSaveMsg]   = useState(null)
  const [isDefault, setIsDefault] = useState(false)
  const [itemId, setItemId]       = useState(null)
  const [displayName, setDisplayName] = useState('')

  useEffect(() => {
    setMode(initialMode)
  }, [initialMode, constructionName])

  // Esc closes
  useEffect(() => {
    if (!open) return
    const onKey = (e) => { if (e.key === 'Escape') onClose?.() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, onClose])

  // Fetch construction detail
  useEffect(() => {
    if (!open || !constructionName) return
    setLoading(true); setError(null); setSaveMsg(null)
    Promise.all([
      fetch(`/api/library/constructions/${encodeURIComponent(constructionName)}`).then(r => r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))),
      fetch(`/api/library?type=construction`).then(r => r.ok ? r.json() : []),
    ])
      .then(([detail, list]) => {
        setData(detail)
        const extracted = extractLayers(detail.definition)
        setLayers(extracted)
        const item = (list || []).find(it => it.name === constructionName)
        setIsDefault(!!item?.is_default)
        setItemId(item?.id ?? null)
        setDisplayName(item?.display_name || detail?.summary?.description || constructionName)
        // If the saved config has a y_factor, use it; otherwise default 1.15
        const stored = detail?.summary?.y_factor ?? 1.15
        setYFactor(stored)
        const isPreset = Y_FACTOR_PRESETS.some(p => Math.abs(p.value - stored) < 0.001)
        setYFactorMode(isPreset ? 'preset' : 'custom')
      })
      .catch(e => setError(e.message))
      .finally(() => setLoading(false))
  }, [open, constructionName])

  const calc = useMemo(() => computeUValue(layers, yFactor), [layers, yFactor])

  // Brief 26.1 Part 5: derive thermal mass from the live layer build-up
  // so it tracks in-flight edits in this inspector, not just the stored
  // construction. Glazing returns 0 by convention.
  const massDerived = useMemo(() => {
    const ctype = data?.summary?.type ?? data?.type
    return deriveConstructionMass({
      name: constructionName,
      type: ctype,
      layers: layers.map(l => ({
        name: l.name,
        kind: l.kind ?? 'Material',
        thickness: l.thickness,
        conductivity: l.conductivity,
        density: l.density,
        specific_heat: l.specific_heat,
        thermal_resistance: l.thermal_resistance,
      })),
    })
  }, [layers, data?.summary?.type, data?.type, constructionName])

  // ── Layer editing helpers ───────────────────────────────────────────────────
  function updateLayer(idx, field, value) {
    setLayers(ls => ls.map((l, i) => i === idx ? { ...l, [field]: value } : l))
  }
  function deleteLayer(idx) {
    setLayers(ls => ls.filter((_, i) => i !== idx))
  }
  function addLayer() {
    setLayers(ls => [...ls, {
      name:         `New layer ${ls.length + 1}`,
      thickness:    0.05,
      conductivity: 0.04,
      density:      30,
      specific_heat: 1030,
      roughness:    'MediumRough',
      source: 'mass',
    }])
  }

  // ── Save ────────────────────────────────────────────────────────────────────
  async function save({ asCopy = false } = {}) {
    setSaveBusy(true); setSaveMsg(null)
    try {
      // Reconstruct the definition from current layer list
      const newDefinition = buildDefinition(constructionName, layers, calc)
      // Brief 28-IM-Polish IA 3.4: y_factor pinned to 1.0 — thermal bridging
      // is now a BUILDING-LEVEL concept (ISO 14683 H_TB in
      // building.thermal_bridges). The popout no longer offers a y-factor
      // input, so a saved construction always reports an unmodified U-value
      // and any TB uplift comes from the building's H_TB.
      const payload = {
        u_value_W_per_m2K: round3(calc.u),
        y_factor: 1.0,
        u_value_effective_W_per_m2K: round3(calc.u),
        thermal_mass: data?.summary?.thermal_mass ?? 'medium',
        type: data?.summary?.type ?? 'wall',
        description: data?.summary?.description ?? displayName,
        epjson: newDefinition,
      }

      let res
      if (asCopy || isDefault) {
        // Custom copy
        const copyName = `${constructionName}_copy_${Date.now().toString(36).slice(-4)}`
        res = await fetch('/api/library', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            library_type: 'construction',
            name: copyName,
            display_name: `${displayName} (custom)`,
            description: data?.summary?.description ?? '',
            config_json: payload,
          }),
        })
        if (!res.ok) throw new Error(`HTTP ${res.status}`)
        const created = await res.json()
        setSaveMsg('Saved as new custom construction.')
        onSaved?.(created.name)
      } else {
        // In-place update of existing custom item
        if (!itemId) throw new Error('No item id to update')
        res = await fetch(`/api/library/${itemId}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            display_name: displayName,
            config_json: payload,
          }),
        })
        if (!res.ok) {
          const err = await res.json().catch(() => ({}))
          throw new Error(err.detail || `HTTP ${res.status}`)
        }
        setSaveMsg('Saved.')
        onSaved?.(constructionName)
      }
    } catch (e) {
      setSaveMsg(`Save failed: ${e.message}`)
    } finally {
      setSaveBusy(false)
    }
  }

  if (!open) return null

  return (
    <div className="fixed inset-0 z-40 pointer-events-none">
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-black/20 pointer-events-auto transition-opacity duration-200"
        onClick={onClose}
        style={{ opacity: open ? 1 : 0 }}
      />

      {/* Side panel */}
      <aside
        className="absolute top-0 right-0 h-full w-[560px] bg-white shadow-xl pointer-events-auto overflow-y-auto"
        style={{
          transform: open ? 'translateX(0)' : 'translateX(100%)',
          transition: 'transform 200ms ease-out',
        }}
      >
        {/* Header */}
        <div className="sticky top-0 z-10 bg-white flex items-center justify-between px-5 py-4 border-b border-light-grey">
          <div className="min-w-0">
            <p className="text-xxs uppercase tracking-wider text-mid-grey">
              {(data?.summary?.type || 'Construction').replace(/_/g, ' ')}
            </p>
            {mode === 'edit' && !isDefault ? (
              <input
                type="text"
                value={displayName}
                onChange={e => setDisplayName(e.target.value)}
                className="text-caption font-semibold text-navy bg-transparent border-b border-light-grey focus:outline-none focus:border-teal w-full"
              />
            ) : (
              <h3 className="text-caption font-semibold text-navy">{displayName}</h3>
            )}
            <p className="text-xxs text-mid-grey mt-0.5 font-mono">{constructionName}</p>
          </div>
          <div className="flex items-center gap-2 flex-shrink-0">
            {isDefault && (
              <span className="inline-flex items-center gap-1 text-xxs text-mid-grey px-2 py-0.5 bg-off-white rounded" title="Built-in library items can't be edited in place — save a copy to modify.">
                <Lock size={10} /> built-in
              </span>
            )}
            {mode === 'view' ? (
              <button
                onClick={() => setMode('edit')}
                className="text-xxs px-2.5 py-1 rounded text-white"
                style={{ backgroundColor: '#A1887F' }}
              >
                Edit
              </button>
            ) : (
              <button
                onClick={() => setMode('view')}
                className="text-xxs px-2.5 py-1 rounded border border-light-grey text-mid-grey hover:text-navy"
              >
                View
              </button>
            )}
            <button onClick={onClose} className="text-mid-grey hover:text-navy p-1" title="Close (Esc)">
              <XIcon size={16} />
            </button>
          </div>
        </div>

        {loading && <p className="px-5 py-4 text-xxs text-mid-grey">Loading…</p>}
        {error   && <p className="px-5 py-4 text-xxs text-red-600">{error}</p>}

        {!loading && !error && data && (
          <>
            {/* U-value summary
                Brief 28-IM-Polish Bug 2.1 / IA 3.4: the Y-factor / "Effective
                U-value" tile was removed from this popout. Thermal bridging
                is a BUILDING-LEVEL concept owned by the Thermal Bridges
                section in the Building module's left column (ISO 14683
                junction-based H_TB). Construction editors only show layer
                stack + total R + 1-D U-value. */}
            <div className="px-5 py-4 border-b border-light-grey bg-off-white">
              <div className="grid grid-cols-3 gap-3">
                <Stat label="Layer R" value={`${calc.r_layers.toFixed(2)} m²K/W`} />
                <Stat label="Total R (incl. surface)" value={`${calc.r_total.toFixed(2)} m²K/W`} />
                <Stat label="U-value (1-D)" value={`${calc.u.toFixed(2)} W/m²K`} bold />
              </div>

              {/* Derived thermal mass — sum of (thickness × density × specific
                  heat) for layers on the indoor side of the principal
                  insulation. Drives the live engine's State 1 free-running
                  temperature model when thermal_mass_mode = 'auto'. */}
              {!massDerived.isGlazing && (
                <div className="mt-3 pt-3 border-t border-light-grey flex items-baseline justify-between">
                  <p className="text-xxs uppercase tracking-wider text-mid-grey">Effective indoor thermal mass</p>
                  <div className="text-right">
                    <p className="text-caption font-semibold text-navy tabular-nums">
                      {massDerived.mass_kJ_per_m2K} <span className="text-xxs font-normal text-mid-grey">kJ/(K·m²)</span>
                      <span className={`ml-2 text-xxs font-medium px-1.5 py-0.5 rounded ${
                        massDerived.category === 'heavy' ? 'bg-orange-50 text-orange-700' :
                        massDerived.category === 'medium' ? 'bg-amber-50 text-amber-700' :
                                                            'bg-sky-50 text-sky-700'
                      }`}>{massDerived.category}</span>
                    </p>
                    <p className="text-xxs text-mid-grey">
                      {massDerived.inside_layers.length} layer{massDerived.inside_layers.length === 1 ? '' : 's'} inside the insulation
                    </p>
                  </div>
                </div>
              )}
            </div>

            {/* Brief 28-IM-Polish Bug 2.1 / IA 3.4: the Thermal Bridging
                selector that previously rendered here was DEAD CODE on
                project use — it wrote y_factor to the library item, not
                to the project. Bridgewater (and every reseeded post-
                Brief-28k project) uses u_value_override + the building-
                level thermal_bridges block. The popout now only shows
                layer stack + total R + U-value. Building-level TB lives
                in BuildingDefinition.jsx's ThermalBridgesPanel. */}

            {/* Layer table */}
            <div className="px-5 py-4">
              <p className="text-xxs uppercase tracking-wider text-mid-grey mb-2">
                Layers — outside to inside
              </p>
              <table className="w-full text-xxs">
                <thead>
                  <tr className="text-mid-grey border-b border-light-grey">
                    <th className="text-left py-1.5 font-medium">Material</th>
                    <th className="text-right py-1.5 font-medium">d (mm)</th>
                    <th className="text-right py-1.5 font-medium">λ (W/mK)</th>
                    <th className="text-right py-1.5 font-medium">R (m²K/W)</th>
                    {mode === 'edit' && <th className="w-6"></th>}
                  </tr>
                </thead>
                <tbody>
                  {layers.map((l, idx) => (
                    <LayerRow
                      key={`${l.name}-${idx}`}
                      layer={l}
                      mode={mode}
                      onChange={(field, val) => updateLayer(idx, field, val)}
                      onDelete={() => deleteLayer(idx)}
                    />
                  ))}
                  {layers.length === 0 && (
                    <tr>
                      <td colSpan={mode === 'edit' ? 5 : 4} className="py-3 text-center text-mid-grey">
                        No layers — add one below.
                      </td>
                    </tr>
                  )}
                </tbody>
                <tfoot>
                  <tr className="text-mid-grey border-t border-light-grey">
                    <td className="py-1.5">+ Surface resistances Rsi {RSI} + Rse {RSE}</td>
                    <td colSpan={mode === 'edit' ? 4 : 3} className="text-right py-1.5">
                      Σ R = <span className="font-semibold text-navy tabular-nums">{calc.r_total.toFixed(2)}</span> m²K/W
                    </td>
                  </tr>
                </tfoot>
              </table>
              {mode === 'edit' && (
                <button
                  onClick={addLayer}
                  className="mt-2 inline-flex items-center gap-1 text-xxs text-teal hover:text-navy"
                >
                  <Plus size={12} /> Add layer
                </button>
              )}
            </div>

            {/* Save bar */}
            {mode === 'edit' && (
              <div className="sticky bottom-0 bg-white border-t border-light-grey px-5 py-3">
                {isDefault ? (
                  <div className="flex items-center justify-between gap-3">
                    <p className="text-xxs text-mid-grey flex items-center gap-1.5">
                      <AlertCircle size={11} className="text-amber-500" />
                      Built-in items are read-only. Save edits as a custom copy.
                    </p>
                    <button
                      onClick={() => save({ asCopy: true })}
                      disabled={saveBusy}
                      className="flex items-center gap-1.5 text-xxs px-3 py-1.5 rounded bg-navy text-white disabled:opacity-60"
                    >
                      <Copy size={12} />
                      {saveBusy ? 'Saving…' : 'Save as copy'}
                    </button>
                  </div>
                ) : (
                  <div className="flex items-center justify-between gap-3">
                    <p className="text-xxs text-mid-grey">
                      Saving updates this library item — every project using it will pick up the change.
                    </p>
                    <button
                      onClick={() => save()}
                      disabled={saveBusy}
                      className="flex items-center gap-1.5 text-xxs px-3 py-1.5 rounded bg-navy text-white disabled:opacity-60"
                    >
                      <Save size={12} />
                      {saveBusy ? 'Saving…' : 'Save'}
                    </button>
                  </div>
                )}
                {saveMsg && (
                  <p className="text-xxs mt-2 text-dark-grey">{saveMsg}</p>
                )}
              </div>
            )}
          </>
        )}
      </aside>
    </div>
  )
}

// ── Sub-components ───────────────────────────────────────────────────────────

function Stat({ label, value, bold }) {
  return (
    <div>
      <p className="text-xxs uppercase tracking-wider text-mid-grey">{label}</p>
      <p className={`tabular-nums mt-0.5 ${bold ? 'text-heading font-bold text-navy' : 'text-caption text-dark-grey'}`}>
        {value}
      </p>
    </div>
  )
}

function LayerRow({ layer, mode, onChange, onDelete }) {
  const r = rValueForLayer(layer)
  const editing = mode === 'edit'

  if (layer.source === 'nomass') {
    return (
      <tr className="border-b border-light-grey/60">
        <td className="py-1.5">
          {editing
            ? <input value={layer.name} onChange={e => onChange('name', e.target.value)}
                     className="w-full px-1 py-0.5 text-xxs border border-light-grey rounded focus:outline-none focus:border-teal" />
            : <span className="text-dark-grey">{layer.name}</span>
          }
          <span className="text-mid-grey ml-1 italic text-xxs">(no-mass)</span>
        </td>
        <td className="text-right py-1.5 text-mid-grey">—</td>
        <td className="text-right py-1.5 text-mid-grey">—</td>
        <td className="text-right py-1.5 tabular-nums">
          {editing
            ? <input type="number" step={0.01} value={layer.thermal_resistance ?? 0}
                     onChange={e => onChange('thermal_resistance', Number(e.target.value))}
                     className="w-16 px-1 py-0.5 text-xxs border border-light-grey rounded text-right" />
            : r.toFixed(3)
          }
        </td>
        {editing && (
          <td className="py-1.5 text-right">
            <button onClick={onDelete} className="text-mid-grey hover:text-red-500"><Trash2 size={11} /></button>
          </td>
        )}
      </tr>
    )
  }

  return (
    <tr className="border-b border-light-grey/60">
      <td className="py-1.5">
        {editing
          ? <input value={layer.name} onChange={e => onChange('name', e.target.value)}
                   className="w-full px-1 py-0.5 text-xxs border border-light-grey rounded focus:outline-none focus:border-teal" />
          : <span className="text-dark-grey">{layer.name}</span>
        }
      </td>
      <td className="text-right py-1.5 tabular-nums">
        {editing
          ? <input type="number" step={1} value={Math.round((layer.thickness ?? 0) * 1000)}
                   onChange={e => onChange('thickness', Number(e.target.value) / 1000)}
                   className="w-16 px-1 py-0.5 text-xxs border border-light-grey rounded text-right" />
          : Math.round((layer.thickness ?? 0) * 1000)
        }
      </td>
      <td className="text-right py-1.5 tabular-nums">
        {editing
          ? <input type="number" step={0.001} value={layer.conductivity ?? 0}
                   onChange={e => onChange('conductivity', Number(e.target.value))}
                   className="w-20 px-1 py-0.5 text-xxs border border-light-grey rounded text-right" />
          : (layer.conductivity ?? 0).toFixed(3)
        }
      </td>
      <td className="text-right py-1.5 tabular-nums">{r.toFixed(3)}</td>
      {editing && (
        <td className="py-1.5 text-right">
          <button onClick={onDelete} className="text-mid-grey hover:text-red-500"><Trash2 size={11} /></button>
        </td>
      )}
    </tr>
  )
}

// ── Helpers for save round-trip ──────────────────────────────────────────────

function round3(n) { return Math.round((n ?? 0) * 1000) / 1000 }

/**
 * Rebuild an epJSON-style { Material, Material:NoMass, Construction } dict
 * from the editable layer list so the library record stays the same shape
 * EnergyPlus expects.
 */
function buildDefinition(constructionName, layers, calc) {
  const Material = {}
  const MaterialNoMass = {}
  const orderedLayers = []
  layers.forEach((l, idx) => {
    const layerName = l.name && l.name.trim() ? l.name : `${constructionName}_layer_${idx + 1}`
    orderedLayers.push(layerName)
    if (l.source === 'nomass') {
      MaterialNoMass[layerName] = {
        roughness:           l.roughness || 'MediumRough',
        thermal_resistance:  round3(l.thermal_resistance ?? 0),
      }
    } else {
      Material[layerName] = {
        roughness:     l.roughness || 'MediumRough',
        thickness:     round3(l.thickness ?? 0),
        conductivity:  round3(l.conductivity ?? 0),
        density:       l.density ?? 30,
        specific_heat: l.specific_heat ?? 1030,
      }
    }
  })
  // Build Construction object with outside_layer + layer_2..N fields
  const constrObj = {}
  const fields = ['outside_layer', 'layer_2', 'layer_3', 'layer_4', 'layer_5',
                  'layer_6', 'layer_7', 'layer_8', 'layer_9', 'layer_10']
  orderedLayers.forEach((n, i) => { if (i < fields.length) constrObj[fields[i]] = n })
  return {
    'Material':         Material,
    'Material:NoMass':  MaterialNoMass,
    'Construction':     { [constructionName]: constrObj },
  }
}
