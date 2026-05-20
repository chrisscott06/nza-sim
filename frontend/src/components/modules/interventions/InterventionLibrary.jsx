/**
 * InterventionLibrary.jsx — Brief 41 Part 5
 *
 * Per-project intervention library save / load. Mirrors the Brief 37
 * (schedules) + Brief 40 (systems) library patterns. Stored under
 * `params.library_interventions` and persisted via ProjectContext
 * autosave.
 *
 * Surface:
 *   - "Save to library" button per intervention row in the stack
 *     (renders inline via the parent's onSaveToLibrary handler — this
 *     module exposes the save-dialog modal + load-picker modal as
 *     separate components and a top-of-module "Load from library"
 *     dropdown).
 *
 * Component exports:
 *   - SaveToLibraryModal     — prompts for a library label + notes
 *   - LoadFromLibraryModal   — picker for existing library entries
 *   - LibraryStripButton     — top-of-module button that opens the picker
 *
 * Library entry shape:
 *   {
 *     id:             'lib_intervention_<uuid>',
 *     library_label:  string,        // user-facing library name
 *     saved_at:       ISO string,
 *     schema_version: number,        // baseline at save time
 *     // The full intervention shape, snapshotted at save time:
 *     label, theme, notes, patches, capex_gbp
 *   }
 */

import { useState } from 'react'
import { BookOpen, Save, X, Trash2 } from 'lucide-react'

const INTERVENTIONS_ACCENT = '#E84393'

function newLibId() {
  const raw = (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function')
    ? crypto.randomUUID()
    : `${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`
  return `lib_intervention_${raw}`
}

function fmtTimestamp(iso) {
  if (!iso) return '—'
  try {
    const d = new Date(iso)
    if (isNaN(d.getTime())) return iso
    return d.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' })
  } catch { return iso }
}

// ── Save-to-library modal ─────────────────────────────────────────────

export function SaveToLibraryModal({ open, intervention, onClose, onSave }) {
  const [libraryLabel, setLibraryLabel] = useState('')

  if (!open || !intervention) return null
  const initialLabel = intervention.label || ''
  const labelToUse = libraryLabel.trim() || initialLabel

  const handleSave = () => {
    if (!labelToUse) return
    onSave?.({
      id: newLibId(),
      library_label: labelToUse,
      saved_at: new Date().toISOString(),
      schema_version: intervention.schema_version ?? 1,
      label: intervention.label,
      theme: intervention.theme ?? null,
      notes: intervention.notes ?? '',
      patches: Array.isArray(intervention.patches) ? intervention.patches.map(p => ({ ...p })) : [],
      capex_gbp: intervention.capex_gbp ?? null,
    })
    setLibraryLabel('')
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-navy/40">
      <div className="bg-white rounded-2xl shadow-2xl w-[480px] max-w-[90vw] p-5 space-y-4">
        <div className="flex items-start justify-between">
          <div>
            <p className="text-xxs uppercase tracking-wider text-mid-grey font-medium">Save to library</p>
            <h3 className="text-caption font-semibold text-navy">
              {intervention.label || '(unnamed intervention)'}
            </h3>
          </div>
          <button onClick={onClose} className="p-1 rounded hover:bg-light-grey/40 text-mid-grey">
            <X size={14} />
          </button>
        </div>

        <div>
          <label className="block text-xxs font-medium text-mid-grey uppercase tracking-wider mb-1">Library label</label>
          <input
            type="text"
            value={libraryLabel}
            onChange={(e) => setLibraryLabel(e.target.value)}
            placeholder={initialLabel || 'e.g. EnerPHit fabric package'}
            className="w-full px-3 py-2 rounded-lg border border-light-grey text-caption text-navy focus:outline-none focus:border-navy"
          />
          <p className="text-xxs text-mid-grey mt-1">
            Leave blank to use the intervention's name. Library entries are
            stored on this project's library and can be re-loaded into the
            stack later.
          </p>
        </div>

        <div className="rounded-lg border border-light-grey bg-off-white/40 px-3 py-2 space-y-0.5">
          <p className="text-xxs text-mid-grey">Patches snapshotted at save:{' '}
            <span className="font-semibold text-navy">{(intervention.patches ?? []).length}</span>
          </p>
          <p className="text-xxs text-mid-grey">Theme:{' '}
            <span className="text-navy">{intervention.theme || '(none)'}</span>
          </p>
          <p className="text-xxs text-mid-grey">Schema version:{' '}
            <span className="text-navy">{intervention.schema_version ?? 1}</span>
          </p>
        </div>

        <div className="flex items-center justify-end gap-2 pt-2 border-t border-light-grey">
          <button
            onClick={onClose}
            className="px-3 py-1.5 rounded-lg border border-light-grey text-xxs font-medium text-mid-grey hover:bg-off-white"
          >
            Cancel
          </button>
          <button
            onClick={handleSave}
            disabled={!labelToUse}
            className="px-4 py-1.5 rounded-lg text-white text-xxs font-medium hover:opacity-90 disabled:opacity-40 disabled:cursor-not-allowed"
            style={{ backgroundColor: INTERVENTIONS_ACCENT }}
          >
            <span className="inline-flex items-center gap-1.5"><Save size={11} /> Save to library</span>
          </button>
        </div>
      </div>
    </div>
  )
}

// ── Load-from-library modal ──────────────────────────────────────────

export function LoadFromLibraryModal({ open, libraryEntries = [], onClose, onLoad, onDelete }) {
  if (!open) return null
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-navy/40">
      <div className="bg-white rounded-2xl shadow-2xl w-[560px] max-w-[90vw] p-5 space-y-4 max-h-[80vh] flex flex-col">
        <div className="flex items-start justify-between flex-shrink-0">
          <div>
            <p className="text-xxs uppercase tracking-wider text-mid-grey font-medium">Load from library</p>
            <h3 className="text-caption font-semibold text-navy">Pick an intervention to add to the stack</h3>
          </div>
          <button onClick={onClose} className="p-1 rounded hover:bg-light-grey/40 text-mid-grey">
            <X size={14} />
          </button>
        </div>

        <div className="flex-1 overflow-auto space-y-1.5">
          {libraryEntries.length === 0 ? (
            <div className="text-xxs text-mid-grey italic py-6 text-center">
              No saved interventions yet. Save one from the stack first.
            </div>
          ) : (
            libraryEntries.map(entry => (
              <div
                key={entry.id}
                className="flex items-center gap-3 px-3 py-2 rounded-lg border border-light-grey hover:border-navy hover:bg-off-white/40 transition-colors"
              >
                <button
                  onClick={() => onLoad?.(entry)}
                  className="flex-1 min-w-0 text-left"
                  title="Click to add to stack"
                >
                  <p className="text-caption font-medium text-navy truncate">{entry.library_label || entry.label}</p>
                  <div className="flex items-center gap-2 mt-0.5">
                    {entry.theme && <span className="px-1.5 py-0.5 rounded-full bg-light-grey/60 text-xxs text-mid-grey">{entry.theme}</span>}
                    <span className="text-xxs text-mid-grey">{(entry.patches ?? []).length} patches</span>
                    <span className="text-xxs text-mid-grey">· saved {fmtTimestamp(entry.saved_at)}</span>
                    <span className="text-xxs text-mid-grey">· schema v{entry.schema_version ?? '?'}</span>
                  </div>
                </button>
                <button
                  onClick={() => onDelete?.(entry.id)}
                  className="flex-shrink-0 p-1 rounded text-mid-grey/60 hover:text-red-600 hover:bg-red-50 transition-colors"
                  title="Delete from library"
                >
                  <Trash2 size={12} />
                </button>
              </div>
            ))
          )}
        </div>

        <div className="flex justify-end pt-2 border-t border-light-grey flex-shrink-0">
          <button
            onClick={onClose}
            className="px-3 py-1.5 rounded-lg border border-light-grey text-xxs font-medium text-mid-grey hover:bg-off-white"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  )
}

// ── Top-of-module button (opens the picker) ──────────────────────────

export function LibraryStripButton({ libraryCount, onClick }) {
  return (
    <button
      onClick={onClick}
      className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-light-grey text-xxs font-medium text-mid-grey hover:border-navy hover:text-navy hover:bg-off-white/40 transition-colors"
      title="Load from library"
    >
      <BookOpen size={12} />
      Library ({libraryCount})
    </button>
  )
}
