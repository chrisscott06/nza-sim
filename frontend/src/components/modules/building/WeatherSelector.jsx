/**
 * WeatherSelector.jsx
 *
 * Postcode-based UK weather station finder and downloader.
 * Queries /api/weather/nearest for the closest TMYx station,
 * then /api/weather/download to fetch and save the EPW.
 *
 * Props:
 *   currentWeatherFile  — string | null  (currently selected weather filename)
 *   futureWeatherFile   — string | null
 *   weatherFiles        — array from /api/weather (all available files)
 *   onWeatherChange     — callback(filename) for current weather file change
 *   onFutureChange      — callback(filename | null) for future weather change
 *   projectLat          — number (project latitude for mismatch warning)
 */

import { useState, useMemo } from 'react'
import { MapPin, Download, CheckCircle2, AlertTriangle, RefreshCw, Search } from 'lucide-react'

const TEAL = '#2D6A7A'

export default function WeatherSelector({
  currentWeatherFile,
  futureWeatherFile,
  weatherFiles = [],
  onWeatherChange,
  onFutureChange,
  projectLat = null,
}) {
  const [postcode,       setPostcode]       = useState('')
  const [searching,      setSearching]      = useState(false)
  const [searchError,    setSearchError]    = useState(null)
  const [nearestResult,  setNearestResult]  = useState(null)  // { nearest, alternatives, location }
  const [downloading,    setDownloading]    = useState(false)
  const [downloadStatus, setDownloadStatus] = useState(null)  // 'done' | 'error' | null
  const [downloadError,  setDownloadError]  = useState(null)

  // ── Derived file lists ──────────────────────────────────────────────────────
  const currentFiles = useMemo(
    () => weatherFiles.filter(f => f.category === 'current' || f.category === 'bundled'),
    [weatherFiles]
  )
  const futureFiles = useMemo(
    () => weatherFiles.filter(f => f.category?.startsWith('future')),
    [weatherFiles]
  )
  const futureByPeriod = useMemo(() => {
    const map = {}
    for (const f of futureFiles) {
      const period = f.period ?? 'Other'
      if (!map[period]) map[period] = []
      map[period].push(f)
    }
    return map
  }, [futureFiles])

  const selectedFileMeta = useMemo(
    () => weatherFiles.find(f => f.filename === currentWeatherFile),
    [weatherFiles, currentWeatherFile]
  )
  const weatherLat = selectedFileMeta?.latitude ?? null
  const locationMismatch = projectLat != null && weatherLat != null
    && Math.abs(weatherLat - projectLat) > 1.5

  // ── Search handler ──────────────────────────────────────────────────────────
  async function handleSearch(e) {
    e.preventDefault()
    if (!postcode.trim()) return
    setSearching(true)
    setSearchError(null)
    setNearestResult(null)
    setDownloadStatus(null)
    try {
      const r = await fetch(`/api/weather/nearest?postcode=${encodeURIComponent(postcode.trim())}`)
      if (!r.ok) {
        const err = await r.json().catch(() => ({ detail: `HTTP ${r.status}` }))
        throw new Error(err.detail ?? `HTTP ${r.status}`)
      }
      setNearestResult(await r.json())
    } catch (e) {
      setSearchError(e.message)
    } finally {
      setSearching(false)
    }
  }

  // ── Download handler ────────────────────────────────────────────────────────
  async function handleDownload(station) {
    setDownloading(true)
    setDownloadError(null)
    setDownloadStatus(null)
    try {
      const r = await fetch('/api/weather/download', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          filename:     station.filename,
          download_url: station.download_url,
          station_name: station.name,
        }),
      })
      if (!r.ok) {
        const err = await r.json().catch(() => ({ detail: `HTTP ${r.status}` }))
        throw new Error(err.detail ?? `HTTP ${r.status}`)
      }
      const result = await r.json()
      setDownloadStatus('done')
      // Set as the active weather file
      const epwName = result.filename ?? station.filename.replace('.zip', '.epw')
      onWeatherChange?.(epwName)
    } catch (e) {
      setDownloadStatus('error')
      setDownloadError(e.message)
    } finally {
      setDownloading(false)
    }
  }

  // ── Use already-downloaded station ─────────────────────────────────────────
  function handleUse(station) {
    const epwName = station.filename.replace('.zip', '.epw')
    onWeatherChange?.(epwName)
    setDownloadStatus('done')
  }

  const nearest = nearestResult?.nearest

  return (
    <div className="space-y-3">

      {/* ── Postcode search ─────────────────────────────────────────────────── */}
      <form onSubmit={handleSearch} className="flex gap-1.5">
        <div className="relative flex-1">
          <MapPin size={10} className="absolute left-2 top-1/2 -translate-y-1/2 text-mid-grey pointer-events-none" />
          <input
            type="text"
            placeholder="Postcode (e.g. TA6 6DF)"
            value={postcode}
            onChange={e => setPostcode(e.target.value)}
            className="w-full pl-6 pr-2 py-1.5 text-xxs border border-light-grey rounded focus:outline-none focus:border-teal"
          />
        </div>
        <button
          type="submit"
          disabled={searching || !postcode.trim()}
          className="flex items-center gap-1 px-2 py-1.5 text-xxs font-medium text-white rounded transition-opacity hover:opacity-90 disabled:opacity-40 flex-shrink-0"
          style={{ backgroundColor: TEAL }}
        >
          {searching
            ? <RefreshCw size={10} className="animate-spin" />
            : <Search size={10} />
          }
          {searching ? 'Searching\u2026' : 'Find'}
        </button>
      </form>

      {searchError && (
        <p className="text-xxs text-red-600 flex items-center gap-1">
          <AlertTriangle size={10} />
          {searchError}
        </p>
      )}

      {/* ── Nearest station result ──────────────────────────────────────────── */}
      {nearest && (
        <div className="border border-light-grey rounded-lg p-2.5 space-y-2 bg-off-white">
          {/* Primary result */}
          <div className="flex items-start justify-between gap-2">
            <div>
              <p className="text-xxs font-semibold text-navy">{nearest.name}</p>
              <p className="text-xxs text-mid-grey">
                {nearest.distance_km} km away &middot; {nearest.latitude?.toFixed(2)}&deg;N {Math.abs(nearest.longitude)?.toFixed(2)}&deg;{nearest.longitude >= 0 ? 'E' : 'W'}
              </p>
              <p className="text-xxs text-mid-grey">TMYx 2011-2025 &middot; {nearest.region}</p>
            </div>

            {/* Download / Use button */}
            {downloadStatus === 'done' ? (
              <div className="flex items-center gap-1 text-xxs text-green-600 flex-shrink-0">
                <CheckCircle2 size={12} />
                <span className="font-medium">Active</span>
              </div>
            ) : nearest.already_downloaded ? (
              <button
                onClick={() => handleUse(nearest)}
                className="flex items-center gap-1 px-2 py-1 text-xxs font-medium text-white rounded flex-shrink-0 transition-opacity hover:opacity-90"
                style={{ backgroundColor: TEAL }}
              >
                <CheckCircle2 size={10} />
                Use this
              </button>
            ) : (
              <button
                onClick={() => handleDownload(nearest)}
                disabled={downloading}
                className="flex items-center gap-1 px-2 py-1 text-xxs font-medium text-white rounded flex-shrink-0 transition-opacity hover:opacity-90 disabled:opacity-50"
                style={{ backgroundColor: TEAL }}
              >
                {downloading
                  ? <RefreshCw size={10} className="animate-spin" />
                  : <Download size={10} />
                }
                {downloading ? 'Downloading\u2026' : 'Download & Use'}
              </button>
            )}
          </div>

          {downloadError && (
            <p className="text-xxs text-red-600">{downloadError}</p>
          )}

          {/* Alternatives */}
          {nearestResult?.alternatives?.length > 0 && (
            <div className="border-t border-light-grey pt-2">
              <p className="text-xxs text-mid-grey mb-1">Alternatives:</p>
              {nearestResult.alternatives.map(alt => (
                <button
                  key={alt.wmo_id}
                  onClick={() => alt.already_downloaded ? handleUse(alt) : handleDownload(alt)}
                  className="w-full flex items-center justify-between py-0.5 text-left hover:text-teal transition-colors group"
                >
                  <span className="text-xxs text-dark-grey group-hover:text-teal">{alt.name}</span>
                  <span className="text-xxs text-mid-grey">{alt.distance_km} km</span>
                </button>
              ))}
            </div>
          )}
        </div>
      )}

      {/* ── Current weather file ────────────────────────────────────────────── */}
      <div className="space-y-1">
        <label className="text-xxs text-mid-grey block">Current weather file</label>
        <select
          value={currentWeatherFile ?? 'default'}
          onChange={e => onWeatherChange?.(e.target.value)}
          className="w-full px-2 py-1 text-xxs border border-light-grey rounded focus:outline-none focus:border-teal bg-white"
        >
          <option value="default">Auto-select (default)</option>
          {currentFiles.map(f => (
            <option key={f.filename} value={f.filename}>{f.display_name ?? f.filename}</option>
          ))}
        </select>
        {locationMismatch && (
          <p className="text-xxs text-amber-600 flex items-center gap-1">
            <AlertTriangle size={10} />
            Weather station ({weatherLat?.toFixed(1)}&deg;N) may not match project location ({projectLat?.toFixed(1)}&deg;N)
          </p>
        )}
        {selectedFileMeta && !locationMismatch && (
          <p className="text-xxs text-mid-grey">
            {selectedFileMeta.city} &mdash; {selectedFileMeta.latitude?.toFixed(2)}&deg;N
          </p>
        )}
      </div>

      {/* ── Future climate dropdown ─────────────────────────────────────────── */}
      {futureFiles.length > 0 && (
        <div className="space-y-1">
          <label className="text-xxs text-mid-grey block">Future climate (optional)</label>
          <select
            value={futureWeatherFile ?? ''}
            onChange={e => onFutureChange?.(e.target.value || null)}
            className="w-full px-2 py-1 text-xxs border border-light-grey rounded focus:outline-none focus:border-teal bg-white"
          >
            <option value="">None (current climate only)</option>
            {Object.entries(futureByPeriod).sort().map(([period, files]) => (
              <optgroup key={period} label={`${period}s`}>
                {files.map(f => (
                  <option key={f.filename} value={f.filename}>{f.display_name ?? f.filename}</option>
                ))}
              </optgroup>
            ))}
          </select>
          {futureWeatherFile && (
            <p className="text-xxs text-teal">\u2139 Modelling with future climate scenario</p>
          )}
        </div>
      )}
    </div>
  )
}
