/**
 * FabricSankey.jsx
 *
 * Live Sankey diagram for the Building module centre column.
 * Shows the thermal energy balance through the building fabric,
 * updating in real time as inputs change.
 *
 * Layout:
 *   Left  — Gain sources (solar by facade + internal gains)
 *   Centre — "Building Thermal Balance" node
 *   Right  — Fabric losses + Heating demand + Cooling demand
 *
 * Data comes from the hourly instantCalc result passed as a prop.
 */

import { useRef, useEffect, useState, useMemo, useCallback } from 'react'
import { sankey, sankeyLeft, sankeyLinkHorizontal } from 'd3-sankey'

// ── Colour palette ─────────────────────────────────────────────────────────────

const GAIN_COLORS = {
  solar_s:    '#D97706',   // deep amber — south
  solar_e:    '#F59E0B',   // amber      — east
  solar_w:    '#F59E0B',   // amber      — west
  solar_n:    '#FCD34D',   // pale amber — north
  solar_opq:  '#FEF3C7',   // very pale  — opaque surfaces
  people:     '#7C3AED',   // violet
  equipment:  '#8B5CF6',   // purple
  lighting:   '#A78BFA',   // lavender
}

const LOSS_COLORS = {
  loss_walls:  '#6B7280',   // slate
  loss_glaz:   '#4B5563',   // darker slate
  loss_roof:   '#9CA3AF',   // grey
  loss_floor:  '#D1D5DB',   // light grey
  loss_infil:  '#9CA3AF',   // grey
  loss_vent:   '#D1D5DB',   // light grey
  demand_heat: '#DC2626',   // red — heating demand
  demand_cool: '#2563EB',   // blue — cooling demand
  building:    '#0F172A',   // dark navy — centre node
}

function nodeColor(id) {
  return GAIN_COLORS[id] ?? LOSS_COLORS[id] ?? '#94A3B8'
}

function linkColor(id) {
  // Link color = source node color for gain links, else target color for losses
  return GAIN_COLORS[id] ?? LOSS_COLORS[id] ?? '#CBD5E1'
}

// ── Facade label helper (mirrors BuildingViewer3D) ────────────────────────────
// F1=north (0°), F2=east (90°), F3=south (180°), F4=west (270°)
function facadeLabel(num, orientationDeg) {
  const baseAngles = { 1: 0, 2: 90, 3: 180, 4: 270 }
  const trueAngle  = (baseAngles[num] + (orientationDeg ?? 0)) % 360
  const dirs = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW']
  return `F${num} (${dirs[Math.round(trueAngle / 45) % 8]})`
}

// ── Build Sankey data from instantCalc result ─────────────────────────────────

function buildFabricSankeyData(result, orientationDeg = 0) {
  if (!result) return null

  const sg = result.solar_gains    ?? {}
  const ig = result.internal_gains ?? {}
  const fl = result.fabric_losses  ?? {}
  const heating_kWh = result.annual_heating_kWh ?? 0
  const cooling_kWh = result.annual_cooling_kWh ?? 0

  const totalGains = (sg.total_kWh ?? 0) + (ig.total_kWh ?? 0)
  if (totalGains < 1) return null

  const nodes = []
  const links = []
  const addNode = (id, label, type) => nodes.push({ id, label, type })
  const addLink = (source, target, value, colorId) => {
    if (value > 1) links.push({ source, target, value: Math.round(value), colorId })
  }

  // ── Glazing solar gain nodes — labelled by facade number + dynamic compass ─
  const fl3 = facadeLabel(3, orientationDeg)  // south face
  const fl2 = facadeLabel(2, orientationDeg)  // east face
  const fl4 = facadeLabel(4, orientationDeg)  // west face
  const fl1 = facadeLabel(1, orientationDeg)  // north face
  if ((sg.south_kWh ?? 0) > 1) addNode('solar_f3', `Glazing ${fl3}`, 'gain')
  if ((sg.east_kWh  ?? 0) > 1) addNode('solar_f2', `Glazing ${fl2}`, 'gain')
  if ((sg.west_kWh  ?? 0) > 1) addNode('solar_f4', `Glazing ${fl4}`, 'gain')
  if ((sg.north_kWh ?? 0) > 1) addNode('solar_f1', `Glazing ${fl1}`, 'gain')

  // ── Opaque solar: split into wall and roof ────────────────────────────────
  if ((sg.opaque_wall_kWh ?? 0) > 1) addNode('wall_solar', 'Wall Solar',  'gain')
  if ((sg.roof_solar_kWh  ?? 0) > 1) addNode('roof_solar', 'Roof Solar',  'gain')

  // ── Internal gain nodes ───────────────────────────────────────────────────
  if ((ig.people_kWh    ?? 0) > 1) addNode('people',    'Occupants', 'gain')
  if ((ig.equipment_kWh ?? 0) > 1) addNode('equipment', 'Equipment', 'gain')
  if ((ig.lighting_kWh  ?? 0) > 1) addNode('lighting',  'Lighting',  'gain')

  // ── Centre node ───────────────────────────────────────────────────────────
  addNode('building', 'Building', 'building')

  // ── Loss + demand sink nodes (right) ─────────────────────────────────────
  if ((fl.walls_kWh        ?? 0) > 1) addNode('loss_walls', 'Walls',        'loss')
  if ((fl.glazing_kWh      ?? 0) > 1) addNode('loss_glaz',  'Glazing',      'loss')
  if ((fl.roof_kWh         ?? 0) > 1) addNode('loss_roof',  'Roof',         'loss')
  if ((fl.floor_kWh        ?? 0) > 1) addNode('loss_floor', 'Floor',        'loss')
  if ((fl.infiltration_kWh ?? 0) > 1) addNode('loss_infil', 'Infiltration', 'loss')
  if ((fl.ventilation_kWh  ?? 0) > 1) addNode('loss_vent',  'Ventilation',  'loss')
  if (heating_kWh > 1) addNode('demand_heat', 'Heating Demand', 'demand_heat')
  if (cooling_kWh > 1) addNode('demand_cool', 'Cooling Demand', 'demand_cool')

  // ── Gain links (sources → building) ──────────────────────────────────────
  addLink('solar_f3',   'building', sg.south_kWh      ?? 0, 'solar_s')
  addLink('solar_f2',   'building', sg.east_kWh       ?? 0, 'solar_e')
  addLink('solar_f4',   'building', sg.west_kWh       ?? 0, 'solar_w')
  addLink('solar_f1',   'building', sg.north_kWh      ?? 0, 'solar_n')
  addLink('wall_solar', 'building', sg.opaque_wall_kWh ?? 0, 'solar_opq')
  addLink('roof_solar', 'building', sg.roof_solar_kWh  ?? 0, 'solar_opq')
  addLink('people',    'building', ig.people_kWh     ?? 0, 'people')
  addLink('equipment', 'building', ig.equipment_kWh  ?? 0, 'equipment')
  addLink('lighting',  'building', ig.lighting_kWh   ?? 0, 'lighting')

  // ── Loss links (building → sinks) ────────────────────────────────────────
  addLink('building', 'loss_walls',  fl.walls_kWh        ?? 0, 'loss_walls')
  addLink('building', 'loss_glaz',   fl.glazing_kWh      ?? 0, 'loss_glaz')
  addLink('building', 'loss_roof',   fl.roof_kWh         ?? 0, 'loss_roof')
  addLink('building', 'loss_floor',  fl.floor_kWh        ?? 0, 'loss_floor')
  addLink('building', 'loss_infil',  fl.infiltration_kWh ?? 0, 'loss_infil')
  addLink('building', 'loss_vent',   fl.ventilation_kWh  ?? 0, 'loss_vent')
  addLink('building', 'demand_heat', heating_kWh,              'demand_heat')
  addLink('building', 'demand_cool', cooling_kWh,              'demand_cool')

  if (links.length === 0) return null
  return { nodes, links }
}

// ── Format kWh/MWh display ────────────────────────────────────────────────────

function fmtMWh(kWh) {
  if (!kWh) return '0 kWh'
  if (kWh >= 1000) return `${(kWh / 1000).toFixed(1)} MWh`
  return `${Math.round(kWh)} kWh`
}

// ── Node type → box style ─────────────────────────────────────────────────────

function nodeStyle(type) {
  switch (type) {
    case 'gain':        return { bg: '#FFFBEB', border: '#F59E0B', text: '#92400E' }
    case 'building':    return { bg: '#EFF6FF', border: '#1D4ED8', text: '#1E3A8A' }
    case 'loss':        return { bg: '#F9FAFB', border: '#9CA3AF', text: '#374151' }
    case 'demand_heat': return { bg: '#FEF2F2', border: '#DC2626', text: '#991B1B' }
    case 'demand_cool': return { bg: '#EFF6FF', border: '#2563EB', text: '#1E40AF' }
    default:            return { bg: '#F9FAFB', border: '#D1D5DB', text: '#374151' }
  }
}

// ── Main component ─────────────────────────────────────────────────────────────

export default function FabricSankey({ result, orientation = 0 }) {
  const containerRef = useRef(null)
  const [dims, setDims]     = useState({ width: 600, height: 460 })
  const [tooltip, setTooltip] = useState(null)
  const [hoveredId, setHoveredId] = useState(null)   // node id or link index key

  // ResizeObserver
  useEffect(() => {
    if (!containerRef.current) return
    const ro = new ResizeObserver(entries => {
      const { width, height } = entries[0].contentRect
      setDims({ width: Math.max(300, width), height: Math.max(200, height) })
    })
    ro.observe(containerRef.current)
    return () => ro.disconnect()
  }, [])

  const fabricData = useMemo(() => buildFabricSankeyData(result, orientation), [result, orientation])

  const sankeyResult = useMemo(() => {
    if (!fabricData) return null
    const leftPad  = 90   // wide enough for longest left-side label ("Solar Opaque")
    const rightPad = 16   // right nodes extend further; the -80 margin handles right labels
    const topPad   = 16
    const nodeW = 16
    const nodeP = 12
    const g = {
      nodes: fabricData.nodes.map(n => ({ ...n })),
      links: fabricData.links.map(l => ({ ...l })),
    }
    try {
      const layout = sankey()
        .nodeId(d => d.id)
        .nodeAlign(sankeyLeft)
        .nodeWidth(nodeW)
        .nodePadding(nodeP)
        .extent([[leftPad, topPad], [dims.width - rightPad - 80, dims.height - topPad]])
      layout(g)
      return g
    } catch (e) {
      console.warn('[FabricSankey] layout error:', e)
      return null
    }
  }, [fabricData, dims])

  const linkPath = sankeyLinkHorizontal()

  // ── Hover handlers ─────────────────────────────────────────────────────────
  const handleNodeEnter = useCallback((e, node) => {
    const rect = containerRef.current?.getBoundingClientRect() ?? { left: 0, top: 0 }
    const inFlow  = sankeyResult?.links.filter(l => (l.target?.id ?? l.target) === node.id)
                      .reduce((s, l) => s + (l.value ?? 0), 0) ?? 0
    const outFlow = sankeyResult?.links.filter(l => (l.source?.id ?? l.source) === node.id)
                      .reduce((s, l) => s + (l.value ?? 0), 0) ?? 0
    setTooltip({ x: e.clientX - rect.left, y: e.clientY - rect.top, node, inFlow, outFlow })
    setHoveredId(node.id)
  }, [sankeyResult])

  const handleNodeLeave = useCallback(() => { setTooltip(null); setHoveredId(null) }, [])

  const handleLinkEnter = useCallback((e, link) => {
    const rect = containerRef.current?.getBoundingClientRect() ?? { left: 0, top: 0 }
    const srcLabel = (link.source?.label ?? link.source) ?? '?'
    const tgtLabel = (link.target?.label ?? link.target) ?? '?'
    setTooltip({ x: e.clientX - rect.left, y: e.clientY - rect.top, link, srcLabel, tgtLabel })
    setHoveredId(`link-${srcLabel}-${tgtLabel}`)
  }, [])

  const handleLinkLeave = useCallback(() => { setTooltip(null); setHoveredId(null) }, [])

  // ── Empty / loading state ──────────────────────────────────────────────────
  if (!result) {
    return (
      <div ref={containerRef} className="w-full h-full flex items-center justify-center">
        <p className="text-xxs text-mid-grey">Loading energy data…</p>
      </div>
    )
  }

  if (!sankeyResult) {
    return (
      <div ref={containerRef} className="w-full h-full flex items-center justify-center">
        <p className="text-xxs text-mid-grey">Energy flow data not available</p>
      </div>
    )
  }

  const totalGains = (result.solar_gains?.total_kWh ?? 0) + (result.internal_gains?.total_kWh ?? 0)
  const totalLosses = result.fabric_losses?.total_kWh ?? 0

  return (
    <div ref={containerRef} className="relative w-full h-full bg-white">
      <svg width={dims.width} height={dims.height} className="overflow-visible">
        <defs>
          <style>{`
            @keyframes fs-fade { from { opacity: 0 } to { opacity: 1 } }
            .fs-enter { animation: fs-fade 250ms ease forwards; }
          `}</style>
        </defs>

        {/* Links */}
        {sankeyResult.links.map((link, i) => {
          const srcId = link.source?.id ?? link.source
          const tgtId = link.target?.id ?? link.target
          const color = linkColor(srcId)
          const strokeW = Math.max(1, link.width ?? 2)
          const hitW = Math.max(10, strokeW + 6)
          const d = linkPath(link)
          const isHovered = hoveredId === `link-${link.source?.label ?? srcId}-${link.target?.label ?? tgtId}`
          const nodeHovered = hoveredId && hoveredId !== `link-${link.source?.label ?? srcId}-${link.target?.label ?? tgtId}`
          const dimmed = nodeHovered && hoveredId !== srcId && hoveredId !== tgtId

          return (
            <g key={`${srcId}-${tgtId}`} className="fs-enter">
              <path
                d={d}
                fill="none"
                stroke={color}
                strokeWidth={strokeW}
                strokeOpacity={dimmed ? 0.08 : isHovered ? 0.85 : 0.45}
                style={{ transition: 'stroke-opacity 250ms ease' }}
              />
              {/* Wide invisible hit area */}
              <path
                d={d}
                fill="none"
                stroke="transparent"
                strokeWidth={hitW}
                style={{ cursor: 'crosshair' }}
                onMouseEnter={e => handleLinkEnter(e, link)}
                onMouseLeave={handleLinkLeave}
              />
            </g>
          )
        })}

        {/* Nodes */}
        {sankeyResult.nodes.map(node => {
          const style = nodeStyle(node.type)
          const isHov = hoveredId === node.id
          const dimmed = hoveredId && hoveredId !== node.id && !hoveredId.startsWith('link-')
          const opacity = dimmed ? 0.35 : 1

          return (
            <g
              key={node.id}
              className="fs-enter"
              style={{ opacity, transition: 'opacity 250ms ease', cursor: 'pointer' }}
              onMouseEnter={e => handleNodeEnter(e, node)}
              onMouseLeave={handleNodeLeave}
            >
              <rect
                x={node.x0}
                y={node.y0}
                width={node.x1 - node.x0}
                height={Math.max(1, node.y1 - node.y0)}
                fill={nodeColor(node.id)}
                rx={2}
                stroke={isHov ? '#334155' : nodeColor(node.id)}
                strokeWidth={isHov ? 1.5 : 0}
              />
              {/* Label — left of left nodes, right of right nodes, centred for building */}
              {node.type === 'building' ? (
                <text
                  x={(node.x0 + node.x1) / 2}
                  y={node.y0 - 4}
                  textAnchor="middle"
                  fill={style.text}
                  fontSize={9}
                  fontWeight={600}
                >
                  Building
                </text>
              ) : node.x0 < dims.width / 2 ? (
                <text
                  x={node.x0 - 4}
                  y={(node.y0 + node.y1) / 2}
                  textAnchor="end"
                  dominantBaseline="middle"
                  fill={style.text}
                  fontSize={9}
                >
                  {node.label}
                </text>
              ) : (
                <text
                  x={node.x1 + 4}
                  y={(node.y0 + node.y1) / 2}
                  textAnchor="start"
                  dominantBaseline="middle"
                  fill={style.text}
                  fontSize={9}
                >
                  {node.label}
                </text>
              )}
            </g>
          )
        })}
      </svg>

      {/* Footer summary */}
      <div className="absolute bottom-1 left-0 right-0 flex justify-center gap-4 text-xxs text-mid-grey pointer-events-none">
        <span>Gains: <strong className="text-amber-700">{fmtMWh(totalGains)}</strong></span>
        <span>·</span>
        <span>Losses: <strong className="text-slate-600">{fmtMWh(totalLosses)}</strong></span>
        <span>·</span>
        <span>Heating: <strong className="text-red-600">{fmtMWh(result.annual_heating_kWh)}</strong></span>
        <span>·</span>
        <span>Cooling: <strong className="text-blue-600">{fmtMWh(result.annual_cooling_kWh)}</strong></span>
      </div>

      {/* Tooltip */}
      {tooltip && (
        <div
          className="absolute z-50 bg-navy text-white text-xxs rounded px-2 py-1.5 shadow-lg pointer-events-none"
          style={{
            left: Math.min(tooltip.x + 10, dims.width - 160),
            top:  Math.max(tooltip.y - 40, 4),
            maxWidth: 160,
          }}
        >
          {tooltip.node ? (
            <>
              <div className="font-semibold mb-0.5">{tooltip.node.label}</div>
              {tooltip.inFlow  > 0 && <div>In:  {fmtMWh(tooltip.inFlow)}</div>}
              {tooltip.outFlow > 0 && <div>Out: {fmtMWh(tooltip.outFlow)}</div>}
              {tooltip.node.id === 'building' && (
                <div className="mt-0.5 text-mid-grey">
                  Net balance: {fmtMWh(Math.abs(totalGains - totalLosses))}
                </div>
              )}
            </>
          ) : tooltip.link ? (
            <>
              <div className="font-semibold truncate">{tooltip.srcLabel} → {tooltip.tgtLabel}</div>
              <div>{fmtMWh(tooltip.link.value)}</div>
            </>
          ) : null}
        </div>
      )}
    </div>
  )
}
