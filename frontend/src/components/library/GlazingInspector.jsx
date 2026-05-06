/**
 * GlazingInspector.jsx — glazing system specification.
 *
 * Same dialog pattern as ConstructionInspector, but glazing has fewer
 * inputs because EnergyPlus's WindowMaterial:SimpleGlazingSystem takes
 * a flat (U, SHGC, visible_transmittance) tuple — no layer build-up.
 *
 * Fields:
 *   U-value (W/m²K)             — overall window U incl. frame
 *   g-value / SHGC (0–1)        — solar heat gain coefficient
 *   Visible transmittance (0–1) — daylight let through (for daylighting calcs)
 *   Frame fraction (0–1)        — frame area as fraction of total opening
 *
 * Edit / save semantics mirror ConstructionInspector: built-ins prompt
 * 'Save as copy', custom items update in place.
 */

import { useEffect, useState } from 'react'
import { X as XIcon, Save, Copy, Lock, AlertCircle } from 'lucide-react'

const FRAME_PRESETS = [
  { value: 0.10, label: 'Slimline aluminium / steel — 10%' },
  { value: 0.20, label: 'Standard aluminium / uPVC — 20%' },
  { value: 0.30, label: 'Heavy timber frame — 30%' },
]

export default function GlazingInspector({
  open,
  onClose,
  glazingName,
  initialMode = 'view',
  onSaved,
}) {
  const [mode, setMode]   = useState(initialMode)
  const [data, setData]   = useState(null)
  const [error, setError] = useState(null)
  const [loading, setLoading] = useState(false)
  const [u, setU] = useState(1.4)
  const [g, setG] = useState(0.42)
  const [vt, setVt] = useState(0.7)
  const [frameFrac, setFrameFrac] = useState(0.20)
  const [displayName, setDisplayName] = useState('')
  const [isDefault, setIsDefault] = useState(false)
  const [itemId, setItemId] = useState(null)
  const [saveBusy, setSaveBusy] = useState(false)
  const [saveMsg, setSaveMsg]   = useState(null)

  useEffect(() => { setMode(initialMode) }, [initialMode, glazingName])

  useEffect(() => {
    if (!open) return
    const onKey = (e) => { if (e.key === 'Escape') onClose?.() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, onClose])

  useEffect(() => {
    if (!open || !glazingName) return
    setLoading(true); setError(null); setSaveMsg(null)
    Promise.all([
      fetch(`/api/library/constructions/${encodeURIComponent(glazingName)}`).then(r => r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))),
      fetch(`/api/library?type=construction`).then(r => r.ok ? r.json() : []),
    ])
      .then(([detail, list]) => {
        setData(detail)
        // Pull from the embedded WindowMaterial:SimpleGlazingSystem object
        const wm = detail.definition?.['WindowMaterial:SimpleGlazingSystem'] || {}
        const wmKey = Object.keys(wm)[0]
        const wmObj = wmKey ? wm[wmKey] : {}
        setU(Number(wmObj.u_factor ?? detail.summary?.u_value_W_per_m2K ?? 1.4))
        setG(Number(wmObj.solar_heat_gain_coefficient ?? detail.summary?.g_value ?? 0.42))
        setVt(Number(wmObj.visible_transmittance ?? 0.7))
        setFrameFrac(Number(detail.summary?.frame_fraction ?? 0.20))
        const item = (list || []).find(it => it.name === glazingName)
        setIsDefault(!!item?.is_default)
        setItemId(item?.id ?? null)
        setDisplayName(item?.display_name || detail?.summary?.description || glazingName)
      })
      .catch(e => setError(e.message))
      .finally(() => setLoading(false))
  }, [open, glazingName])

  async function save({ asCopy = false } = {}) {
    setSaveBusy(true); setSaveMsg(null)
    try {
      // Build the WindowMaterial:SimpleGlazingSystem object EnergyPlus expects
      const wmKey = `${glazingName}_glazing`
      const newDefinition = {
        'WindowMaterial:SimpleGlazingSystem': {
          [wmKey]: {
            u_factor: round3(u),
            solar_heat_gain_coefficient: round3(g),
            visible_transmittance: round3(vt),
          },
        },
        'Construction': {
          [glazingName]: { outside_layer: wmKey },
        },
      }
      const payload = {
        u_value_W_per_m2K: round3(u),
        g_value: round3(g),
        visible_transmittance: round3(vt),
        frame_fraction: round3(frameFrac),
        type: 'glazing',
        description: data?.summary?.description ?? displayName,
        epjson: newDefinition,
      }

      let res
      if (asCopy || isDefault) {
        const copyName = `${glazingName}_copy_${Date.now().toString(36).slice(-4)}`
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
        setSaveMsg('Saved as new custom glazing.')
        onSaved?.(created.name)
      } else {
        if (!itemId) throw new Error('No item id to update')
        res = await fetch(`/api/library/${itemId}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ display_name: displayName, config_json: payload }),
        })
        if (!res.ok) {
          const err = await res.json().catch(() => ({}))
          throw new Error(err.detail || `HTTP ${res.status}`)
        }
        setSaveMsg('Saved.')
        onSaved?.(glazingName)
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
      <div
        className="absolute inset-0 bg-black/20 pointer-events-auto transition-opacity duration-200"
        onClick={onClose}
        style={{ opacity: open ? 1 : 0 }}
      />
      <aside
        className="absolute top-0 right-0 h-full w-[480px] bg-white shadow-xl pointer-events-auto overflow-y-auto"
        style={{
          transform: open ? 'translateX(0)' : 'translateX(100%)',
          transition: 'transform 200ms ease-out',
        }}
      >
        <div className="sticky top-0 z-10 bg-white flex items-center justify-between px-5 py-4 border-b border-light-grey">
          <div className="min-w-0">
            <p className="text-xxs uppercase tracking-wider text-mid-grey">Glazing system</p>
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
            <p className="text-xxs text-mid-grey mt-0.5 font-mono">{glazingName}</p>
          </div>
          <div className="flex items-center gap-2 flex-shrink-0">
            {isDefault && (
              <span className="inline-flex items-center gap-1 text-xxs text-mid-grey px-2 py-0.5 bg-off-white rounded">
                <Lock size={10} /> built-in
              </span>
            )}
            {mode === 'view' ? (
              <button onClick={() => setMode('edit')} className="text-xxs px-2.5 py-1 rounded text-white" style={{ backgroundColor: '#A1887F' }}>
                Edit
              </button>
            ) : (
              <button onClick={() => setMode('view')} className="text-xxs px-2.5 py-1 rounded border border-light-grey text-mid-grey hover:text-navy">
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

        {!loading && !error && (
          <>
            {/* Properties */}
            <div className="px-5 py-4 space-y-3">
              <NumberField
                label="U-value (W/m²K)"
                value={u}
                onChange={setU}
                min={0.4} max={6.0} step={0.05}
                editable={mode === 'edit'}
                help="Overall window U-value incl. glass + frame + spacer (BR443 / SAP convention)."
              />
              <NumberField
                label="g-value / SHGC (0–1)"
                value={g}
                onChange={setG}
                min={0.0} max={1.0} step={0.01}
                editable={mode === 'edit'}
                help="Solar heat gain coefficient — fraction of incident solar that ends up as zone heat (transmitted + absorbed-and-re-emitted)."
              />
              <NumberField
                label="Visible transmittance (0–1)"
                value={vt}
                onChange={setVt}
                min={0.0} max={1.0} step={0.01}
                editable={mode === 'edit'}
                help="Daylight transmittance — used by EnergyPlus daylighting calculations only. Doesn't affect heating/cooling unless daylight controls are active."
              />

              {/* Frame fraction */}
              <div>
                <label className="block text-xxs uppercase tracking-wider text-mid-grey mb-1">
                  Frame fraction
                </label>
                <p className="text-xxs text-mid-grey mb-2">
                  Frame area as fraction of total opening. Higher frame
                  fraction means less glass — slightly less solar gain but
                  similar U if the U-value above already includes the frame.
                </p>
                <div className="space-y-1">
                  {FRAME_PRESETS.map(p => (
                    <label key={p.value}
                      className={`flex items-center gap-2 px-2 py-1.5 rounded text-xxs cursor-pointer ${
                        Math.abs(frameFrac - p.value) < 0.005
                          ? 'bg-navy/8 border border-navy/30'
                          : 'border border-transparent hover:bg-off-white'
                      }`}>
                      <input type="radio"
                        checked={Math.abs(frameFrac - p.value) < 0.005}
                        onChange={() => setFrameFrac(p.value)}
                        disabled={mode === 'view'}
                        className="accent-navy" />
                      <span className="font-medium text-navy w-12 tabular-nums">{Math.round(p.value * 100)}%</span>
                      <span className="text-dark-grey">{p.label}</span>
                    </label>
                  ))}
                  <label className={`flex items-center gap-2 px-2 py-1.5 rounded text-xxs ${
                    !FRAME_PRESETS.some(p => Math.abs(p.value - frameFrac) < 0.005) ? 'bg-navy/8 border border-navy/30' : 'border border-transparent'
                  }`}>
                    <input type="radio"
                      checked={!FRAME_PRESETS.some(p => Math.abs(p.value - frameFrac) < 0.005)}
                      onChange={() => setFrameFrac(0.15)}
                      disabled={mode === 'view'}
                      className="accent-navy" />
                    <span className="text-dark-grey mr-2">Custom</span>
                    <input type="number" min={0} max={0.5} step={0.01}
                      value={frameFrac}
                      onChange={e => setFrameFrac(Number(e.target.value))}
                      disabled={mode === 'view'}
                      className="w-16 px-2 py-0.5 text-xxs border border-light-grey rounded text-right disabled:opacity-50" />
                  </label>
                </div>
              </div>
            </div>

            {/* Note about EnergyPlus */}
            <div className="px-5 py-3 border-t border-light-grey bg-off-white text-xxs text-dark-grey leading-relaxed">
              EnergyPlus uses the <span className="font-mono">SimpleGlazingSystem</span> object: the U,
              SHGC, and visible-transmittance values above feed it directly. Frame
              fraction is informational here; it isn't applied to the simulation as
              SimpleGlazingSystem expects U to already account for frame. The live
              engine reads U + g and applies them to the glazing area set by WWR.
            </div>

            {mode === 'edit' && (
              <div className="sticky bottom-0 bg-white border-t border-light-grey px-5 py-3">
                {isDefault ? (
                  <div className="flex items-center justify-between gap-3">
                    <p className="text-xxs text-mid-grey flex items-center gap-1.5">
                      <AlertCircle size={11} className="text-amber-500" />
                      Built-in items are read-only. Save edits as a custom copy.
                    </p>
                    <button onClick={() => save({ asCopy: true })} disabled={saveBusy}
                      className="flex items-center gap-1.5 text-xxs px-3 py-1.5 rounded bg-navy text-white disabled:opacity-60">
                      <Copy size={12} /> {saveBusy ? 'Saving…' : 'Save as copy'}
                    </button>
                  </div>
                ) : (
                  <div className="flex items-center justify-between gap-3">
                    <p className="text-xxs text-mid-grey">Saving updates this library item.</p>
                    <button onClick={() => save()} disabled={saveBusy}
                      className="flex items-center gap-1.5 text-xxs px-3 py-1.5 rounded bg-navy text-white disabled:opacity-60">
                      <Save size={12} /> {saveBusy ? 'Saving…' : 'Save'}
                    </button>
                  </div>
                )}
                {saveMsg && <p className="text-xxs mt-2 text-dark-grey">{saveMsg}</p>}
              </div>
            )}
          </>
        )}
      </aside>
    </div>
  )
}

function NumberField({ label, value, onChange, min, max, step, editable, help }) {
  return (
    <div>
      <label className="block text-xxs uppercase tracking-wider text-mid-grey mb-1">{label}</label>
      <div className="flex items-center gap-3">
        <input
          type="range"
          min={min} max={max} step={step}
          value={value}
          onChange={e => onChange(Number(e.target.value))}
          disabled={!editable}
          className="flex-1 h-[3px] accent-navy disabled:opacity-50"
        />
        <input
          type="number"
          min={min} max={max} step={step}
          value={value}
          onChange={e => onChange(Number(e.target.value))}
          disabled={!editable}
          className="w-20 px-2 py-1 text-xxs text-navy text-right border border-light-grey rounded focus:outline-none focus:border-teal disabled:opacity-60"
        />
      </div>
      {help && <p className="text-xxs text-mid-grey mt-1 leading-relaxed">{help}</p>}
    </div>
  )
}

function round3(n) { return Math.round((n ?? 0) * 1000) / 1000 }
