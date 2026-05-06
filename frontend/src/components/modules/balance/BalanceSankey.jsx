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

function buildGraph(data, unit) {
  if (!data?.annual) return null
  const { gains, losses } = data.annual

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
  // Solar by orientation
  for (const face of ['south', 'east', 'west', 'north']) {
    const v = readValue(gains?.solar?.[face], unit)
    if (v > 0) {
      const id = `solar_${face}`
      addNode(id, LABELS[id], colourForElement(id))
      addLink(id, BUILDING_NODE_ID, v, colourForElement(id))
    }
  }
  // Internal — people, equipment, lighting
  for (const k of ['people', 'equipment', 'lighting']) {
    const v = readValue(gains?.internal?.[k], unit)
    if (v > 0) {
      addNode(k, LABELS[k], colourForElement(k))
      addLink(k, BUILDING_NODE_ID, v, colourForElement(k))
    }
  }
  // Heating (mechanical input)
  const heatV = readValue(gains?.heating, unit)
  if (heatV > 0) {
    addNode('heating', LABELS.heating, colourForElement('heating'))
    addLink('heating', BUILDING_NODE_ID, heatV, colourForElement('heating'))
  }

  // ── Centre node ──────────────────────────────────────────────────────────
  addNode(BUILDING_NODE_ID, 'Zone', BUILDING_NODE_COLOUR)

  // ── Losses out (right) ───────────────────────────────────────────────────
  for (const k of ['external_wall', 'roof', 'ground_floor', 'glazing', 'infiltration', 'ventilation', 'cooling']) {
    const v = readValue(losses?.[k], unit)
    if (v > 0) {
      addNode(k, LABELS[k], colourForElement(k))
      addLink(BUILDING_NODE_ID, k, v, colourForElement(k))
    }
  }

  if (!links.length) return null
  return { nodes, links }
}

// ── Render ───────────────────────────────────────────────────────────────────

export default function BalanceSankey({ data, unit, onElementClick }) {
  const containerRef = useRef(null)
  const [dims, setDims] = useState({ width: 720, height: 420 })
  const [hover, setHover] = useState(null)

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
    const raw = buildGraph(data, unit)
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
  }, [data, unit, dims])

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
                onMouseLeave={() => setHover(null)}
                style={{ transition: 'stroke-opacity 200ms' }}
              >
                <title>
                  {l.source.label} → {l.target.label}: {fmt(l.value, unit)}
                </title>
              </path>
            )
          })}
        </g>

        {/* Nodes */}
        <g>
          {graph.nodes.map(n => {
            const isCenter = n.id === BUILDING_NODE_ID
            const isHover  = hover === `node-${n.id}`
            const isDim    = hover && !isHover && !isCenter
            return (
              <g
                key={n.id}
                onMouseEnter={() => setHover(`node-${n.id}`)}
                onMouseLeave={() => setHover(null)}
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

        {/* IN / OUT headers */}
        <g pointerEvents="none">
          <text x={20} y={20} fontSize="10" fontWeight={600} fill="#1F2937" letterSpacing="0.5">
            ↦ IN — Gains
          </text>
          <text x={dims.width - 20} y={20} textAnchor="end" fontSize="10" fontWeight={600} fill="#1F2937" letterSpacing="0.5">
            OUT — Losses ↦
          </text>
        </g>
      </svg>
    </div>
  )
}
