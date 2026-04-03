/**
 * ExpandedSankeyOverlay.jsx
 *
 * Full-width Sankey diagram overlay for the Building module.
 * Opens over the centre + right columns when user clicks ↗ on the butterfly chart.
 * Uses instant-calc result data (not EnergyPlus) — updates live with inputs.
 *
 * Energy balance shown:
 *   Left  → Building balance node → Right
 *   Inputs: Heating demand, Solar gains, Internal gains
 *   Outputs: Fabric losses (wall/glazing/roof/floor/infil/vent), Cooling demand
 */

import { useRef, useEffect } from 'react'
import { sankey, sankeyLinkHorizontal, sankeyLeft } from 'd3-sankey'

// ── Colour tokens ─────────────────────────────────────────────────────────────
const C = {
  heating:     '#DC2626',
  solar:       '#F59E0B',
  internal:    '#FB923C',
  building:    '#2B2A4C',
  wall:        '#A1887F',
  glazing:     '#4FC3F7',
  roof:        '#8D6E63',
  floor:       '#6D4C41',
  infil:       '#9E9E9E',
  vent:        '#06B6D4',
  cooling:     '#3B82F6',
}

// ── Build Sankey graph data from instant-calc result ──────────────────────────
function buildSankeyData(result) {
  const hs = result.gains_losses?.heating_side
  if (!hs) return null

  const heatingMWh  = result.annual_heating_kWh / 1000
  const coolingMWh  = result.annual_cooling_kWh / 1000

  // Solar gains (sum of all solar sources from heating side — already in MWh)
  const solarMWh = (hs.solar_south  ?? 0) + (hs.solar_east  ?? 0) +
                   (hs.solar_west   ?? 0) + (hs.solar_north ?? 0) +
                   (hs.wall_solar   ?? 0) + (hs.roof_solar  ?? 0)

  // Internal gains (equipment + lighting + people, heating side — MWh)
  const intMWh = (hs.equipment ?? 0) + (hs.lighting ?? 0) + (hs.people ?? 0)

  // Fabric losses (MWh)
  const wallMWh    = hs.wall_conduction    ?? 0
  const glazingMWh = hs.glazing_conduction ?? 0
  const roofMWh    = hs.roof_conduction    ?? 0
  const floorMWh   = hs.floor_conduction   ?? 0
  const infilMWh   = hs.infiltration       ?? 0
  const ventMWh    = hs.ventilation        ?? 0

  const MIN = 0.5  // MWh threshold to show a link

  // Node definitions
  const nodeList = [
    { id: 'heating_in',  label: 'Heating',       color: C.heating,   side: 'left'   },
    { id: 'solar_in',    label: 'Solar gains',   color: C.solar,     side: 'left'   },
    { id: 'int_in',      label: 'Internal gains',color: C.internal,  side: 'left'   },
    { id: 'building',    label: 'Building',      color: C.building,  side: 'centre' },
    { id: 'wall_out',    label: 'Walls',         color: C.wall,      side: 'right'  },
    { id: 'glazing_out', label: 'Glazing',       color: C.glazing,   side: 'right'  },
    { id: 'roof_out',    label: 'Roof',          color: C.roof,      side: 'right'  },
    { id: 'floor_out',   label: 'Floor',         color: C.floor,     side: 'right'  },
    { id: 'infil_out',   label: 'Infiltration',  color: C.infil,     side: 'right'  },
    { id: 'vent_out',    label: 'Ventilation',   color: C.vent,      side: 'right'  },
    { id: 'cooling_out', label: 'Cooling',       color: C.cooling,   side: 'right'  },
  ]

  const idx = {}
  nodeList.forEach((n, i) => { idx[n.id] = i })

  const linkList = []
  const addLink = (src, tgt, val) => {
    if (val < MIN) return
    linkList.push({ source: idx[src], target: idx[tgt], value: +val.toFixed(1) })
  }

  if (heatingMWh  > MIN) addLink('heating_in',  'building', heatingMWh)
  if (solarMWh    > MIN) addLink('solar_in',    'building', solarMWh)
  if (intMWh      > MIN) addLink('int_in',      'building', intMWh)
  if (wallMWh     > MIN) addLink('building', 'wall_out',    wallMWh)
  if (glazingMWh  > MIN) addLink('building', 'glazing_out', glazingMWh)
  if (roofMWh     > MIN) addLink('building', 'roof_out',    roofMWh)
  if (floorMWh    > MIN) addLink('building', 'floor_out',   floorMWh)
  if (infilMWh    > MIN) addLink('building', 'infil_out',   infilMWh)
  if (ventMWh     > MIN) addLink('building', 'vent_out',    ventMWh)
  if (coolingMWh  > MIN) addLink('building', 'cooling_out', coolingMWh)

  // Only include nodes that have at least one link
  const usedNodeIds = new Set()
  linkList.forEach(l => {
    usedNodeIds.add(nodeList[l.source].id)
    usedNodeIds.add(nodeList[l.target].id)
  })

  const filteredNodes = nodeList.filter(n => usedNodeIds.has(n.id))
  const reIdx = {}
  filteredNodes.forEach((n, i) => { reIdx[n.id] = i })
  const filteredLinks = linkList.map(l => ({
    source: reIdx[nodeList[l.source].id],
    target: reIdx[nodeList[l.target].id],
    value:  l.value,
  }))

  return { nodes: filteredNodes, links: filteredLinks }
}

// ── SVG Sankey renderer ───────────────────────────────────────────────────────
function SankeyChart({ result, width, height }) {
  const svgRef = useRef()

  useEffect(() => {
    if (!svgRef.current || !result) return
    const data = buildSankeyData(result)
    if (!data || data.links.length === 0) return

    const { nodes, links } = data
    const pad = { t: 20, r: 140, b: 20, l: 140 }
    const innerW = width  - pad.l - pad.r
    const innerH = height - pad.t - pad.b

    // Run d3-sankey layout
    const sankeyLayout = sankey()
      .nodeWidth(14)
      .nodePadding(16)
      .nodeAlign(sankeyLeft)
      .extent([[0, 0], [innerW, innerH]])

    const graph = sankeyLayout({
      nodes: nodes.map(d => ({ ...d })),
      links: links.map(d => ({ ...d })),
    })

    const svg = svgRef.current
    // Clear previous render
    while (svg.firstChild) svg.removeChild(svg.firstChild)

    const g = document.createElementNS('http://www.w3.org/2000/svg', 'g')
    g.setAttribute('transform', `translate(${pad.l},${pad.t})`)
    svg.appendChild(g)

    // Draw links
    graph.links.forEach(link => {
      const pathD = sankeyLinkHorizontal()(link)
      const path = document.createElementNS('http://www.w3.org/2000/svg', 'path')
      path.setAttribute('d', pathD)
      path.setAttribute('fill', 'none')
      path.setAttribute('stroke', link.source.color || '#AAAAAA')
      path.setAttribute('stroke-width', Math.max(1, link.width))
      path.setAttribute('stroke-opacity', '0.35')
      // Tooltip via title
      const title = document.createElementNS('http://www.w3.org/2000/svg', 'title')
      title.textContent = `${link.source.label} → ${link.target.label}: ${link.value.toFixed(1)} MWh/yr`
      path.appendChild(title)
      g.appendChild(path)
    })

    // Draw nodes
    graph.nodes.forEach(node => {
      const rect = document.createElementNS('http://www.w3.org/2000/svg', 'rect')
      rect.setAttribute('x', node.x0)
      rect.setAttribute('y', node.y0)
      rect.setAttribute('width', node.x1 - node.x0)
      rect.setAttribute('height', Math.max(2, node.y1 - node.y0))
      rect.setAttribute('fill', node.color || '#AAAAAA')
      rect.setAttribute('rx', '2')
      g.appendChild(rect)

      // Label: left side = right of node, right side = left of node, centre = above
      const isLeft   = node.x0 < innerW * 0.3
      const isRight  = node.x0 > innerW * 0.6
      const midY     = (node.y0 + node.y1) / 2
      const nodeH    = node.y1 - node.y0
      const valLabel = `${node.value?.toFixed(1) ?? ''} MWh`

      const text = document.createElementNS('http://www.w3.org/2000/svg', 'text')
      text.setAttribute('y', midY + 1)
      text.setAttribute('dy', '0.35em')
      text.setAttribute('font-size', '11')
      text.setAttribute('fill', '#444')
      text.setAttribute('font-family', 'sans-serif')

      if (isLeft) {
        text.setAttribute('x', node.x0 - 6)
        text.setAttribute('text-anchor', 'end')
        text.textContent = `${node.label}  ${valLabel}`
      } else if (isRight) {
        text.setAttribute('x', node.x1 + 6)
        text.setAttribute('text-anchor', 'start')
        text.textContent = `${node.label}  ${valLabel}`
      } else {
        // Centre node — label above
        text.setAttribute('x', (node.x0 + node.x1) / 2)
        text.setAttribute('y', node.y0 - 6)
        text.setAttribute('text-anchor', 'middle')
        text.setAttribute('font-weight', '600')
        text.setAttribute('fill', node.color)
        text.textContent = node.label
      }
      g.appendChild(text)
    })

  }, [result, width, height])

  return (
    <svg ref={svgRef} width={width} height={height} style={{ overflow: 'visible' }} />
  )
}

// ── Main overlay component ────────────────────────────────────────────────────
export default function ExpandedSankeyOverlay({ result, orientation, onClose }) {
  if (!result || !result.gains_losses) return null

  return (
    <div
      className="absolute inset-0 z-20 flex flex-col bg-white/97 backdrop-blur-sm"
      style={{ left: 0 }}
    >
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-2.5 border-b border-light-grey bg-white">
        <div>
          <p className="text-caption font-semibold text-navy">Energy Balance — Fabric Sankey</p>
          <p className="text-xxs text-mid-grey">Instant estimate · values in MWh/yr</p>
        </div>
        <button
          onClick={onClose}
          className="text-xxs px-2.5 py-1 rounded border border-light-grey text-mid-grey hover:bg-off-white transition-colors"
        >
          ✕ Close
        </button>
      </div>

      {/* Sankey chart area */}
      <div className="flex-1 flex items-center justify-center p-4">
        <SankeyChart
          result={result}
          width={700}
          height={420}
        />
      </div>

      {/* Legend row */}
      <div className="flex flex-wrap gap-x-4 gap-y-1 px-4 py-2.5 border-t border-light-grey bg-off-white">
        {[
          { label: 'Heating input', color: C.heating },
          { label: 'Solar gains',   color: C.solar },
          { label: 'Internal',      color: C.internal },
          { label: 'Walls',         color: C.wall },
          { label: 'Glazing',       color: C.glazing },
          { label: 'Roof',          color: C.roof },
          { label: 'Infiltration',  color: C.infil },
          { label: 'Ventilation',   color: C.vent },
          { label: 'Cooling',       color: C.cooling },
        ].map(({ label, color }) => (
          <div key={label} className="flex items-center gap-1">
            <div className="w-2.5 h-2.5 rounded-sm flex-shrink-0" style={{ backgroundColor: color }} />
            <span className="text-xxs text-dark-grey">{label}</span>
          </div>
        ))}
      </div>
    </div>
  )
}
