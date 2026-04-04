/**
 * ConsumptionManager.jsx
 *
 * Top-level Consumption module page.
 * Three-column layout: left = dataset list + upload, centre = visualisations, right = metrics.
 * Parts 4–9 progressively fill in the centre and right panels.
 */

import { useState, useEffect, useContext, useCallback } from 'react'
import {
  Upload, Zap, Flame, Trash2, BarChart3, ChevronRight,
  FileSpreadsheet, AlertCircle, RefreshCw,
} from 'lucide-react'
import { ProjectContext } from '../../../context/ProjectContext.jsx'
import ConsumptionUpload from './ConsumptionUpload.jsx'
import MonthlyComparisonChart from './MonthlyComparisonChart.jsx'
import DailyProfileChart from './DailyProfileChart.jsx'
import HalfHourlyHeatmap from './HalfHourlyHeatmap.jsx'

// Accent colour for this module
const TEAL = '#2D6A7A'

export default function ConsumptionManager() {
  const { currentProjectId: projectId, params } = useContext(ProjectContext)
  const gia = (params?.length ?? 0) * (params?.width ?? 0) * (params?.num_floors ?? 0)

  const [datasets,     setDatasets]     = useState([])
  const [loading,      setLoading]      = useState(true)
  const [fetchError,   setFetchError]   = useState(null)
  const [showUpload,   setShowUpload]   = useState(false)
  const [selected,     setSelected]     = useState(null)   // id of selected dataset
  const [deleting,     setDeleting]     = useState(null)   // id being deleted

  // ── Load dataset list ─────────────────────────────────────────────────────
  const loadDatasets = useCallback(async () => {
    if (!projectId) return
    setLoading(true)
    setFetchError(null)
    try {
      const res = await fetch(`/api/projects/${projectId}/consumption`)
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const data = await res.json()
      setDatasets(data.datasets ?? [])
    } catch (err) {
      setFetchError(err.message)
    } finally {
      setLoading(false)
    }
  }, [projectId])

  useEffect(() => { loadDatasets() }, [loadDatasets])

  // ── Auto-select first dataset ─────────────────────────────────────────────
  useEffect(() => {
    if (datasets.length > 0 && !selected) {
      setSelected(datasets[0].id)
    }
  }, [datasets]) // eslint-disable-line react-hooks/exhaustive-deps

  // ── Import complete callback ──────────────────────────────────────────────
  function handleImported(summary) {
    setShowUpload(false)
    loadDatasets().then(() => setSelected(summary.id))
  }

  // ── Delete ────────────────────────────────────────────────────────────────
  async function handleDelete(id, e) {
    e.stopPropagation()
    if (!confirm('Delete this consumption dataset? This cannot be undone.')) return
    setDeleting(id)
    try {
      const res = await fetch(`/api/projects/${projectId}/consumption/${id}`, { method: 'DELETE' })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      setDatasets(prev => prev.filter(d => d.id !== id))
      if (selected === id) setSelected(null)
    } catch (err) {
      alert(`Delete failed: ${err.message}`)
    } finally {
      setDeleting(null)
    }
  }

  const selectedDataset = datasets.find(d => d.id === selected)

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <div className="flex h-full overflow-hidden">

      {/* ── Left panel — dataset list ─────────────────────────────────────── */}
      <aside className="w-64 flex-shrink-0 border-r border-light-grey flex flex-col overflow-hidden">

        {/* Panel header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-light-grey">
          <h2 className="text-xs font-semibold text-navy">Metered Data</h2>
          <button
            onClick={() => setShowUpload(v => !v)}
            className="flex items-center gap-1 px-2 py-1 rounded text-xxs font-medium text-white transition-colors"
            style={{ backgroundColor: TEAL }}
            title="Upload new dataset"
          >
            <Upload size={10} />
            Upload
          </button>
        </div>

        {/* Upload panel (inline) */}
        {showUpload && (
          <div className="border-b border-light-grey p-3 bg-light-grey/20">
            <ConsumptionUpload
              projectId={projectId}
              onImported={handleImported}
              onCancel={() => setShowUpload(false)}
            />
          </div>
        )}

        {/* Dataset list */}
        <div className="flex-1 overflow-y-auto">
          {loading && (
            <div className="flex items-center justify-center py-8">
              <RefreshCw size={14} className="text-mid-grey animate-spin" />
            </div>
          )}

          {fetchError && !loading && (
            <div className="p-3">
              <div className="flex items-start gap-2 p-2 bg-red-50 border border-red-200 rounded text-xxs text-red-700">
                <AlertCircle size={12} className="mt-0.5 flex-shrink-0" />
                <span>{fetchError}</span>
              </div>
            </div>
          )}

          {!loading && !fetchError && datasets.length === 0 && (
            <div className="flex flex-col items-center justify-center py-10 px-4 text-center gap-2">
              <FileSpreadsheet size={24} className="text-light-grey" />
              <p className="text-xxs text-mid-grey">No datasets yet</p>
              <p className="text-xxs text-mid-grey/70">Upload a CSV or Excel file to get started</p>
            </div>
          )}

          {datasets.map(ds => (
            <DatasetCard
              key={ds.id}
              dataset={ds}
              isSelected={ds.id === selected}
              isDeleting={ds.id === deleting}
              onClick={() => setSelected(ds.id)}
              onDelete={handleDelete}
            />
          ))}
        </div>
      </aside>

      {/* ── Centre panel — visualisations ─────────────────────────────────── */}
      <main className="flex-1 flex flex-col overflow-hidden">
        {selectedDataset ? (
          <DatasetDetail dataset={selectedDataset} projectId={projectId} gia={gia} />
        ) : (
          <EmptyState onUpload={() => setShowUpload(true)} />
        )}
      </main>

      {/* ── Right panel — summary metrics ─────────────────────────────────── */}
      <aside className="w-56 flex-shrink-0 border-l border-light-grey flex flex-col overflow-y-auto">
        {selectedDataset ? (
          <MetricsPanel dataset={selectedDataset} />
        ) : (
          <div className="flex-1 flex items-center justify-center p-4">
            <p className="text-xxs text-mid-grey text-center">Select a dataset to see metrics</p>
          </div>
        )}
      </aside>
    </div>
  )
}

// ── DatasetCard ────────────────────────────────────────────────────────────

function DatasetCard({ dataset, isSelected, isDeleting, onClick, onDelete }) {
  const isElec = dataset.fuel_type === 'electricity'
  return (
    <button
      onClick={onClick}
      className={`
        w-full text-left px-3 py-2.5 border-b border-light-grey/60
        flex items-start gap-2 transition-colors duration-100 group
        ${isSelected ? 'bg-teal/8' : 'hover:bg-light-grey/40'}
      `}
      style={isSelected ? { backgroundColor: `${TEAL}12` } : {}}
    >
      {/* Fuel icon */}
      <div
        className="w-7 h-7 rounded flex items-center justify-center flex-shrink-0 mt-0.5"
        style={{ backgroundColor: isElec ? '#FEF9C3' : '#FEF2F2' }}
      >
        {isElec
          ? <Zap  size={13} style={{ color: '#CA8A04' }} />
          : <Flame size={13} style={{ color: '#DC2626' }} />
        }
      </div>

      {/* Details */}
      <div className="flex-1 min-w-0">
        <p className="text-xxs font-semibold text-navy truncate capitalize">
          {dataset.fuel_type}
        </p>
        <p className="text-xxs text-mid-grey">
          {dataset.data_start ?? '—'} → {dataset.data_end ?? '—'}
        </p>
        <p className="text-xxs text-mid-grey tabular-nums">
          {Math.round(dataset.total_kwh ?? 0).toLocaleString()} kWh
          <span className="text-mid-grey/60 ml-1">({(dataset.record_count ?? 0).toLocaleString()} records)</span>
        </p>
      </div>

      {/* Right: chevron (selected) or delete (hover) */}
      <div className="flex-shrink-0 flex items-center">
        {isDeleting ? (
          <RefreshCw size={12} className="text-mid-grey animate-spin" />
        ) : (
          <>
            <button
              onClick={e => onDelete(dataset.id, e)}
              className="opacity-0 group-hover:opacity-100 transition-opacity p-0.5 text-mid-grey hover:text-red-500"
              title="Delete dataset"
            >
              <Trash2 size={12} />
            </button>
            {isSelected && <ChevronRight size={12} className="text-mid-grey ml-1" />}
          </>
        )}
      </div>
    </button>
  )
}

// ── DatasetDetail (centre column content) ─────────────────────────────────

const TABS = [
  { id: 'crrem',   label: 'vs CRREM'    },
  { id: 'monthly', label: 'Monthly'     },
  { id: 'daily',   label: 'Daily'       },
  { id: 'heatmap', label: 'Heatmap'     },
  { id: 'model',   label: 'vs Model'    },
]

function DatasetDetail({ dataset, projectId, gia }) {
  const [monthly,  setMonthly]  = useState(null)
  const [loading,  setLoading]  = useState(false)
  const [error,    setError]    = useState(null)
  const [activeTab, setActiveTab] = useState('crrem')

  useEffect(() => {
    if (!dataset?.id) return
    setLoading(true)
    setError(null)
    fetch(`/api/projects/${projectId}/consumption/${dataset.id}/monthly`)
      .then(r => { if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.json() })
      .then(data => setMonthly(data.monthly ?? []))
      .catch(err => setError(err.message))
      .finally(() => setLoading(false))
  }, [dataset?.id, projectId])

  const isElec = dataset.fuel_type === 'electricity'
  const barColor = isElec ? '#CA8A04' : '#DC2626'

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* Header */}
      <div className="flex items-center gap-3 px-5 py-3 border-b border-light-grey flex-shrink-0">
        <div
          className="w-8 h-8 rounded flex items-center justify-center flex-shrink-0"
          style={{ backgroundColor: isElec ? '#FEF9C3' : '#FEF2F2' }}
        >
          {isElec ? <Zap size={15} style={{ color: '#CA8A04' }} /> : <Flame size={15} style={{ color: '#DC2626' }} />}
        </div>
        <div className="flex-1 min-w-0">
          <h3 className="text-xs font-semibold text-navy capitalize">{dataset.fuel_type} consumption</h3>
          <p className="text-xxs text-mid-grey truncate">
            {dataset.source_filename}
            {dataset.interval_minutes && ` · ${dataset.interval_minutes}-minute intervals`}
          </p>
        </div>
        <div className="flex items-baseline gap-1">
          <span className="text-lg font-bold tabular-nums text-navy">
            {Math.round(dataset.total_kwh ?? 0).toLocaleString()}
          </span>
          <span className="text-xxs text-mid-grey">kWh total</span>
        </div>
      </div>

      {/* Tab bar */}
      <div className="flex border-b border-light-grey flex-shrink-0 px-5">
        {TABS.map(tab => {
          const isComingSoon = tab.id === 'model'
          return (
            <button
              key={tab.id}
              onClick={() => !isComingSoon && setActiveTab(tab.id)}
              disabled={isComingSoon}
              className={`
                px-3 py-2 text-xxs font-medium border-b-2 transition-colors duration-100
                ${activeTab === tab.id
                  ? 'border-[#2D6A7A] text-[#2D6A7A]'
                  : isComingSoon
                    ? 'border-transparent text-mid-grey/50 cursor-not-allowed'
                    : 'border-transparent text-mid-grey hover:text-navy'
                }
              `}
            >
              {tab.label}
              {isComingSoon && <span className="ml-1 text-xxs text-mid-grey/40">•••</span>}
            </button>
          )
        })}
      </div>

      {/* Tab content */}
      <div className="flex-1 overflow-y-auto p-5">
        {loading && (
          <div className="flex items-center justify-center py-10">
            <RefreshCw size={14} className="text-mid-grey animate-spin" />
          </div>
        )}

        {error && !loading && (
          <p className="text-xxs text-red-500">Failed to load data: {error}</p>
        )}

        {!loading && !error && monthly && activeTab === 'crrem' && (
          <MonthlyComparisonChart
            monthly={monthly}
            fuelType={dataset.fuel_type}
            gia={gia}
          />
        )}

        {!loading && !error && monthly && activeTab === 'monthly' && (
          <div className="flex flex-col gap-2">
            <h4 className="text-xxs font-semibold text-mid-grey uppercase tracking-wide">Monthly totals</h4>
            {monthly.length > 0
              ? <MonthlyBarChart data={monthly} color={barColor} />
              : <p className="text-xxs text-mid-grey">No monthly data available.</p>
            }
          </div>
        )}

        {!loading && !error && activeTab === 'daily' && (
          <DailyProfileChart
            datasetId={dataset.id}
            projectId={projectId}
            fuelType={dataset.fuel_type}
          />
        )}

        {!loading && !error && activeTab === 'heatmap' && (
          <HalfHourlyHeatmap
            datasetId={dataset.id}
            projectId={projectId}
            fuelType={dataset.fuel_type}
            intervalMinutes={dataset.interval_minutes ?? 30}
          />
        )}

        {!loading && !error && activeTab === 'model' && (
          <div className="flex flex-col items-center justify-center py-12 gap-2 text-center">
            <BarChart3 size={24} className="text-light-grey" />
            <p className="text-xxs text-mid-grey font-medium">Coming in Brief 15 Part 7</p>
            <p className="text-xxs text-mid-grey/60">Actual vs modelled energy — performance gap breakdown</p>
          </div>
        )}
      </div>
    </div>
  )
}

// ── MonthlyBarChart ────────────────────────────────────────────────────────

const MONTH_LABELS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']

function MonthlyBarChart({ data, color }) {
  const max = Math.max(...data.map(d => d.kwh ?? 0), 1)
  return (
    <div className="bg-light-grey/20 rounded-lg p-4">
      <div className="flex items-end gap-1 h-24">
        {MONTH_LABELS.map((label, i) => {
          const row = data.find(d => d.month?.endsWith(`-${String(i + 1).padStart(2, '0')}`))
          const kwh = row?.kwh ?? 0
          const pct = kwh / max
          return (
            <div key={label} className="flex-1 flex flex-col items-center gap-0.5 group relative">
              {/* Tooltip */}
              <div className="absolute bottom-full mb-1 hidden group-hover:flex flex-col items-center z-10 pointer-events-none">
                <div className="bg-navy text-white text-xxs px-1.5 py-0.5 rounded whitespace-nowrap shadow">
                  {Math.round(kwh).toLocaleString()} kWh
                </div>
                <div className="w-0 h-0 border-l-4 border-r-4 border-t-4 border-transparent"
                     style={{ borderTopColor: '#0F172A' }} />
              </div>
              {/* Bar */}
              <div
                className="w-full rounded-t transition-all duration-300"
                style={{
                  height: `${Math.max(pct * 80, kwh > 0 ? 2 : 0)}px`,
                  backgroundColor: color,
                  opacity: 0.85,
                }}
              />
              <span className="text-xxs text-mid-grey/70">{label}</span>
            </div>
          )
        })}
      </div>
    </div>
  )
}

// ── MetricsPanel (right column) ───────────────────────────────────────────

function MetricsPanel({ dataset }) {
  const provenance = dataset.provenance_json
    ? (typeof dataset.provenance_json === 'string'
        ? JSON.parse(dataset.provenance_json)
        : dataset.provenance_json)
    : null

  return (
    <div className="flex flex-col gap-4 p-4">
      <h3 className="text-xxs font-semibold text-mid-grey uppercase tracking-wide">Dataset summary</h3>

      <div className="flex flex-col gap-2">
        <MetricRow label="Total kWh"     value={Math.round(dataset.total_kwh ?? 0).toLocaleString()} />
        <MetricRow label="Records"       value={(dataset.record_count ?? 0).toLocaleString()} />
        <MetricRow label="Interval"      value={`${dataset.interval_minutes ?? 30} min`} />
        <MetricRow label="Date start"    value={dataset.data_start ?? '—'} />
        <MetricRow label="Date end"      value={dataset.data_end   ?? '—'} />
        {dataset.imported_at && (
          <MetricRow label="Imported"    value={dataset.imported_at.slice(0, 10)} />
        )}
      </div>

      {provenance && (
        <>
          <div className="border-t border-light-grey pt-3">
            <h3 className="text-xxs font-semibold text-mid-grey uppercase tracking-wide mb-2">Data quality</h3>
            <div className="flex flex-col gap-1.5">
              <QualityRow
                label="Actual"
                count={provenance.original}
                total={provenance.total}
                color="#16A34A"
              />
              <QualityRow
                label="Donor year"
                count={provenance.donor_year}
                total={provenance.total}
                color="#2563EB"
              />
              <QualityRow
                label="Weekday avg"
                count={provenance.weekday_fill}
                total={provenance.total}
                color="#7C3AED"
              />
              <QualityRow
                label="Interpolated"
                count={provenance.interpolated}
                total={provenance.total}
                color="#F59E0B"
              />
              <QualityRow
                label="Monthly avg"
                count={provenance.monthly_avg}
                total={provenance.total}
                color="#DC2626"
              />
            </div>
          </div>

          <div className="flex items-center gap-1.5 p-2 rounded"
               style={{
                 backgroundColor: (provenance.coverage_pct ?? 0) >= 80 ? '#F0FDF4' : '#FFFBEB',
                 borderColor:     (provenance.coverage_pct ?? 0) >= 80 ? '#BBF7D0' : '#FDE68A',
                 border: '1px solid',
               }}>
            <span className="text-sm font-bold tabular-nums"
                  style={{ color: (provenance.coverage_pct ?? 0) >= 80 ? '#16A34A' : '#D97706' }}>
              {provenance.coverage_pct ?? '?'}%
            </span>
            <span className="text-xxs" style={{ color: (provenance.coverage_pct ?? 0) >= 80 ? '#15803D' : '#B45309' }}>
              original data coverage
            </span>
          </div>
        </>
      )}
    </div>
  )
}

function MetricRow({ label, value }) {
  return (
    <div className="flex items-baseline justify-between gap-2">
      <span className="text-xxs text-mid-grey">{label}</span>
      <span className="text-xxs font-medium text-navy tabular-nums">{value}</span>
    </div>
  )
}

function QualityRow({ label, count, total, color }) {
  if (!count) return null
  const pct = total > 0 ? Math.round(count / total * 100) : 0
  return (
    <div className="flex items-center gap-2">
      <span className="w-2 h-2 rounded-sm flex-shrink-0" style={{ backgroundColor: color }} />
      <span className="text-xxs text-mid-grey flex-1">{label}</span>
      <span className="text-xxs tabular-nums font-medium" style={{ color }}>{pct}%</span>
    </div>
  )
}

// ── Empty state ────────────────────────────────────────────────────────────

function EmptyState({ onUpload }) {
  return (
    <div className="flex-1 flex flex-col items-center justify-center gap-4 p-8 text-center">
      <div className="w-14 h-14 rounded-full bg-light-grey/60 flex items-center justify-center">
        <FileSpreadsheet size={24} className="text-mid-grey" />
      </div>
      <div>
        <p className="text-sm font-semibold text-navy">No consumption data</p>
        <p className="text-xxs text-mid-grey mt-1 max-w-xs">
          Upload a half-hourly CSV or Excel file to visualise actual energy consumption
          against CRREM decarbonisation targets.
        </p>
      </div>
      <button
        onClick={onUpload}
        className="flex items-center gap-2 px-4 py-2 rounded text-xs font-semibold text-white transition-opacity hover:opacity-90"
        style={{ backgroundColor: TEAL }}
      >
        <Upload size={13} />
        Upload consumption data
      </button>
    </div>
  )
}
