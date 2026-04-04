/**
 * ConsumptionUpload.jsx
 *
 * Drag-and-drop / file picker for importing CSV or Excel consumption data.
 * Uploads to POST /api/projects/{pid}/consumption/upload.
 * Shows parse summary and fuel type override before confirming.
 */

import { useState, useRef, useCallback } from 'react'
import { Upload, FileSpreadsheet, Zap, Flame, CheckCircle, AlertCircle, X } from 'lucide-react'

const ACCEPT_EXTS = '.csv,.xlsx,.xls'

export default function ConsumptionUpload({ projectId, onImported, onCancel }) {
  const [dragging,    setDragging]    = useState(false)
  const [uploading,   setUploading]   = useState(false)
  const [error,       setError]       = useState(null)
  const [summary,     setSummary]     = useState(null)   // parse result from server
  const [fuelOverride, setFuelOverride] = useState(null) // null = use server detection
  const fileInputRef = useRef(null)

  // ── Drag handlers ─────────────────────────────────────────────────────────
  const onDragOver  = useCallback(e => { e.preventDefault(); setDragging(true)  }, [])
  const onDragLeave = useCallback(e => { e.preventDefault(); setDragging(false) }, [])
  const onDrop      = useCallback(e => {
    e.preventDefault()
    setDragging(false)
    const file = e.dataTransfer.files?.[0]
    if (file) handleFile(file)
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  const onFileInput = e => {
    const file = e.target.files?.[0]
    if (file) handleFile(file)
    e.target.value = ''
  }

  // ── Upload ────────────────────────────────────────────────────────────────
  async function handleFile(file) {
    setError(null)
    setSummary(null)
    setFuelOverride(null)
    setUploading(true)
    try {
      const form = new FormData()
      form.append('file', file)
      const res = await fetch(`/api/projects/${projectId}/consumption/upload`, {
        method: 'POST',
        body: form,
      })
      if (!res.ok) {
        const detail = await res.json().catch(() => ({}))
        throw new Error(detail.detail ?? `Server error ${res.status}`)
      }
      const data = await res.json()
      setSummary(data)
    } catch (err) {
      setError(err.message)
    } finally {
      setUploading(false)
    }
  }

  // ── Confirm import ────────────────────────────────────────────────────────
  function handleConfirm() {
    if (!summary) return
    // fuel override is cosmetic here — the dataset is already stored.
    // If user changed fuel type we could PATCH, but for now just pass through.
    onImported({ ...summary, fuel_type: fuelOverride ?? summary.fuel_type })
  }

  // ── Effective fuel type ───────────────────────────────────────────────────
  const fuel = fuelOverride ?? summary?.fuel_type ?? 'electricity'

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <div className="flex flex-col gap-4">

      {/* Drop zone — hidden once we have a summary */}
      {!summary && (
        <div
          onDragOver={onDragOver}
          onDragLeave={onDragLeave}
          onDrop={onDrop}
          onClick={() => !uploading && fileInputRef.current?.click()}
          className={`
            relative flex flex-col items-center justify-center gap-3
            border-2 border-dashed rounded-lg p-8 cursor-pointer select-none
            transition-colors duration-150
            ${uploading ? 'pointer-events-none opacity-60' : ''}
          `}
          style={{
            borderColor: dragging ? '#2D6A7A' : '#E6E6E6',
            backgroundColor: dragging ? 'rgba(45,106,122,0.05)' : 'transparent',
          }}
        >
          {uploading ? (
            <>
              <div className="w-8 h-8 border-2 rounded-full animate-spin"
                   style={{ borderColor: 'rgba(45,106,122,0.25)', borderTopColor: '#2D6A7A' }} />
              <p className="text-xxs text-mid-grey">Uploading and parsing…</p>
            </>
          ) : (
            <>
              <div className="w-10 h-10 rounded-full bg-light-grey/60 flex items-center justify-center">
                <Upload size={18} className="text-mid-grey" />
              </div>
              <div className="text-center">
                <p className="text-xs font-medium text-navy">Drop a file here</p>
                <p className="text-xxs text-mid-grey mt-0.5">or click to browse — CSV, XLSX, XLS</p>
              </div>
              <p className="text-xxs text-mid-grey/70">
                Half-hourly (wide or long format) or monthly billing data
              </p>
            </>
          )}
          <input
            ref={fileInputRef}
            type="file"
            accept={ACCEPT_EXTS}
            onChange={onFileInput}
            className="hidden"
          />
        </div>
      )}

      {/* Error */}
      {error && (
        <div className="flex items-start gap-2 p-3 bg-red-50 border border-red-200 rounded-lg">
          <AlertCircle size={14} className="text-red-500 mt-0.5 flex-shrink-0" />
          <div className="flex-1 min-w-0">
            <p className="text-xxs font-medium text-red-700">Parse error</p>
            <p className="text-xxs text-red-600 mt-0.5 break-words">{error}</p>
          </div>
          <button onClick={() => setError(null)} className="text-red-400 hover:text-red-600 flex-shrink-0">
            <X size={12} />
          </button>
        </div>
      )}

      {/* Parse summary */}
      {summary && (
        <div className="flex flex-col gap-3">
          {/* Success header */}
          <div className="flex items-center gap-2 p-3 bg-green-50 border border-green-200 rounded-lg">
            <CheckCircle size={14} className="text-green-600 flex-shrink-0" />
            <div className="flex-1 min-w-0">
              <p className="text-xxs font-medium text-green-800">File parsed successfully</p>
              <p className="text-xxs text-green-700 truncate mt-0.5">{summary.source_filename}</p>
            </div>
            <button
              onClick={() => { setSummary(null); setFuelOverride(null) }}
              className="text-green-500 hover:text-green-700 flex-shrink-0 ml-1"
              title="Clear and upload a different file"
            >
              <X size={12} />
            </button>
          </div>

          {/* Stats grid */}
          <div className="grid grid-cols-2 gap-2">
            <Stat label="Records" value={summary.record_count?.toLocaleString()} />
            <Stat label="Total kWh" value={Math.round(summary.total_kwh ?? 0).toLocaleString()} />
            <Stat label="From" value={summary.data_start ?? '—'} />
            <Stat label="To"   value={summary.data_end   ?? '—'} />
            <Stat label="Interval" value={`${summary.interval_minutes ?? 30} min`} />
            <Stat
              label="Coverage"
              value={`${summary.provenance?.coverage_pct ?? '?'}%`}
              valueClass={
                (summary.provenance?.coverage_pct ?? 0) >= 80 ? 'text-green-600' :
                (summary.provenance?.coverage_pct ?? 0) >= 50 ? 'text-amber-600' : 'text-red-500'
              }
            />
          </div>

          {/* Provenance bar */}
          {summary.provenance && (
            <ProvenanceBar provenance={summary.provenance} />
          )}

          {/* Fuel type override */}
          <div className="flex items-center gap-2">
            <label className="text-xxs text-mid-grey flex-shrink-0">Fuel type:</label>
            <div className="flex gap-1">
              {['electricity', 'gas'].map(f => (
                <button
                  key={f}
                  onClick={() => setFuelOverride(f)}
                  className={`
                    flex items-center gap-1 px-2 py-1 rounded text-xxs font-medium
                    border transition-colors duration-100
                    ${fuel === f
                      ? 'bg-navy text-white border-navy'
                      : 'bg-white text-mid-grey border-light-grey hover:border-navy/40'
                    }
                  `}
                >
                  {f === 'electricity' ? <Zap size={10} /> : <Flame size={10} />}
                  {f === 'electricity' ? 'Electricity' : 'Gas'}
                </button>
              ))}
            </div>
            {!fuelOverride && (
              <span className="text-xxs text-mid-grey/60">(auto-detected)</span>
            )}
          </div>

          {/* Action buttons */}
          <div className="flex gap-2 pt-1">
            <button
              onClick={handleConfirm}
              className="flex-1 py-2 rounded text-xxs font-semibold text-white transition-colors"
              style={{ backgroundColor: '#2D6A7A' }}
            >
              Confirm Import
            </button>
            <button
              onClick={() => { setSummary(null); setFuelOverride(null); onCancel?.() }}
              className="px-4 py-2 rounded text-xxs text-mid-grey border border-light-grey hover:border-navy/30 transition-colors"
            >
              Cancel
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

// ── Sub-components ─────────────────────────────────────────────────────────

function Stat({ label, value, valueClass = 'text-navy' }) {
  return (
    <div className="bg-light-grey/40 rounded p-2">
      <p className="text-xxs text-mid-grey">{label}</p>
      <p className={`text-xs font-semibold tabular-nums mt-0.5 ${valueClass}`}>{value ?? '—'}</p>
    </div>
  )
}

function ProvenanceBar({ provenance }) {
  const { original = 0, donor_year = 0, weekday_fill = 0, interpolated = 0, monthly_avg = 0, total = 1 } = provenance
  const segments = [
    { key: 'original',     value: original,     color: '#16A34A', label: 'Actual'     },
    { key: 'donor_year',   value: donor_year,   color: '#2563EB', label: 'Donor year' },
    { key: 'weekday_fill', value: weekday_fill, color: '#7C3AED', label: 'Weekday avg' },
    { key: 'interpolated', value: interpolated, color: '#F59E0B', label: 'Interpolated' },
    { key: 'monthly_avg',  value: monthly_avg,  color: '#DC2626', label: 'Monthly avg' },
  ].filter(s => s.value > 0)

  return (
    <div className="flex flex-col gap-1">
      <p className="text-xxs text-mid-grey">Data provenance</p>
      {/* Stacked bar */}
      <div className="flex h-3 rounded overflow-hidden gap-px">
        {segments.map(s => (
          <div
            key={s.key}
            style={{ width: `${(s.value / total) * 100}%`, backgroundColor: s.color }}
            title={`${s.label}: ${s.value.toLocaleString()} (${Math.round(s.value / total * 100)}%)`}
          />
        ))}
      </div>
      {/* Legend */}
      <div className="flex flex-wrap gap-x-3 gap-y-0.5">
        {segments.map(s => (
          <span key={s.key} className="flex items-center gap-1 text-xxs text-mid-grey">
            <span className="w-2 h-2 rounded-sm flex-shrink-0" style={{ backgroundColor: s.color }} />
            {s.label} ({Math.round(s.value / total * 100)}%)
          </span>
        ))}
      </div>
    </div>
  )
}
