/**
 * BalanceSankey.jsx
 *
 * Sankey layout for the HeatBalance view. Reads the same `heat_balance`
 * data shape as the Rows and Stacked layouts, so numbers match across
 * all three views.
 *
 * Layout:
 *   Gain sources (left)  →  Building (centre)  →  Loss destinations (right)
 *     - Solar by orientation
 *     - Internal — people / equipment / lighting
 *     - Heating (mechanical input)
 *
 *   Building centre node
 *
 *     - External wall, Roof, Ground floor, Glazing  (fabric)
 *     - Infiltration, Ventilation                   (air exchange)
 *     - Cooling (mechanical removal)
 *
 * Colours use the canonical palette (data/balanceColours.js) so any
 * element keeps the same colour across Rows, Stacked, and Sankey.
 */

import { useEffect, useMemo, useRef, useState } from 'react'
import { sankey, sankeyLeft, sankeyLinkHorizontal } from 'd3-sankey'
import { colourForElement, LABELS } from '../../../data/balanceColours.js'
import { DEFAULT_MODE, gainOrderFor } from '../../../utils/stateMode.js'
import { solarLabel } from '../../../utils/facadeLabel.js'
import { TooltipPill, buildLossesMap, colourKeyForLossElement } from './HeatBalance.jsx'

const BUILDING_NODE_ID = '_zone'
const BUILDING_NODE_COLOUR = '#0F172A'   // dark navy

function fmt(value, unit) {
  if (value == null || isNaN(value)) return '—'
  if (unit === 'kwh_per_m2') return `${value.toFixed(1)} kWh/m²·a`
  if (Math.abs(value) >= 1000) return `${(value / 1000).toFixed(1)} MWh`
  return `${Math.round(value).toLocaleString()} kWh`
}

function readValue(node, unit) {
  if (!node) return 0
  return unit === 'kwh_per_m2' ? (node.kwh_per_m2 ?? 0) : (node.kwh ?? 0)
}

// ── Build Sankey graph from heat_balance ─────────────────────────────────────

// Brief 39 follow-up (2026-05-19): losses-side iteration is now driven by
// `buildLossesMap` (shared with HeatBalance's flattenLosses), so the Sankey,
// Rows, and Stacked views all see the same elements. Pre-factor the Sankey
// only iterated `loadOrderFor(mode)` and missed dynamically-appended keys
// like `natvent_<id>` (per-opening operable openings) and `ventilation_<name>`
// (per-system mech vent) — those vanished from the Sankey while staying
// visible in Rows + Stacked. Now all three layouts share one ordered key
// list and one losses map.
function buildGraph(data, unit, orientationDeg = 0, mode = DEFAULT_MODE, modules = null) {
  if (!data?.annual) return null
  const { gains } = data.annual

  const nodes = []
  const links = []
  const seen = new Set()
  const addNode = (id, label, colour) => {
    if (seen.has(id)) return
    seen.add(id)
    nodes.push({ id, label, colour })
  }
  const addLink = (source, target, value, colour) => {
    if (value > 0.001) links.push({ source, target, value, colour })
  }

  // ── Gains in (left) ──────────────────────────────────────────────────────
  // Filter by state-aware order so State 1 hides people/equipment/lighting/heating.
  const gainAllowed = new Set(gainOrderFor(mode))
  for (const face of ['south', 'east', 'west', 'north']) {
    if (!gainAllowed.has(`solar_${face}`)) continue
    const v = readValue(gains?.solar?.[face], unit)
    if (v > 0) {
      const id = `solar_${face}`
      addNode(id, solarLabel(face, orientationDeg), colourForElement(id))
      addLink(id, BUILDING_NODE_ID, v, colourForElement(id))
    }
  }
  for (const k of ['people', 'equipment', 'lighting']) {
    if (!gainAllowed.has(k)) continue
    const v = readValue(gains?.internal?.[k], unit)
    if (v > 0) {
      addNode(k, LABELS[k], colourForElement(k))
      addLink(k, BUILDING_NODE_ID, v, colourForElement(k))
    }
  }
  if (gainAllowed.has('heating')) {
    // Brief 28a Part 5 walkthrough Finding HB3 (2026-05-14): mirror the
    // synthetic-heating fallback used by HeatBalance.flattenGains at L324-352.
    // The engine emits `heat_balance.annual.gains.{solar,internal}` but not
    // `gains.heating` — heating is a system service, not a heat-balance gain
    // term per the engine's convention. Stacked / Rows views synthesise the
    // ribbon from `data.demand.heating_demand_mwh`; the Sankey was missing
    // that fallback, so the heating gain ribbon was dropped from the diagram
    // (visible in Stacked + Rows, invisible in Sankey — display parity gap
    // confirmed in Chris's walkthrough 2026-05-27).
    //
    // Source: `data.demand.heating_demand_mwh` (State 2 demand-at-comfort,
    // matches the same number Stacked uses). Falls through to the engine's
    // `gains.heating` block if it's ever emitted (forward compat with future
    // State 3 changes that surface heating directly on the gain side).
    const engineHeating = gains?.heating
    if (engineHeating?.kwh != null) {
      const heatV = readValue(engineHeating, unit)
      if (heatV > 0) {
        addNode('heating', LABELS.heating, colourForElement('heating'))
        addLink('heating', BUILDING_NODE_ID, heatV, colourForElement('heating'))
      }
    } else {
      const mwh = data?.demand?.heating_demand_mwh
      if (mwh != null && mwh > 0.01) {
        const kwh = mwh * 1000
        const gia = data?.metadata?.gia_m2 ?? 0
        const kwh_per_m2 = gia > 0 ? kwh / gia : 0
        const heatV = unit === 'kwh_per_m2' ? kwh_per_m2 : kwh
        if (heatV > 0) {
          addNode('heating', LABELS.heating, colourForElement('heating'))
          addLink('heating', BUILDING_NODE_ID, heatV, colourForElement('heating'))
        }
      }
    }
  }

  // ── Centre node ──────────────────────────────────────────────────────────
  addNode(BUILDING_NODE_ID, 'Zone', BUILDING_NODE_COLOUR)

  // ── Losses out (right) — driven by shared buildLossesMap ─────────────────
  const { orderedKeys, losses } = buildLossesMap(data, mode, modules)
  for (const k of orderedKeys) {
    const node = losses[k]
    if (!node) continue
    const v = readValue(node, unit)
    if (v <= 0) continue
    // Synthetic `_label` (per-system vent, per-opening natvent, cooling)
    // wins over the canonical LABELS table.
    const label = node._label ?? LABELS[k] ?? k
    const colour = colourForElement(colourKeyForLossElement(k))
    addNode(k, label, colour)
    addLink(BUILDING_NODE_ID, k, v, colour)
  }

  if (!links.length) return null
  return { nodes, links }
}

// ── Render ───────────────────────────────────────────────────────────────────

export default function BalanceSankey({ data, unit, orientationDeg = 0, onElementClick, mode = DEFAULT_MODE, modules = null }) {
  const containerRef = useRef(null)
  const [dims, setDims] = useState({ width: 720, height: 420 })
  const [hover, setHover] = useState(null)
  const [tip, setTip] = useState(null)   // {x, y, label, value}

  useEffect(() => {
    if (!containerRef.current) return
    const ro = new ResizeObserver(entries => {
      const { width, height } = entries[0].contentRect
      setDims({
        width:  Math.max(420, Math.floor(width)),
        height: Math.max(280, Math.floor(height)),
      })
    })
    ro.observe(containerRef.current)
    return () => ro.disconnect()
  }, [])

  const graph = useMemo(() => {
    const raw = buildGraph(data, unit, orientationDeg, mode, modules)
    if (!raw) return null
    try {
      const layout = sankey()
        .nodeId(n => n.id)
        .nodeWidth(14)
        .nodePadding(12)
        .nodeAlign(sankeyLeft)
        .extent([[140, 12], [dims.width - 140, dims.height - 12]])
      const cloned = {
        nodes: raw.nodes.map(n => ({ ...n })),
        links: raw.links.map(l => ({ ...l })),
      }
      layout(cloned)
      return cloned
    } catch (e) {
      return null
    }
  }, [data, unit, orientationDeg, dims, mode, modules])

  if (!graph) {
    return (
      <div className="h-full flex items-center justify-center text-xxs text-mid-grey">
        Not enough data to render the Sankey.
      </div>
    )
  }

  const linkPath = sankeyLinkHorizontal()

  return (
    <div ref={containerRef} className="w-full h-full min-h-[360px] relative">
      <svg width={dims.width} height={dims.height} className="block">
        {/* Links */}
        <g fill="none">
          {graph.links.map((l, i) => {
            const isHover = hover === `link-${i}`
            const isDim   = hover && !isHover && hover !== `node-${l.source.id}` && hover !== `node-${l.target.id}`
            return (
              <path
                key={i}
                d={linkPath(l)}
                stroke={l.colour}
                strokeWidth={Math.max(1, l.width)}
                strokeOpacity={isDim ? 0.18 : 0.55}
                onMouseEnter={() => setHover(`link-${i}`)}
                onMouseLeave={() => { setHover(null); setTip(null) }}
                onMouseMove={(e) => setTip({
                  x: e.clientX, y: e.clientY,
                  label: `${l.source.label} → ${l.target.label}`,
                  value: fmt(l.value, unit),
                })}
                style={{ transition: 'stroke-opacity 200ms', cursor: 'default' }}
              />
            )
          })}
        </g>

        {/* Nodes */}
        <g>
          {graph.nodes.map(n => {
            const isCenter = n.id === BUILDING_NODE_ID
            const isHover  = hover === `node-${n.id}`
            const isDim    = hover && !isHover && !isCenter
            const flow     = n.value ?? 0
            return (
              <g
                key={n.id}
                onMouseEnter={() => setHover(`node-${n.id}`)}
                onMouseLeave={() => { setHover(null); setTip(null) }}
                onMouseMove={(e) => setTip({
                  x: e.clientX, y: e.clientY,
                  label: n.label,
                  value: isCenter ? null : fmt(flow, unit),
                })}
                onClick={() => !isCenter && onElementClick?.(n.id)}
                style={{ cursor: isCenter ? 'default' : 'pointer' }}
              >
                <rect
                  x={n.x0}
                  y={n.y0}
                  width={Math.max(2, n.x1 - n.x0)}
                  height={Math.max(2, n.y1 - n.y0)}
                  fill={n.colour}
                  opacity={isDim ? 0.4 : 1}
                  style={{ transition: 'opacity 200ms' }}
                />
                <text
                  x={n.x0 < dims.width / 2 ? n.x0 - 8 : n.x1 + 8}
                  y={(n.y0 + n.y1) / 2}
                  textAnchor={n.x0 < dims.width / 2 ? 'end' : 'start'}
                  alignmentBaseline="middle"
                  fontSize="11"
                  fill={isCenter ? '#0F172A' : '#1F2937'}
                  fontWeight={isCenter ? 600 : 500}
                  opacity={isDim ? 0.4 : 1}
                  style={{ pointerEvents: 'none' }}
                >
                  {n.label}
                </text>
              </g>
            )
          })}
        </g>

        {/* IN / OUT headers removed — Bug fix (Chris reported 2026-05-17):
            these duplicated the HTML headers in HeatBalance.jsx's IN/OUT row
            (which is shared across Rows / Stacked / Sankey layouts). The
            shared header row carries the Σ totals badges per the same fix,
            so the Sankey body should be free of header chrome. */}
      </svg>
      {tip && <TooltipPill {...tip} />}
    </div>
  )
}
