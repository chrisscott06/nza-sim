/**
 * FabricSummary.jsx
 *
 * Main area for the Fabric tab.
 * Shows a schematic cross-section with annotated U-values,
 * total heat loss coefficient (HTC), and element-by-element breakdown.
 */

import { useContext } from 'react'
import { BuildingContext } from '../../../context/BuildingContext.jsx'

// Benchmark range for UK hotels (W/K per m² of floor area)
// CIBSE TM54: typical hotel ~0.5-1.5 W/K·m²
const BENCHMARK_LABEL = 'Typical hotel HTC: 0.5 – 1.5 W/K·m²'

function ULabel({ u, area, label }) {
  if (u == null) return null
  const color =
    u <= 0.18 ? '#16A34A' :
    u <= 0.28 ? '#ECB01F' :
               '#DC2626'
  return (
    <div className="text-center">
      <p className="text-xxs text-mid-grey">{label}</p>
      <p className="text-caption font-semibold" style={{ color }}>
        {Number(u).toFixed(2)}
      </p>
      <p className="text-xxs text-mid-grey">W/m²K</p>
    </div>
  )
}

function HTCBar({ htc, maxHtc = 3000 }) {
  const pct = Math.min(100, (htc / maxHtc) * 100)
  const color = htc < 1500 ? '#16A34A' : htc < 2500 ? '#ECB01F' : '#DC2626'
  return (
    <div className="relative h-3 bg-gray-100 rounded-full overflow-hidden">
      <div
        className="h-full rounded-full transition-all duration-500"
        style={{ width: `${pct}%`, backgroundColor: color }}
      />
    </div>
  )
}

export default function FabricSummary({ library, constructions, details }) {
  const { params } = useContext(BuildingContext)

  if (!library || library.length === 0) return null

  // Compute areas from building params
  const { length = 60, width = 15, num_floors = 4, floor_height = 3.2, wwr = {} } = params
  const avgWwr = ((wwr.north ?? 0.25) + (wwr.south ?? 0.25) + (wwr.east ?? 0.25) + (wwr.west ?? 0.25)) / 4

  const perimeterArea   = 2 * (length + width) * num_floors * floor_height
  const glazingArea     = perimeterArea * avgWwr
  const wallArea        = perimeterArea - glazingArea
  const roofArea        = length * width
  const groundFloorArea = length * width
  const gia             = length * width * num_floors

  const getU = (key) => library.find(c => c.name === constructions?.[key])?.u_value_W_per_m2K

  const uWall  = getU('external_wall')
  const uRoof  = getU('roof')
  const uFloor = getU('ground_floor')
  const uGlaz  = getU('glazing')

  // HTC = sum of (U × A) for each element
  const htcWall  = uWall  != null ? uWall  * wallArea        : null
  const htcRoof  = uRoof  != null ? uRoof  * roofArea        : null
  const htcFloor = uFloor != null ? uFloor * groundFloorArea : null
  const htcGlaz  = uGlaz  != null ? uGlaz  * glazingArea     : null

  const components = [
    { label: 'External Wall', htc: htcWall,  area: wallArea,        u: uWall  },
    { label: 'Roof',          htc: htcRoof,  area: roofArea,        u: uRoof  },
    { label: 'Ground Floor',  htc: htcFloor, area: groundFloorArea, u: uFloor },
    { label: 'Glazing',       htc: htcGlaz,  area: glazingArea,     u: uGlaz  },
  ]

  const totalHtc = [htcWall, htcRoof, htcFloor, htcGlaz]
    .filter(v => v != null)
    .reduce((s, v) => s + v, 0)

  const maxHtc = Math.max(...components.map(c => c.htc ?? 0), 1)

  return (
    <div className="h-full overflow-y-auto p-6">
      {/* Schematic cross-section */}
      <div className="bg-white rounded-xl border border-light-grey p-5 mb-5">
        <h2 className="text-caption font-semibold text-navy mb-4">Envelope U-values</h2>

        <div className="relative mx-auto" style={{ maxWidth: 380, height: 200 }}>
          <svg viewBox="0 0 380 200" className="w-full h-full">
            {/* Ground */}
            <rect x="0" y="175" width="380" height="25" fill="#e5e7eb" rx="2" />
            <text x="190" y="189" textAnchor="middle" fontSize="10" fill="#6b7280">Ground</text>

            {/* Building body */}
            <rect x="60" y="50" width="260" height="130" fill="#f0f4ff" stroke="#2B2A4C" strokeWidth="2" />

            {/* Roof */}
            <rect x="55" y="40" width="270" height="14" fill="#2B2A4C" rx="2" />

            {/* Floor slab */}
            <rect x="60" y="164" width="260" height="11" fill="#94a3b8" />

            {/* Glazing strip (right side) */}
            <rect x="260" y="70" width="45" height="80" fill="#bae6fd" stroke="#0ea5e9" strokeWidth="1.5" rx="1" />

            {/* U-value annotations */}
            {/* Roof */}
            {uRoof != null && (
              <>
                <line x1="190" y1="40" x2="190" y2="25" stroke="#6b7280" strokeWidth="1" strokeDasharray="3,2" />
                <text x="190" y="22" textAnchor="middle" fontSize="10" fontWeight="600"
                  fill={uRoof <= 0.18 ? '#16A34A' : uRoof <= 0.28 ? '#b45309' : '#dc2626'}>
                  U={Number(uRoof).toFixed(2)}
                </text>
                <text x="190" y="13" textAnchor="middle" fontSize="8" fill="#6b7280">Roof</text>
              </>
            )}

            {/* Wall (left) */}
            {uWall != null && (
              <>
                <line x1="60" y1="115" x2="38" y2="115" stroke="#6b7280" strokeWidth="1" strokeDasharray="3,2" />
                <text x="35" y="118" textAnchor="end" fontSize="10" fontWeight="600"
                  fill={uWall <= 0.18 ? '#16A34A' : uWall <= 0.28 ? '#b45309' : '#dc2626'}>
                  U={Number(uWall).toFixed(2)}
                </text>
                <text x="35" y="108" textAnchor="end" fontSize="8" fill="#6b7280">Wall</text>
              </>
            )}

            {/* Floor */}
            {uFloor != null && (
              <>
                <line x1="130" y1="175" x2="130" y2="192" stroke="#6b7280" strokeWidth="1" strokeDasharray="3,2" />
                <text x="130" y="200" textAnchor="middle" fontSize="10" fontWeight="600"
                  fill={uFloor <= 0.18 ? '#16A34A' : uFloor <= 0.28 ? '#b45309' : '#dc2626'}>
                  U={Number(uFloor).toFixed(2)}
                </text>
              </>
            )}

            {/* Glazing (right) */}
            {uGlaz != null && (
              <>
                <line x1="305" y1="110" x2="340" y2="110" stroke="#6b7280" strokeWidth="1" strokeDasharray="3,2" />
                <text x="343" y="113" fontSize="10" fontWeight="600"
                  fill={uGlaz <= 1.0 ? '#16A34A' : uGlaz <= 1.6 ? '#b45309' : '#dc2626'}>
                  U={Number(uGlaz).toFixed(2)}
                </text>
                <text x="343" y="103" fontSize="8" fill="#6b7280">Glazing</text>
              </>
            )}
          </svg>
        </div>
      </div>

      {/* HTC Summary */}
      <div className="bg-white rounded-xl border border-light-grey p-5 mb-5">
        <div className="flex items-center justify-between mb-1">
          <h2 className="text-caption font-semibold text-navy">Heat Loss Coefficient (HTC)</h2>
          <span className="text-section font-semibold text-navy">
            {Math.round(totalHtc).toLocaleString()} W/K
          </span>
        </div>
        <p className="text-xs text-mid-grey mb-3">Sum of U × A for all elements</p>

        {/* Element breakdown */}
        <div className="space-y-2">
          {components.map(({ label, htc, area, u }) => {
            if (htc == null) return null
            const pct = maxHtc > 0 ? (htc / maxHtc) * 100 : 0
            const color = '#2B2A4C'
            return (
              <div key={label}>
                <div className="flex justify-between text-xs mb-0.5">
                  <span className="text-dark-grey">{label}</span>
                  <span className="text-navy font-medium">{Math.round(htc).toLocaleString()} W/K</span>
                </div>
                <div className="relative h-2 bg-gray-100 rounded-full overflow-hidden">
                  <div
                    className="h-full rounded-full"
                    style={{ width: `${pct}%`, backgroundColor: color, opacity: 0.7 }}
                  />
                </div>
                <p className="text-xxs text-mid-grey mt-0.5">
                  {Math.round(area)} m² · U = {Number(u).toFixed(3)} W/m²K
                </p>
              </div>
            )
          })}
        </div>
      </div>

      {/* Building areas summary */}
      <div className="bg-white rounded-xl border border-light-grey p-5">
        <h2 className="text-caption font-semibold text-navy mb-3">Envelope Areas</h2>
        <div className="grid grid-cols-2 gap-3">
          {[
            { label: 'External wall', value: Math.round(wallArea), unit: 'm²' },
            { label: 'Glazing',       value: Math.round(glazingArea), unit: 'm²' },
            { label: 'Roof',          value: Math.round(roofArea), unit: 'm²' },
            { label: 'Ground floor',  value: Math.round(groundFloorArea), unit: 'm²' },
            { label: 'GIA',           value: Math.round(gia), unit: 'm²' },
            { label: 'Avg WWR',       value: Math.round(avgWwr * 100), unit: '%' },
          ].map(({ label, value, unit }) => (
            <div key={label} className="flex justify-between text-caption">
              <span className="text-mid-grey">{label}</span>
              <span className="font-medium text-navy">{value.toLocaleString()} {unit}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
