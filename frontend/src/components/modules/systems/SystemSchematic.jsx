/**
 * SystemSchematic.jsx
 *
 * Visual flow diagram of building energy systems.
 * Simple SVG-based layout showing energy inputs → systems → delivered energy.
 * Updates when system selections change.
 */

import { useContext } from 'react'
import { ProjectContext } from '../../../context/ProjectContext.jsx'

// ── System card ───────────────────────────────────────────────────────────────

function SystemBox({ x, y, w, h, label, sublabel, color, icon }) {
  return (
    <g>
      <rect x={x} y={y} width={w} height={h} rx="4" fill={color + '15'} stroke={color} strokeWidth="1.5" />
      <text x={x + w / 2} y={y + h / 2 - 6} textAnchor="middle" fontSize="9" fontWeight="600" fill={color}>
        {icon} {label}
      </text>
      {sublabel && (
        <text x={x + w / 2} y={y + h / 2 + 8} textAnchor="middle" fontSize="7.5" fill="#95A5A6">
          {sublabel}
        </text>
      )}
    </g>
  )
}

function Arrow({ x1, y1, x2, y2, color = '#E6E6E6', width = 2, label }) {
  const mx = (x1 + x2) / 2
  const my = (y1 + y2) / 2
  return (
    <g>
      <line x1={x1} y1={y1} x2={x2} y2={y2} stroke={color} strokeWidth={width} strokeLinecap="round" />
      <polygon
        points={`${x2},${y2} ${x2 - 5},${y2 - 3} ${x2 - 5},${y2 + 3}`}
        fill={color}
        transform={x1 === x2 ? `rotate(90, ${x2}, ${y2})` : ''}
      />
      {label && (
        <text x={mx} y={my - 4} textAnchor="middle" fontSize="7" fill="#95A5A6">{label}</text>
      )}
    </g>
  )
}

// ── Energy input node (electricity / gas) ──────────────────────────────────────

function InputNode({ x, y, label, color }) {
  return (
    <g>
      <circle cx={x} cy={y} r="18" fill={color + '20'} stroke={color} strokeWidth="1.5" />
      <text x={x} y={y + 4} textAnchor="middle" fontSize="8" fontWeight="600" fill={color}>{label}</text>
    </g>
  )
}

// ── Delivered energy node ──────────────────────────────────────────────────────

function OutputNode({ x, y, label, color }) {
  return (
    <g>
      <rect x={x - 28} y={y - 12} width="56" height="24" rx="3" fill={color + '10'} stroke={color + '40'} strokeWidth="1" />
      <text x={x} y={y + 4} textAnchor="middle" fontSize="7.5" fill={color}>{label}</text>
    </g>
  )
}

// ── Main schematic ─────────────────────────────────────────────────────────────

export default function SystemSchematic() {
  const { systems } = useContext(ProjectContext)

  const isIdeal    = systems.mode !== 'detailed'
  const isMVHR     = systems.ventilation_type?.startsWith('mvhr')
  const isGasBoiler = systems.dhw_primary === 'gas_boiler_dhw'
  const hasASHP    = systems.dhw_preheat === 'ashp_dhw'
  const hasNatVent = systems.natural_ventilation

  const hvacLabel   = systems.hvac_type?.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase()) ?? 'VRF'
  const ventLabel   = isMVHR ? 'MVHR' : 'MEV'
  const dhwLabel    = isGasBoiler ? 'Gas Boiler' : 'Electric DHW'
  const copLabel    = `COP ${systems.cop_heating ?? 3.5}`
  const hreLabel    = isMVHR ? `${systems.hre_override ?? 85}% recovery` : 'Extract only'

  const W = 560
  const H = 300

  return (
    <div className="w-full h-full flex flex-col bg-white">
      <div className="px-4 pt-3 pb-2 border-b border-light-grey flex items-center justify-between">
        <div>
          <p className="text-caption font-medium text-navy">System Schematic</p>
          <p className="text-xxs text-mid-grey">Energy flow through building systems</p>
        </div>
        <div className="flex gap-2">
          <span className={`text-xxs px-2 py-0.5 rounded border ${
            isIdeal
              ? 'bg-amber-50 text-amber-700 border-amber-200'
              : 'bg-teal/10 text-teal border-teal/30'
          }`}>
            {isIdeal ? 'Ideal Loads' : 'Detailed'}
          </span>
          {isMVHR && (
            <span className="text-xxs px-2 py-0.5 rounded bg-cyan-50 text-cyan-700 border border-cyan-200">
              MVHR
            </span>
          )}
        </div>
      </div>

      <div className="flex-1 flex items-center justify-center p-4">
        <svg width="100%" height="100%" viewBox={`0 0 ${W} ${H}`} style={{ maxHeight: 280 }}>

          {/* ── Energy inputs (left) ── */}
          <InputNode x={50} y={80}  label="Grid" color="#ECB01F" />
          {isGasBoiler && <InputNode x={50} y={200} label="Gas"  color="#DC2626" />}

          {/* ── System boxes (centre) ── */}
          {/* HVAC / VRF */}
          <SystemBox
            x={150} y={50} w={120} h={60}
            label={isIdeal ? 'Ideal Loads' : hvacLabel}
            sublabel={isIdeal ? '100% efficient' : copLabel}
            color="#00AEEF"
            icon=""
          />

          {/* Ventilation */}
          <SystemBox
            x={150} y={130} w={120} h={50}
            label={ventLabel}
            sublabel={hreLabel}
            color="#06B6D4"
            icon=""
          />

          {/* DHW */}
          <SystemBox
            x={150} y={200} w={120} h={50}
            label={dhwLabel}
            sublabel={hasASHP ? '+ ASHP preheat' : null}
            color="#F97316"
            icon=""
          />

          {/* Lighting */}
          <SystemBox
            x={150} y={265} w={120} h={28}
            label="Lighting"
            sublabel={`${systems.lighting_power_density ?? 8} W/m²`}
            color="#F59E0B"
            icon=""
          />

          {/* ── Grid connections ── */}
          {/* Grid → HVAC */}
          <Arrow x1={68} y1={75} x2={150} y2={80} color="#ECB01F" width={2.5} />
          {/* Grid → Ventilation */}
          <Arrow x1={68} y1={85} x2={150} y2={155} color="#ECB01F" width={1.5} />
          {/* Grid → Lighting */}
          <Arrow x1={68} y1={90} x2={150} y2={279} color="#ECB01F" width={1.5} />

          {/* Gas → DHW (if gas boiler) */}
          {isGasBoiler && (
            <Arrow x1={68} y1={200} x2={150} y2={225} color="#DC2626" width={2} />
          )}
          {/* Grid → DHW (if electric or ASHP preheat) */}
          {(!isGasBoiler || hasASHP) && (
            <Arrow x1={68} y1={88} x2={150} y2={215} color="#ECB01F" width={1.5} />
          )}

          {/* ── Delivered energy (right) ── */}
          <OutputNode x={450} y={80}  label="Space heating" color="#DC2626" />
          <OutputNode x={450} y={115} label="Space cooling"  color="#3B82F6" />
          <OutputNode x={450} y={155} label="Fresh air"      color="#06B6D4" />
          <OutputNode x={450} y={225} label="Hot water"      color="#F97316" />
          <OutputNode x={450} y={279} label="Illumination"   color="#F59E0B" />

          {/* HVAC → Heating */}
          <Arrow x1={270} y1={75}  x2={422} y2={80}  color="#DC2626" width={2} />
          {/* HVAC → Cooling */}
          <Arrow x1={270} y1={90}  x2={422} y2={115} color="#3B82F6" width={1.5} />
          {/* Vent → Fresh air */}
          <Arrow x1={270} y1={155} x2={422} y2={155} color="#06B6D4" width={1.5} />
          {/* DHW → Hot water */}
          <Arrow x1={270} y1={225} x2={422} y2={225} color="#F97316" width={2} />
          {/* Lighting → Illumination */}
          <Arrow x1={270} y1={279} x2={422} y2={279} color="#F59E0B" width={1.5} />

          {/* MVHR heat recovery loop */}
          {isMVHR && (
            <g>
              <path
                d="M 270 145 Q 330 120 270 80"
                fill="none" stroke="#06B6D4" strokeWidth="1.5" strokeDasharray="4 2"
              />
              <text x={335} y={115} fontSize="7" fill="#06B6D4">heat recovery</text>
            </g>
          )}

          {/* Natural vent indicator */}
          {hasNatVent && (
            <g>
              <text x={360} y={105} fontSize="7" fill="#16A34A">+ nat. vent</text>
            </g>
          )}

        </svg>
      </div>

      {/* Legend note */}
      <div className="px-4 pb-3">
        <p className="text-xxs text-mid-grey">
          {isIdeal
            ? 'Ideal Loads mode — system losses not applied. Switch to Detailed for real COP/EER.'
            : `Detailed mode — VRF COP applied. ${isMVHR ? 'MVHR recovers heat from exhaust air.' : 'MEV extract only — no heat recovery.'}`
          }
        </p>
      </div>
    </div>
  )
}
