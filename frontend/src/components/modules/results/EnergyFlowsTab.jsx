import { useContext, useRef, useEffect, useState, useCallback } from 'react'
import { sankey, sankeyLinkHorizontal, sankeyJustify } from 'd3-sankey'
import { SimulationContext } from '../../../context/SimulationContext.jsx'
import ModuleEmptyState from '../../ui/ModuleEmptyState.jsx'
import { GitFork } from 'lucide-react'

/* ── Colour palette ──────────────────────────────────────────────────────────── */
const NODE_COLORS = {
  // Sources
  electricity:   '#ECB01F',
  solar:         '#FEF08A',
  internal_gains:'#FB923C',
  // Systems
  heating_sys:   '#DC2626',
  cooling_sys:   '#3B82F6',
  lighting_sys:  '#ECB01F',
  equipment_sys: '#8B5CF6',
  // Losses
  walls:         '#7C3AED',
  glazing_loss:  '#A78BFA',
  roof:          '#6B7280',
  ground_floor:  '#78350F',
  infiltration:  '#9CA3AF',
  ventilation:   '#06B6D4',
  // Delivered
  heating_del:   '#FCA5A5',
  cooling_del:   '#BAE6FD',
  lighting_del:  '#FEF08A',
  equipment_del: '#DDD6FE',
}

/* ── Build Sankey graph data from simulation results ─────────────────────────── */
function buildSankeyData(results) {
  const ae  = results.annual_energy    ?? {}
  const ed  = results.envelope_detailed ?? null
  const env = results.envelope          ?? {}

  const heating   = ae.heating_kWh   ?? 0
  const cooling   = ae.cooling_kWh   ?? 0
  const lighting  = ae.lighting_kWh  ?? 0
  const equipment = ae.equipment_kWh ?? 0
  const totalElec = heating + cooling + lighting + equipment

  const solarGain     = ed?.summary?.total_solar_gain_kWh   ?? env.solar_gain_kWh  ?? 0
  // Internal gains = occupancy heat + equipment waste heat (approx 70% of equipment as heat)
  const internalGains = equipment * 0.7

  // Fabric losses (from detailed if available)
  const wallLoss   = ed ? Object.values(ed.walls).reduce((s, v) => s + (v.annual_heat_loss_kWh ?? 0), 0) : 0
  const roofLoss   = ed?.roof?.annual_heat_loss_kWh   ?? 0
  const floorLoss  = ed?.ground_floor?.annual_heat_loss_kWh ?? 0
  const glazingLoss = ed ? Object.values(ed.glazing).reduce((s, v) => s + (v.conduction_kWh ?? 0), 0) : 0
  const infilLoss  = ed?.infiltration?.annual_heat_loss_kWh ?? env.infiltration_loss_kWh ?? 0

  // Filter out near-zero flows
  const MIN = 100  // kWh threshold to show a flow

  const nodes = []
  const links = []
  const nodeIdx = {}

  function addNode(id, label, color, x_hint) {
    nodeIdx[id] = nodes.length
    nodes.push({ id, label, color, x_hint })
  }

  function addLink(source, target, value) {
    if (value < MIN) return
    links.push({
      source: nodeIdx[source],
      target: nodeIdx[target],
      value: Math.round(value),
    })
  }

  // ── Source nodes (left)
  addNode('electricity',    'Grid electricity',  NODE_COLORS.electricity,    0)
  if (solarGain > MIN)
    addNode('solar',        'Solar gains',       NODE_COLORS.solar,          0)
  if (internalGains > MIN)
    addNode('internal',     'Internal gains',    NODE_COLORS.internal_gains, 0)

  // ── System nodes (middle)
  if (heating > MIN)    addNode('heating_sys',   'Heating',   NODE_COLORS.heating_sys,   1)
  if (cooling > MIN)    addNode('cooling_sys',   'Cooling',   NODE_COLORS.cooling_sys,   1)
  if (lighting > MIN)   addNode('lighting_sys',  'Lighting',  NODE_COLORS.lighting_sys,  1)
  if (equipment > MIN)  addNode('equipment_sys', 'Equipment', NODE_COLORS.equipment_sys, 1)

  // ── Loss/output nodes (right)
  if (heating > MIN)    addNode('heating_del',   'Heating delivered',   NODE_COLORS.heating_del,   2)
  if (cooling > MIN)    addNode('cooling_del',   'Cooling delivered',   NODE_COLORS.cooling_del,   2)
  if (lighting > MIN)   addNode('lighting_del',  'Lighting use',        NODE_COLORS.lighting_del,  2)
  if (equipment > MIN)  addNode('equipment_del', 'Equipment use',       NODE_COLORS.equipment_del, 2)
  if (wallLoss > MIN)   addNode('walls',         'Wall losses',         NODE_COLORS.walls,         2)
  if (roofLoss > MIN)   addNode('roof',          'Roof loss',           NODE_COLORS.roof,          2)
  if (floorLoss > MIN)  addNode('ground_floor',  'Floor loss',          NODE_COLORS.ground_floor,  2)
  if (infilLoss > MIN)  addNode('infiltration',  'Infiltration',        NODE_COLORS.infiltration,  2)
  if (solarGain > MIN)  addNode('solar_del',     'Solar delivered',     NODE_COLORS.solar,         2)

  // ── Source → System links
  addLink('electricity', 'heating_sys',   heating)
  addLink('electricity', 'cooling_sys',   cooling)
  addLink('electricity', 'lighting_sys',  lighting)
  addLink('electricity', 'equipment_sys', equipment)

  // ── System → Output links
  addLink('heating_sys',   'heating_del',   heating)
  addLink('cooling_sys',   'cooling_del',   cooling)
  addLink('lighting_sys',  'lighting_del',  lighting)
  addLink('equipment_sys', 'equipment_del', equipment)

  // ── Solar → output (solar goes to heating demand reduction + delivered)
  if (solarGain > MIN) addLink('solar', 'solar_del', solarGain)
  if (internalGains > MIN) addLink('internal', 'heating_del', internalGains)

  // ── Heat losses (from electricity input implicitly via building demand)
  addLink('heating_sys', 'walls',       wallLoss  > MIN ? wallLoss * 0.5 : 0)
  addLink('heating_sys', 'roof',        roofLoss  > MIN ? roofLoss  : 0)
  addLink('heating_sys', 'ground_floor',floorLoss > MIN ? floorLoss : 0)
  addLink('heating_sys', 'infiltration',infilLoss > MIN ? infilLoss * 0.7 : 0)

  return { nodes, links }
}

/* ── SVG Sankey component ─────────────────────────────────────────────────────── */
function SankeyChart({ data, width, height }) {
  const [tooltip, setTooltip] = useState(null)
  const [hoveredLink, setHoveredLink] = useState(null)
  const [hoveredNode, setHoveredNode] = useState(null)

  if (!data.nodes.length || !data.links.length) {
    return <p className="text-caption text-mid-grey text-center py-8">Insufficient data to render Sankey diagram.</p>
  }

  const PADDING = { top: 20, right: 140, bottom: 20, left: 10 }
  const innerW = width  - PADDING.left - PADDING.right
  const innerH = height - PADDING.top  - PADDING.bottom

  // Build Sankey layout
  const sankeyLayout = sankey()
    .nodeWidth(14)
    .nodePadding(12)
    .nodeAlign(sankeyJustify)
    .extent([[0, 0], [innerW, innerH]])

  let graph
  try {
    graph = sankeyLayout({
      nodes: data.nodes.map(d => ({ ...d })),
      links: data.links.map(d => ({ ...d })),
    })
  } catch (e) {
    return <p className="text-caption text-red-600 text-center py-8">Layout error: {e.message}</p>
  }

  const linkPath = sankeyLinkHorizontal()
  const total = graph.nodes.find(n => n.id === 'electricity')?.value ?? 1

  return (
    <svg width={width} height={height} style={{ fontFamily: 'inherit' }}>
      <g transform={`translate(${PADDING.left},${PADDING.top})`}>
        {/* Links */}
        {graph.links.map((link, i) => {
          const isHovered = hoveredLink === i
          const sourceNode = link.source
          const targetNode = link.target
          const srcColor = sourceNode.color ?? '#95A5A6'
          const pct = total > 0 ? ((link.value / total) * 100).toFixed(1) : '0'
          return (
            <path
              key={i}
              d={linkPath(link)}
              fill="none"
              stroke={srcColor}
              strokeWidth={Math.max(1, link.width)}
              strokeOpacity={isHovered ? 0.7 : 0.25}
              style={{ cursor: 'pointer', transition: 'stroke-opacity 0.15s' }}
              onMouseEnter={e => {
                setHoveredLink(i)
                setTooltip({
                  x: e.clientX,
                  y: e.clientY,
                  text: `${sourceNode.label} → ${targetNode.label}`,
                  value: link.value.toLocaleString(),
                  pct,
                })
              }}
              onMouseLeave={() => { setHoveredLink(null); setTooltip(null) }}
            />
          )
        })}

        {/* Nodes */}
        {graph.nodes.map((node, i) => {
          const isHovered = hoveredNode === i
          const nodeH = Math.max(4, node.y1 - node.y0)
          const color = node.color ?? '#95A5A6'
          return (
            <g
              key={i}
              style={{ cursor: 'pointer' }}
              onMouseEnter={e => {
                setHoveredNode(i)
                setTooltip({
                  x: e.clientX,
                  y: e.clientY,
                  text: node.label,
                  value: Math.round(node.value).toLocaleString(),
                  pct: total > 0 ? ((node.value / total) * 100).toFixed(1) : '0',
                  isNode: true,
                })
              }}
              onMouseLeave={() => { setHoveredNode(null); setTooltip(null) }}
            >
              <rect
                x={node.x0}
                y={node.y0}
                width={node.x1 - node.x0}
                height={nodeH}
                rx={3}
                fill={color}
                opacity={isHovered ? 1 : 0.85}
              />
              {/* Node label — right side for output nodes, left for source nodes */}
              <text
                x={node.x1 > innerW * 0.6 ? node.x1 + 6 : node.x0 - 6}
                y={node.y0 + nodeH / 2}
                textAnchor={node.x1 > innerW * 0.6 ? 'start' : 'end'}
                dominantBaseline="middle"
                fontSize={9}
                fill="#58595B"
              >
                {node.label}
              </text>
              {/* Value label inside node if tall enough */}
              {nodeH > 20 && (
                <text
                  x={(node.x0 + node.x1) / 2}
                  y={node.y0 + nodeH / 2}
                  textAnchor="middle"
                  dominantBaseline="middle"
                  fontSize={7}
                  fill="white"
                  fontWeight="600"
                >
                  {Math.round(node.value / 1000)}k
                </text>
              )}
            </g>
          )
        })}
      </g>

      {/* Tooltip rendered inside SVG as foreignObject for clean styling */}
      {tooltip && (
        <foreignObject
          x={Math.min(tooltip.x - PADDING.left - 10, width - 180)}
          y={Math.max(0, tooltip.y - PADDING.top - 70)}
          width={170}
          height={70}
          style={{ pointerEvents: 'none' }}
        >
          <div
            style={{
              background: 'white',
              border: '1px solid #E6E6E6',
              borderRadius: 4,
              padding: '6px 8px',
              fontSize: 10,
              fontFamily: 'inherit',
            }}
          >
            <div style={{ fontWeight: 600, color: '#2B2A4C' }}>{tooltip.text}</div>
            <div style={{ color: '#58595B' }}>{tooltip.value} kWh</div>
            <div style={{ color: '#95A5A6' }}>{tooltip.pct}% of electricity input</div>
          </div>
        </foreignObject>
      )}
    </svg>
  )
}

/* ── Main tab component ──────────────────────────────────────────────────────── */
export default function EnergyFlowsTab() {
  const { status, results } = useContext(SimulationContext)
  const containerRef = useRef(null)
  const [dims, setDims] = useState({ width: 600, height: 420 })

  useEffect(() => {
    if (!containerRef.current) return
    const obs = new ResizeObserver(entries => {
      const { width } = entries[0].contentRect
      setDims({ width: Math.max(400, width), height: Math.max(320, Math.min(480, width * 0.65)) })
    })
    obs.observe(containerRef.current)
    return () => obs.disconnect()
  }, [])

  if (status !== 'complete' || !results) {
    return (
      <ModuleEmptyState
        icon={GitFork}
        title="No results yet"
        description="Run a simulation to see the energy flow diagram."
        className="p-6"
      />
    )
  }

  const sankeyData = buildSankeyData(results)

  // Quick validation
  const ae = results.annual_energy ?? {}
  const total = (ae.heating_kWh ?? 0) + (ae.cooling_kWh ?? 0) + (ae.lighting_kWh ?? 0) + (ae.equipment_kWh ?? 0)

  return (
    <div className="p-4 space-y-4">
      <div>
        <p className="text-xxs uppercase tracking-wider text-mid-grey mb-1">Energy flows — annual kWh</p>
        <p className="text-xxs text-mid-grey">
          Total electricity input: <span className="text-navy font-medium">{Math.round(total).toLocaleString()} kWh/yr</span>
          {results.summary?.eui_kWh_per_m2 && (
            <span className="ml-2">· EUI: <span className="text-navy font-medium">{results.summary.eui_kWh_per_m2} kWh/m²</span></span>
          )}
        </p>
      </div>

      <div ref={containerRef} className="bg-white rounded-lg border border-light-grey p-3 overflow-hidden">
        <SankeyChart data={sankeyData} width={dims.width - 24} height={dims.height} />
      </div>

      <p className="text-xxs text-mid-grey">
        Hover links and nodes for details. Link width proportional to energy flow.
        Ideal loads system — grid electricity shown; real system efficiencies applied in detailed mode (Part 8).
      </p>
    </div>
  )
}
