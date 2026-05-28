/**
 * SystemSankey.jsx
 *
 * Sankey-style flow diagram for the Systems module centre panel.
 * Auto-generates nodes and links from the systems_flow data produced by instantCalc.
 * Node IDs use prefixes (sh_ sc_ dhw_ dhw_sec_ vent_) so click-to-expand can
 * resolve the target accordion section without hardcoded system keys.
 *
 * Link styles:
 *   electricity → gold   gas → red   heating → dark-red   cooling → blue
 *   dhw → orange   air → cyan   waste → light-grey (solid)
 *   recovered → green (dashed)
 */

import { useContext, useRef, useEffect, useState, useMemo, useCallback } from 'react'
import { sankey, sankeyLeft, sankeyLinkHorizontal } from 'd3-sankey'
import { ProjectContext } from '../../../context/ProjectContext.jsx'
import { useWeather } from '../../../context/WeatherContext.jsx'
import { useHourlySolar } from '../../../hooks/useHourlySolar.js'
import { calculateInstant } from '../../../utils/instantCalc.js'
import ChartExportCard from '../../shared/ChartExportCard.jsx'

// ── Colour palette ────────────────────────────────────────────────────────────

const LINK_COLORS = {
  electricity: '#ECB01F',   // gold        — grid electricity
  gas:         '#E74C3C',   // orange-red  — gas
  heating:     '#DC2626',   // dark red    — space heating delivered
  cooling:     '#00AEEF',   // cyan-bright — space cooling delivered (Brief 37 Part 1: was '#3B82F6' blue-500)
  dhw:         '#EC4899',   // pink-500    — DHW delivered (Brief 37 Part 1: was '#F97316' orange-500)
  air:         '#14B8A6',   // teal-500    — ventilation air (Brief 37 Part 1: was '#06B6D4' cyan-500)
  waste:       '#D4D4D4',   // light grey  — heat rejection / flue loss (solid)
  recovered:   '#16A34A',   // green       — recovered / cascaded heat (dashed)
  unserved:    '#EF4444',   // red-500     — demand with no system supplying it (Brief 38 Part 2; dotted)
  default:     '#CCCCCC',
}

const NODE_COLORS = {
  source:    { bg: '#FEF9EE', border: '#ECB01F', text: '#92400E' },
  system:    { bg: '#EEF8FF', border: '#00AEEF', text: '#0C4A6E' },
  building:  { bg: '#FFF7ED', border: '#F97316', text: '#7C2D12' },  // warm orange — building thermal node
  end_use:   { bg: '#F0FDF4', border: '#16A34A', text: '#14532D' },
  waste:     { bg: '#F9FAFB', border: '#D4D4D4', text: '#6B7280' },  // light grey — waste nodes
  recovered: { bg: '#ECFDF5', border: '#16A34A', text: '#064E3B' },
  unserved:  { bg: '#FAFAFA', border: '#D4D4D4', text: '#9CA3AF' },  // faint grey — placeholder for off-system (Brief 38 Part 2)
}

// ── Build Sankey graph from systems_flow ──────────────────────────────────────

function buildGraph(systemsFlow) {
  const { nodes, links } = systemsFlow
  if (!nodes?.length || !links?.length) return null

  const nodeIds = new Set(nodes.map(n => n.id))

  const sNodes = nodes.map(n => ({ ...n }))
  // Use string IDs in links (matched via nodeId accessor) — NOT integer indices
  const sLinks = links
    .filter(l => l.value_kWh > 0 && nodeIds.has(l.source) && nodeIds.has(l.target))
    .map(l => ({ source: l.source, target: l.target, value: l.value_kWh, style: l.style }))

  if (sLinks.length === 0) return null

  // Brief 38 Part 2 (2026-05-19): mark unserved system nodes.
  //
  // A "system" node is unserved when it has outgoing flow to a demand but no
  // incoming flow from any "source" node (Grid / Gas). This happens when a
  // service has `enabled: false` (Brief 28-IM IM-M4) — the engine still emits
  // the demand link (heating_thermal > 0) but skips the source→system fuel
  // link because heating_electricity / heating_gas are zero. Without this
  // intervention the unserved system gets bumped to column 0 by sankeyLeft
  // (no incoming) and renders as a long dark-red horizontal flow spanning
  // the whole diagram.
  //
  // Strategy: keep the system→demand link but flag it for 'unserved' styling
  // (red dotted), and tag the node itself so rendering can swap label to
  // "No system configured", apply faint-grey styling, and post-layout snap
  // the node's x-range to the same column as the served system nodes.
  const sourceIds = new Set(sNodes.filter(n => n.type === 'source').map(n => n.id))
  const systemNodesWithFuel = new Set(
    sLinks.filter(l => sourceIds.has(l.source)).map(l => l.target)
  )
  for (const node of sNodes) {
    if (node.type !== 'system') continue
    if (systemNodesWithFuel.has(node.id)) continue
    // Does this node actually have outgoing demand flow? (Skip system nodes
    // that are simply absent — e.g. cooling 'none' — those weren't emitted
    // anyway since the engine guards with value_kWh > 0.)
    const hasOutgoing = sLinks.some(l => l.source === node.id)
    if (!hasOutgoing) continue
    node._unserved = true
  }
  // Restyle the outgoing links from unserved system nodes as 'unserved'.
  for (const link of sLinks) {
    const srcNode = sNodes.find(n => n.id === link.source)
    if (srcNode?._unserved) link.style = 'unserved'
  }

  return { nodes: sNodes, links: sLinks }
}

// ── Format kWh as MWh ─────────────────────────────────────────────────────────

function fmtMWh(kWh) {
  if (kWh >= 1000) return `${(kWh / 1000).toFixed(1)} MWh`
  return `${Math.round(kWh)} kWh`
}

// ── Main component ────────────────────────────────────────────────────────────

export default function SystemSankey({ openSection, setOpenSection, libraryData = {} }) {
  const { params, constructions, systems, comfortBand } = useContext(ProjectContext)
  const { weatherData } = useWeather()
  const orientationDeg = Number(params?.orientation ?? 0)
  const hourlySolar = useHourlySolar(weatherData, orientationDeg)
  const containerRef = useRef(null)
  const [dims, setDims] = useState({ width: 600, height: 400 })
  const [tooltip, setTooltip] = useState(null)        // { x, y, node } | { x, y, link, srcLabel, tgtLabel }
  const [hoveredNodeId, setHoveredNodeId] = useState(null)
  const [hoveredLinkIdx, setHoveredLinkIdx] = useState(null)

  const result = useMemo(
    // Brief 44 Part 5d (2026-05-21): _skipInterventions per perf audit D.1.
    // Brief 58 A2 (2026-05-26): comfortBand required.
    () => calculateInstant(params, constructions, systems, libraryData, weatherData, hourlySolar, null, { comfortBand, _skipInterventions: true }),
    [params, constructions, systems, libraryData, weatherData, hourlySolar, comfortBand]
  )

  const systemsFlow = result.systems_flow
  const isIdeal = systems.mode !== 'detailed'
  // Read from demand-based structure, fall back to legacy flat keys
  const ventSys = systems.ventilation?.primary?.system ?? systems.ventilation_type ?? 'mev_standard'
  const dhwSec  = systems.dhw?.secondary?.system      ?? systems.dhw_preheat      ?? 'none'
  const isMVHR  = ventSys.startsWith('mvhr')
  const hasASHP = dhwSec && dhwSec !== 'none' && (dhwSec.includes('ashp') || dhwSec.includes('heat_pump'))

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

  // Build and render Sankey
  const graph = useMemo(() => buildGraph(systemsFlow), [systemsFlow])

  const sankeyResult = useMemo(() => {
    if (!graph) return null
    const { nodes, links } = graph
    const pad = 40
    const nodeW = 18
    const nodeP = 14

    // Deep copy to avoid mutation
    const g = {
      nodes: nodes.map(n => ({ ...n })),
      links: links.map(l => ({ ...l })),
    }

    try {
      // 2026-05-28 (Chris-flag): .nodeSort(null) keeps nodes in the order
      // they were added in buildGraph so categorical groups stay together
      // and magnitudes are easy to compare by eye. Same discipline as
      // BalanceSankey (commit cc7cac4).
      const layout = sankey()
        .nodeId(d => d.id)   // nodes use string id field; links reference nodes by id string
        .nodeAlign(sankeyLeft)
        .nodeSort(null)
        .nodeWidth(nodeW)
        .nodePadding(nodeP)
        .extent([[pad, pad], [dims.width - pad - 90, dims.height - pad]])

      layout(g)

      // Brief 38 Part 1 (2026-05-19): post-process energy-carrier nodes.
      //
      // d3-sankey's column-balancing inflates source-type nodes (Grid
      // Electricity, Natural Gas) far beyond the visual width of the flows
      // leaving them. The cause: the carrier column has only 2 nodes whereas
      // the demand column has 10+, so d3-sankey gives each carrier roughly
      // half the column height even though individual outgoing links are
      // proportionally slim. The result is a visually-massive carrier block
      // with thin curves leaving it.
      //
      // Fix: for each source-type node, sum its OUTGOING link widths (the
      // links 'grid' / 'gas' are always source, never target — see
      // instantCalc.js _addLink calls), resize node.y0/y1 to span exactly
      // that height centred on the existing midpoint, then restack each
      // outgoing link's y0 contiguously inside the new range so the curves
      // emerge directly from the resized block.
      for (const node of g.nodes) {
        if (node.type !== 'source') continue
        const outgoing = g.links.filter(l =>
          (typeof l.source === 'object' ? l.source.id : l.source) === node.id
        )
        if (outgoing.length === 0) continue

        // Preserve the visual order d3-sankey assigned (by current source-end y).
        outgoing.sort((a, b) => (a.y0 ?? 0) - (b.y0 ?? 0))

        // Desired height = sum of link widths (links touch flush, matching
        // d3-sankey's contiguous-pack convention).
        const totalH = outgoing.reduce((s, l) => s + (l.width ?? 1), 0)
        const existingMid = ((node.y0 ?? 0) + (node.y1 ?? 0)) / 2
        const newY0 = existingMid - totalH / 2
        node.y0 = newY0
        node.y1 = existingMid + totalH / 2

        // Restack each outgoing link's source-end centre inside the new range.
        // link.y1 (target-end centre) is left untouched so the curve adjusts
        // naturally to its new origin.
        let cursor = newY0
        for (const l of outgoing) {
          const w = l.width ?? 1
          l.y0 = cursor + w / 2
          cursor += w
        }

        node._totalKwh = outgoing.reduce((s, l) => s + (l.value ?? 0), 0)
      }

      // Brief 38 Part 2 (2026-05-19): snap unserved system nodes back into
      // the served-system column. sankeyLeft put them in column 0 because
      // they have no incoming fuel link; force them to the median x-range of
      // the served system nodes so the rendered stub is short and lands
      // visually where a system would belong. If no served system nodes
      // exist (heating-only-and-off — degenerate), fall back to the midpoint
      // between the leftmost and rightmost nodes.
      const servedSysX = g.nodes
        .filter(n => n.type === 'system' && !n._unserved)
        .map(n => ({ x0: n.x0 ?? 0, x1: n.x1 ?? 0 }))
      let sysX0, sysX1
      if (servedSysX.length > 0) {
        sysX0 = servedSysX.reduce((s, n) => s + n.x0, 0) / servedSysX.length
        sysX1 = servedSysX.reduce((s, n) => s + n.x1, 0) / servedSysX.length
      } else {
        const allX0 = g.nodes.map(n => n.x0 ?? 0)
        const allX1 = g.nodes.map(n => n.x1 ?? 0)
        const minX = Math.min(...allX0)
        const maxX = Math.max(...allX1)
        sysX0 = minX + (maxX - minX) * 0.45
        sysX1 = sysX0 + 18
      }
      for (const node of g.nodes) {
        if (!node._unserved) continue

        // Snap x to the system column.
        const origX0 = node.x0 ?? 0
        const origX1 = node.x1 ?? origX0 + 18
        node.x0 = sysX0
        node.x1 = sysX1
        // Shrink the node's y-range so it doesn't dominate the demand column
        // visually — a small faint placeholder is the goal. Keep it centred
        // on the existing midpoint. Minimum 18 px so the label fits.
        const midY = ((node.y0 ?? 0) + (node.y1 ?? 0)) / 2
        const newH = 22
        node.y0 = midY - newH / 2
        node.y1 = midY + newH / 2

        // Update outgoing link source-end position: x is implied by node.x1,
        // but link.y0 should now be at the new node midpoint.
        for (const l of g.links) {
          const srcId = typeof l.source === 'object' ? l.source.id : l.source
          if (srcId === node.id) {
            l.y0 = midY
          }
        }

        // Tag for the renderer: relabel as "No system configured" and
        // change the visible node type to 'unserved' (used by NODE_COLORS).
        node._origLabel = node.label
        node.label      = 'No system configured'
        node.type       = 'unserved'
        // Mark for the curve-shortening renderer: avoid the previously-long
        // path through column 0 by also nudging the source-end x to the new
        // node's x1 — d3-sankey's path generator reads source.x1, target.x0
        // dynamically so this happens automatically once node.x1 is updated.
        // (No-op here — left as documentation of the chained effect.)
        void origX0; void origX1
      }

      return g
    } catch (e) {
      console.warn('[SystemSankey] layout error:', e)
      return null
    }
  }, [graph, dims])

  const linkPath = sankeyLinkHorizontal()

  // ── Topology-change animation generation ──────────────────────────────────
  // Increments whenever the set of node IDs changes (topology change, not just
  // value change). New topology generation → React remounts node/link <g>
  // elements via a changed key → CSS fadeIn animation fires on new elements.
  const animGenRef    = useRef(0)
  const prevNodeIdsRef = useRef('')
  const [animGen, setAnimGen] = useState(0)

  useEffect(() => {
    if (!sankeyResult) return
    const currentIds = sankeyResult.nodes.map(n => n.id).sort().join(',')
    if (currentIds !== prevNodeIdsRef.current) {
      prevNodeIdsRef.current = currentIds
      animGenRef.current += 1
      setAnimGen(animGenRef.current)
    }
  }, [sankeyResult])

  // ── Tooltip on node hover ──────────────────────────────────────────────────
  const handleNodeEnter = useCallback((e, node) => {
    const rect = containerRef.current?.getBoundingClientRect() ?? { left: 0, top: 0 }
    const x = e.clientX - rect.left
    const y = e.clientY - rect.top
    // Compute energy in/out for this node
    const inFlow  = sankeyResult?.links.filter(l => (typeof l.target === 'object' ? l.target.id : l.target) === node.id)
                      .reduce((s, l) => s + (l.value ?? 0), 0) ?? 0
    const outFlow = sankeyResult?.links.filter(l => (typeof l.source === 'object' ? l.source.id : l.source) === node.id)
                      .reduce((s, l) => s + (l.value ?? 0), 0) ?? 0
    setTooltip({ x, y, node, inFlow, outFlow })
    setHoveredNodeId(node.id)
    setHoveredLinkIdx(null)
  }, [sankeyResult])

  const handleNodeLeave = useCallback(() => {
    setTooltip(null)
    setHoveredNodeId(null)
  }, [])

  // ── Tooltip on link hover ──────────────────────────────────────────────────
  const handleLinkEnter = useCallback((e, link, idx) => {
    const rect = containerRef.current?.getBoundingClientRect() ?? { left: 0, top: 0 }
    const x = e.clientX - rect.left
    const y = e.clientY - rect.top
    const srcLabel = (typeof link.source === 'object' ? link.source.label : link.source) ?? link.source
    const tgtLabel = (typeof link.target === 'object' ? link.target.label : link.target) ?? link.target
    setTooltip({ x, y, link, srcLabel, tgtLabel })
    setHoveredLinkIdx(idx)
    setHoveredNodeId(null)
  }, [])

  const handleLinkLeave = useCallback(() => {
    setTooltip(null)
    setHoveredLinkIdx(null)
  }, [])

  // ── Click on node → expand demand accordion ──────────────────────────────
  // Node IDs from instantCalc use prefixes: sh_ sc_ dhw_ dhw_sec_ vent_
  // Legacy IDs (vrf, mvhr, boiler) are also handled for backward compat.
  const handleNodeClick = useCallback((node) => {
    if (!setOpenSection) return
    const id = node.id ?? ''
    let section = null
    if (id.startsWith('sh_'))      section = 'space_heating'
    else if (id.startsWith('sc_')) section = 'space_cooling'
    else if (id.startsWith('dhw_sec_')) section = 'dhw'
    else if (id.startsWith('dhw_'))    section = 'dhw'
    else if (id.startsWith('vent_'))   section = 'ventilation'
    else if (id === 'lighting')        section = 'lighting'
    else if (id === 'small_power')     section = 'smallpower'
    // Legacy fallbacks
    else if (id === 'vrf')    section = 'space_heating'
    else if (id === 'mvhr')   section = 'ventilation'
    else if (id === 'boiler') section = 'dhw'
    if (section) setOpenSection(section)
  }, [setOpenSection])

  // ── Badge list ────────────────────────────────────────────────────────────
  const badges = [
    { label: isIdeal ? 'Ideal Loads' : 'Detailed', color: isIdeal ? '#F59E0B' : '#00AEEF', bg: isIdeal ? '#FFFBEB' : '#EEF8FF' },
    isMVHR  ? { label: 'MVHR ✓',         color: '#16A34A', bg: '#ECFDF5' }
            : { label: 'MEV',             color: '#9CA3AF', bg: '#F9FAFB' },
    hasASHP ? { label: 'ASHP Preheat ✓', color: '#16A34A', bg: '#ECFDF5' } : null,
  ].filter(Boolean)

  return (
    <div className="w-full h-full flex flex-col bg-white select-none">
      {/* Header */}
      <div className="px-4 pt-3 pb-2 border-b border-light-grey flex items-center justify-between flex-shrink-0">
        <div>
          <p className="text-caption font-medium text-navy">Energy Flow — Systems</p>
          <p className="text-xxs text-mid-grey">Proportional energy flows · hover nodes for details · click to edit</p>
        </div>
        <div className="flex gap-1.5 flex-wrap justify-end">
          {badges.map(b => (
            <span key={b.label}
              className="text-xxs px-2 py-0.5 rounded border font-medium"
              style={{ color: b.color, backgroundColor: b.bg, borderColor: b.color + '40' }}
            >
              {b.label}
            </span>
          ))}
        </div>
      </div>

      {/* Sankey canvas */}
      <ChartExportCard noChrome title="Systems energy flow" className="flex-1 min-h-0">
      <div ref={containerRef} className="w-full h-full relative overflow-hidden">
        {!sankeyResult && (
          <div className="absolute inset-0 flex items-center justify-center text-xxs text-mid-grey">
            No energy flow data
          </div>
        )}

        {sankeyResult && (
          <svg width={dims.width} height={dims.height} style={{ display: 'block' }}>
            <defs>
              <marker id="arrowhead" markerWidth="6" markerHeight="4" refX="3" refY="2" orient="auto">
                <polygon points="0 0, 6 2, 0 4" fill="#CCCCCC" />
              </marker>
              <style>{`
                @keyframes sf-fade-in {
                  from { opacity: 0; }
                  to   { opacity: 1; }
                }
                .sf-node-enter {
                  animation: sf-fade-in 300ms ease forwards;
                }
                .sf-link-enter {
                  animation: sf-fade-in 300ms ease forwards;
                }
              `}</style>
            </defs>

            {/* ── Links ── */}
            {sankeyResult.links.map((link, i) => {
              const style  = link.style ?? 'default'
              const color  = LINK_COLORS[style] ?? LINK_COLORS.default
              const isRecovered = style === 'recovered'
              const isUnserved  = style === 'unserved'  // Brief 38 Part 2: red dotted stub for off-system demands
              const w = isUnserved
                ? 2  // unserved is a thin indicator stub, not a flow-proportional line
                : Math.max(1, link.width ?? 2)
              const srcId = typeof link.source === 'object' ? link.source.id : link.source
              const tgtId = typeof link.target === 'object' ? link.target.id : link.target

              // Determine highlight state from node hover OR link hover
              let isHighlighted = true
              if (hoveredNodeId) {
                isHighlighted = srcId === hoveredNodeId || tgtId === hoveredNodeId
              } else if (hoveredLinkIdx !== null) {
                isHighlighted = i === hoveredLinkIdx
              }

              const baseOpacity = isRecovered ? 0.7 : isUnserved ? 0.75 : 0.45
              const anyHover = hoveredNodeId || hoveredLinkIdx !== null
              const opacity = anyHover
                ? (isHighlighted ? Math.min(baseOpacity + 0.35, 1) : 0.08)
                : baseOpacity
              const strokeW = isHighlighted && anyHover ? w * 1.2 : w
              const dash    = isRecovered ? '6 3' : isUnserved ? '3 3' : undefined

              const d = linkPath(link)
              return (
                <g key={`${animGen}-${srcId}-${tgtId}`} className="sf-link-enter">
                  <path
                    d={d}
                    fill="none"
                    stroke={color}
                    strokeWidth={strokeW}
                    strokeOpacity={opacity}
                    strokeDasharray={dash}
                    style={{ transition: 'stroke-width 300ms ease, stroke-opacity 300ms ease' }}
                  />
                  {/* Invisible wider path for easier mouse targeting */}
                  <path
                    d={d}
                    fill="none"
                    stroke="transparent"
                    strokeWidth={Math.max(10, strokeW + 6)}
                    style={{ cursor: 'crosshair' }}
                    onMouseEnter={e => handleLinkEnter(e, link, i)}
                    onMouseLeave={handleLinkLeave}
                  />
                </g>
              )
            })}

            {/* ── Link labels (value) ── */}
            {sankeyResult.links.map((link, i) => {
              if (!link.width || link.width < 4) return null
              const mx = ((link.source.x1 ?? 0) + (link.target.x0 ?? 0)) / 2
              const my = ((link.y0 ?? 0) + (link.y1 ?? 0)) / 2
              return (
                <text key={`lbl-${i}`} x={mx} y={my} textAnchor="middle"
                  fontSize="7" fill="#6B7280" dy="0.35em">
                  {fmtMWh(link.value)}
                </text>
              )
            })}

            {/* ── Nodes ── */}
            {sankeyResult.nodes.map((node, i) => {
              const x0 = node.x0 ?? 0, x1 = node.x1 ?? x0 + 18
              const y0 = node.y0 ?? 0, y1 = node.y1 ?? y0 + 20
              const type = node.type ?? 'system'
              // Brief 38 Part 1: source-type nodes are post-processed to span
              // exactly their outgoing link-stack — bypass the 24-px min that
              // would re-inflate them and break the alignment with the curves.
              const h  = type === 'source' ? (y1 - y0) : Math.max(24, y1 - y0)
              const c  = NODE_COLORS[type] ?? NODE_COLORS.system
              const nid = node.id ?? ''
              const isClickable = nid.startsWith('sh_') || nid.startsWith('sc_') ||
                nid.startsWith('dhw_') || nid.startsWith('vent_') ||
                nid === 'lighting' || nid === 'small_power' ||
                // legacy IDs
                nid === 'vrf' || nid === 'mvhr' || nid === 'boiler'
              const labelX = x1 + 5
              const isNodeDimmed = (() => {
                if (hoveredNodeId) {
                  if (node.id === hoveredNodeId) return false
                  return !sankeyResult.links.some(l => {
                    const s = typeof l.source === 'object' ? l.source.id : l.source
                    const t = typeof l.target === 'object' ? l.target.id : l.target
                    return (s === hoveredNodeId && t === node.id) || (t === hoveredNodeId && s === node.id)
                  })
                }
                if (hoveredLinkIdx !== null) {
                  const hl = sankeyResult.links[hoveredLinkIdx]
                  if (!hl) return false
                  const hSrc = typeof hl.source === 'object' ? hl.source.id : hl.source
                  const hTgt = typeof hl.target === 'object' ? hl.target.id : hl.target
                  return node.id !== hSrc && node.id !== hTgt
                }
                return false
              })()

              return (
                <g
                  key={`${animGen}-${node.id}`}
                  className="sf-node-enter"
                  style={{ cursor: isClickable ? 'pointer' : 'default', opacity: isNodeDimmed ? 0.3 : 1, transition: 'opacity 300ms ease' }}
                  onClick={() => handleNodeClick(node)}
                  onMouseEnter={e => handleNodeEnter(e, node)}
                  onMouseLeave={handleNodeLeave}
                >
                  {/* Node rectangle */}
                  <rect
                    x={x0} y={y0} width={x1 - x0} height={h}
                    rx="3"
                    fill={c.bg}
                    stroke={c.border}
                    strokeWidth="1.5"
                    strokeDasharray={type === 'unserved' ? '3 2' : undefined}
                    style={{ transition: 'fill 300ms ease' }}
                  />

                  {/* Label: right-side for sources/systems/building, left-side for end_use/waste.
                      Brief 38 Part 1: source-type nodes (Grid Electricity / Natural
                      Gas) get a prominent two-line label — name + bold MWh total. */}
                  {type === 'source' && node._totalKwh != null ? (
                    <>
                      <text x={labelX} y={y0 + h / 2 - 9} fontSize="10"
                        fontWeight="500" fill={c.text} dy="0.35em">
                        {node.label.replace(/^(Grid |Natural )/, '')}
                      </text>
                      <text x={labelX} y={y0 + h / 2 + 9} fontSize="14"
                        fontWeight="700" fill={c.text} dy="0.35em">
                        {fmtMWh(node._totalKwh)}
                      </text>
                    </>
                  ) : type !== 'end_use' && type !== 'waste' ? (
                    <text x={labelX} y={y0 + h / 2 - (node.metric ? 5 : 0)} fontSize="8"
                      fontWeight="600" fill={c.text} dy="0.35em">
                      {node.label}
                    </text>
                  ) : (
                    <>
                      <text x={x0 - 4} y={y0 + h / 2 - (node.recovery_hint ? 4 : 0)} fontSize="8"
                        fontWeight="600" fill={c.text} textAnchor="end" dy="0.35em">
                        {node.label}
                      </text>
                      {/* Recovery possible indicator — small green ↻ badge on waste nodes */}
                      {node.recovery_hint && (
                        <text x={x0 - 4} y={y0 + h / 2 + 5} fontSize="6.5" fill="#16A34A"
                          textAnchor="end" fontStyle="italic">↻ recover</text>
                      )}
                    </>
                  )}

                  {/* Metric sublabel (system nodes) */}
                  {node.metric && (
                    <text x={labelX} y={y0 + h / 2 + 7} fontSize="7" fill="#6B7280">
                      {node.metric}
                    </text>
                  )}
                </g>
              )
            })}
          </svg>
        )}

        {/* Tooltip — node variant */}
        {tooltip?.node && (
          <div
            className="absolute pointer-events-none bg-white border border-light-grey rounded shadow-sm px-2 py-1.5 z-10"
            style={{ left: tooltip.x + 12, top: Math.max(4, tooltip.y - 40) }}
          >
            <p className="text-xxs font-semibold text-navy mb-0.5">{tooltip.node.label}</p>
            {tooltip.node.metric && (
              <p className="text-xxs text-teal mb-0.5">{tooltip.node.metric}</p>
            )}
            {tooltip.inFlow > 0 && (
              <p className="text-xxs text-mid-grey">In: {fmtMWh(tooltip.inFlow)}</p>
            )}
            {tooltip.outFlow > 0 && (
              <p className="text-xxs text-mid-grey">Out: {fmtMWh(tooltip.outFlow)}</p>
            )}
            {tooltip.inFlow > 0 && tooltip.outFlow > 0 && tooltip.inFlow < tooltip.outFlow && (
              <p className="text-xxs text-green-600">×{(tooltip.outFlow / tooltip.inFlow).toFixed(1)} multiplier (COP)</p>
            )}
            {tooltip.node.recovery_hint && (
              <p className="text-xxs text-green-700 mt-1 border-t border-green-100 pt-1">
                ↻ {tooltip.node.recovery_hint}
              </p>
            )}
            {(() => {
              const tid = tooltip.node.id ?? ''
              const showEdit = tid.startsWith('sh_') || tid.startsWith('sc_') ||
                tid.startsWith('dhw_') || tid.startsWith('vent_') ||
                tid === 'lighting' || tid === 'small_power' ||
                tid === 'vrf' || tid === 'mvhr' || tid === 'boiler'
              return showEdit ? <p className="text-xxs text-teal mt-0.5 italic">click to edit ↗</p> : null
            })()}
          </div>
        )}

        {/* Tooltip — link variant */}
        {tooltip?.link && (
          <div
            className="absolute pointer-events-none bg-white border border-light-grey rounded shadow-sm px-2 py-1.5 z-10"
            style={{ left: tooltip.x + 12, top: Math.max(4, tooltip.y - 40) }}
          >
            <p className="text-xxs font-semibold text-navy mb-0.5">
              {fmtMWh(tooltip.link.value ?? 0)}
            </p>
            <p className="text-xxs text-mid-grey">
              {tooltip.srcLabel} → {tooltip.tgtLabel}
            </p>
            {tooltip.link.style && tooltip.link.style !== 'default' && (
              <p className="text-xxs text-mid-grey capitalize">{tooltip.link.style}</p>
            )}
          </div>
        )}
      </div>
      </ChartExportCard>

      {/* Footer — energy balance */}
      <div className="px-4 py-2 border-t border-light-grey flex-shrink-0">
        <p className="text-xxs text-mid-grey">
          Total site energy:{' '}
          <span className="font-medium text-navy">{fmtMWh(result.fuel_split.total_kWh)}/yr</span>
          {' — '}
          <span style={{ color: '#ECB01F' }}>Electricity {result.fuel_split.electricity_pct}% · {fmtMWh(result.fuel_split.electricity_kWh)}</span>
          {result.fuel_split.gas_kWh > 0 && (
            <span style={{ color: '#E74C3C' }}> / Gas {result.fuel_split.gas_pct}% · {fmtMWh(result.fuel_split.gas_kWh)}</span>
          )}
        </p>
      </div>
    </div>
  )
}
