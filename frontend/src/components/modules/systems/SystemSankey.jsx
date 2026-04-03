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
import { calculateInstant } from '../../../utils/instantCalc.js'

// ── Colour palette ────────────────────────────────────────────────────────────

const LINK_COLORS = {
  electricity: '#ECB01F',   // gold        — grid electricity
  gas:         '#E74C3C',   // orange-red  — gas
  heating:     '#DC2626',   // dark red    — space heating delivered
  cooling:     '#3B82F6',   // blue        — space cooling delivered
  dhw:         '#F97316',   // orange      — DHW delivered
  air:         '#06B6D4',   // cyan        — ventilation air
  waste:       '#D4D4D4',   // light grey  — heat rejection / flue loss (solid)
  recovered:   '#16A34A',   // green       — recovered / cascaded heat (dashed)
  default:     '#CCCCCC',
}

const NODE_COLORS = {
  source:    { bg: '#FEF9EE', border: '#ECB01F', text: '#92400E' },
  system:    { bg: '#EEF8FF', border: '#00AEEF', text: '#0C4A6E' },
  building:  { bg: '#FFF7ED', border: '#F97316', text: '#7C2D12' },  // warm orange — building thermal node
  end_use:   { bg: '#F0FDF4', border: '#16A34A', text: '#14532D' },
  waste:     { bg: '#F9FAFB', border: '#D4D4D4', text: '#6B7280' },  // light grey — waste nodes
  recovered: { bg: '#ECFDF5', border: '#16A34A', text: '#064E3B' },
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
  return { nodes: sNodes, links: sLinks }
}

// ── Format kWh as MWh ─────────────────────────────────────────────────────────

function fmtMWh(kWh) {
  if (kWh >= 1000) return `${(kWh / 1000).toFixed(1)} MWh`
  return `${Math.round(kWh)} kWh`
}

// ── Main component ────────────────────────────────────────────────────────────

export default function SystemSankey({ openSection, setOpenSection, libraryData = {} }) {
  const { params, constructions, systems } = useContext(ProjectContext)
  const containerRef = useRef(null)
  const [dims, setDims] = useState({ width: 600, height: 400 })
  const [tooltip, setTooltip] = useState(null)        // { x, y, node } | { x, y, link, srcLabel, tgtLabel }
  const [hoveredNodeId, setHoveredNodeId] = useState(null)
  const [hoveredLinkIdx, setHoveredLinkIdx] = useState(null)

  const result = useMemo(
    () => calculateInstant(params, constructions, systems, libraryData),
    [params, constructions, systems, libraryData]
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
      const layout = sankey()
        .nodeId(d => d.id)   // nodes use string id field; links reference nodes by id string
        .nodeAlign(sankeyLeft)
        .nodeWidth(nodeW)
        .nodePadding(nodeP)
        .extent([[pad, pad], [dims.width - pad - 90, dims.height - pad]])

      layout(g)
      return g
    } catch (e) {
      console.warn('[SystemSankey] layout error:', e)
      return null
    }
  }, [graph, dims])

  const linkPath = sankeyLinkHorizontal()

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
      <div ref={containerRef} className="flex-1 relative overflow-hidden">
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
            </defs>

            {/* ── Links ── */}
            {sankeyResult.links.map((link, i) => {
              const style  = link.style ?? 'default'
              const color  = LINK_COLORS[style] ?? LINK_COLORS.default
              const isRecovered = style === 'recovered'  // only recovered gets dashed; waste is solid
              const w = Math.max(1, link.width ?? 2)
              const srcId = typeof link.source === 'object' ? link.source.id : link.source
              const tgtId = typeof link.target === 'object' ? link.target.id : link.target

              // Determine highlight state from node hover OR link hover
              let isHighlighted = true
              if (hoveredNodeId) {
                isHighlighted = srcId === hoveredNodeId || tgtId === hoveredNodeId
              } else if (hoveredLinkIdx !== null) {
                isHighlighted = i === hoveredLinkIdx
              }

              const baseOpacity = isRecovered ? 0.7 : 0.45
              const anyHover = hoveredNodeId || hoveredLinkIdx !== null
              const opacity = anyHover
                ? (isHighlighted ? Math.min(baseOpacity + 0.35, 1) : 0.08)
                : baseOpacity
              const strokeW = isHighlighted && anyHover ? w * 1.2 : w

              const d = linkPath(link)
              return (
                <g key={i}>
                  <path
                    d={d}
                    fill="none"
                    stroke={color}
                    strokeWidth={strokeW}
                    strokeOpacity={opacity}
                    strokeDasharray={isRecovered ? '6 3' : undefined}
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
              const h  = Math.max(24, y1 - y0)
              const type = node.type ?? 'system'
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
                  key={i}
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
                    style={{ transition: 'fill 300ms ease' }}
                  />

                  {/* Label: right-side for sources/systems/building, left-side for end_use/waste */}
                  {type !== 'end_use' && type !== 'waste' ? (
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
