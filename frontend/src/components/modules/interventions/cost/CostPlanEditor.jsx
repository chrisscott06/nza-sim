/**
 * CostPlanEditor.jsx — Brief 91 P4 / Brief 91b P2 (Cost Plan Builder).
 *
 * Replaces Brief 90's HeadlineCostEditor (six named text inputs) with the real
 * hierarchical cost plan tool from the design note: groups → line items
 * (name · qty · unit · rate · extension), per-group subtotal, an on-costs footer
 * applied in NRM2 sequence, and a plan total. Users author as much or as little
 * depth as they want (one line ↔ fifty lines across ten groups).
 *
 * Controlled component: receives `cost` (the line-item shape from costModel), emits
 * `onChange(nextCost)`. The parent (PerInterventionView) persists via the existing
 * updateInterventionCost plumbing. All math via costModel; all project-default /
 * template reads via costReads (Bible Rule 11 — no direct costLibrary import here).
 *
 * Drag-reorder (groups AND lines-within-group) reuses the Brief 94 pattern verbatim
 * (useVerticalReorder): pointer-Y-only gap hit-testing against row mid-lines, a pink
 * insertion indicator, a moved-row pending spinner cleared on the order signature.
 *
 * Keyboard discipline (Tab/Enter/Cmd+Enter/↑↓/Esc) lands in Brief 91b P3.
 * Template save/apply UI lands in Brief 91b P4.
 */
import { Fragment, useState, useRef, useEffect, useMemo, useCallback } from 'react'
import { GripVertical, ChevronDown, ChevronRight, MoreVertical, Plus, Loader2, Copy, ArrowUp, ArrowDown, Trash2 } from 'lucide-react'
import {
  UNITS, newLine, newGroup,
  computeGroupSubtotal, computeOnCostsBreakdown,
} from '../../../../utils/costModel.js'
import { readProjectDefault } from '../../../../utils/costReads.js'

const ACCENT = '#E84393'                          // interventions pink (matches the stack view)
const gbp = n => `£${Math.round(Number(n) || 0).toLocaleString('en-GB')}`
const numOrNull = raw => (raw === '' || raw == null) ? null : (Number.isFinite(Number(raw)) ? Number(raw) : null)

// On-cost footer rows, in NRM2 application order. `key` matches costModel on_costs.
const ON_COST_ROWS = [
  { key: 'design_fees_pct', label: 'Design fees', field: 'design_fees' },
  { key: 'prelims_pct',     label: 'Prelims',     field: 'prelims' },
  { key: 'ohp_pct',         label: 'OHP',         field: 'ohp' },
  { key: 'contingency_pct', label: 'Contingency', field: 'contingency' },
  { key: 'inflation_pct',   label: 'Inflation',   field: 'inflation' },
]

// NRM2 cost-group tags (optional metadata; doesn't affect compute).
const NRM2_CATEGORIES = ['0', '1', '2', '3', '4', '5', '6', '7', '8']

// ── Brief 94 reorder pattern, hookified ──────────────────────────────────────
// Pointer-Y-only destination (never x-sensitive), pink insertion indicator at the
// live gap, moved-row spinner until the new order round-trips through the parent.
function useVerticalReorder(items, onReorder) {
  const [draggingId, setDraggingId] = useState(null)
  const [dropGap,    setDropGap]    = useState(null)
  const [landedId,   setLandedId]   = useState(null)
  const [pendingId,  setPendingId]  = useState(null)
  const listRef = useRef(null)

  const resetDrag = () => { setDraggingId(null); setDropGap(null) }

  // Destination gap from the pointer's Y ONLY, against every row's mid-line across
  // the whole list column (any X yields the same gap for a given Y — Brief 94 fix).
  const gapFromPointerY = (clientY) => {
    const rowEls = listRef.current ? [...listRef.current.querySelectorAll('[data-row-id]')] : []
    let gap = rowEls.length
    for (let i = 0; i < rowEls.length; i++) {
      const r = rowEls[i].getBoundingClientRect()
      if (clientY < r.top + r.height / 2) { gap = i; break }
    }
    return gap
  }

  const handleDragStart = (e, id) => {
    setDraggingId(id)
    e.dataTransfer.effectAllowed = 'move'
    try { e.dataTransfer.setData('text/plain', id) } catch { /* ignore */ }
  }

  const handleContainerDragOver = (e) => {
    if (!draggingId) return
    e.preventDefault()
    e.dataTransfer.dropEffect = 'move'
    const gap = gapFromPointerY(e.clientY)
    const d = items.findIndex(i => i.id === draggingId)
    setDropGap(gap === d || gap === d + 1 ? null : gap)
  }

  const handleContainerDrop = (e) => {
    if (!draggingId) { resetDrag(); return }
    e.preventDefault()
    e.stopPropagation()                       // don't let a line drop bubble to the group list
    const d = items.findIndex(i => i.id === draggingId)
    if (d === -1) { resetDrag(); return }
    const movedId = draggingId
    const gap = dropGap != null ? dropGap : gapFromPointerY(e.clientY)
    resetDrag()
    const insertAt = gap > d ? gap - 1 : gap
    if (insertAt === d) return
    const reordered = [...items]
    const [moved] = reordered.splice(d, 1)
    reordered.splice(insertAt, 0, moved)
    setPendingId(movedId)
    setLandedId(movedId)
    setTimeout(() => setLandedId(null), 850)
    onReorder(reordered)
  }

  const handleDragEnd = () => resetDrag()

  const orderSig = items.map(i => i.id).join('|')
  useEffect(() => { setPendingId(null) }, [orderSig])

  return {
    listRef, draggingId, dropGap, landedId, pendingId,
    handleDragStart, handleContainerDragOver, handleContainerDrop, handleDragEnd,
  }
}

function DropIndicator() {
  return (
    <div className="relative h-2 my-0.5 pointer-events-none" aria-hidden="true">
      <div className="absolute left-1 right-1 top-1/2 -translate-y-1/2 h-[3px] rounded-full"
           style={{ backgroundColor: ACCENT, boxShadow: `0 0 8px ${ACCENT}` }} />
      <div className="absolute left-0 top-1/2 -translate-y-1/2 w-2 h-2 rounded-full ring-2 ring-white"
           style={{ backgroundColor: ACCENT }} />
    </div>
  )
}

// ── ⋮ menu ────────────────────────────────────────────────────────────────────
function GroupMenu({ group, onSetCategory, onDelete }) {
  const [open, setOpen] = useState(false)
  const [catOpen, setCatOpen] = useState(false)
  if (!open) {
    return (
      <button type="button" onClick={() => setOpen(true)}
        className="p-0.5 rounded text-mid-grey/50 hover:text-navy hover:bg-off-white" title="Group options">
        <MoreVertical size={14} />
      </button>
    )
  }
  return (
    <>
      <div className="fixed inset-0 z-10" onClick={() => { setOpen(false); setCatOpen(false) }} />
      <div className="relative z-20">
        <MoreVertical size={14} className="text-navy" />
        <div className="absolute right-0 top-5 w-44 rounded-lg border border-light-grey bg-white shadow-md py-1 text-xs">
          <div className="px-2.5 py-1 text-[10px] uppercase tracking-wider text-mid-grey/50">NRM2 category</div>
          <div className="flex flex-wrap gap-1 px-2.5 pb-1.5">
            <button type="button"
              onClick={() => { onSetCategory(null); setOpen(false) }}
              className={`px-1.5 py-0.5 rounded text-[11px] border ${group.nrm2_category == null ? 'border-navy text-navy font-semibold' : 'border-light-grey text-mid-grey hover:border-mid-grey'}`}>
              none
            </button>
            {NRM2_CATEGORIES.map(c => (
              <button key={c} type="button"
                onClick={() => { onSetCategory(c); setOpen(false) }}
                className={`w-6 py-0.5 rounded text-[11px] border ${group.nrm2_category === c ? 'border-navy text-navy font-semibold' : 'border-light-grey text-mid-grey hover:border-mid-grey'}`}>
                {c}
              </button>
            ))}
          </div>
          <div className="border-t border-light-grey/60 mt-0.5">
            <button type="button"
              onClick={() => { setOpen(false); onDelete() }}
              className="w-full text-left px-2.5 py-1.5 text-red-600 hover:bg-red-50">
              Delete group
            </button>
          </div>
        </div>
      </div>
    </>
  )
}

// ── ⋮ line-row menu (duplicate / move / delete) ──────────────────────────────
function LineMenu({ canMoveUp, canMoveDown, onDuplicate, onMoveUp, onMoveDown, onDelete }) {
  const [open, setOpen] = useState(false)
  const item = 'w-full flex items-center gap-2 px-2.5 py-1.5 text-left hover:bg-off-white text-mid-grey hover:text-navy disabled:opacity-40 disabled:hover:bg-transparent'
  if (!open) {
    return (
      <button type="button" onClick={() => setOpen(true)}
        className="p-0.5 rounded text-mid-grey/30 hover:text-navy hover:bg-off-white opacity-0 group-hover:opacity-100 transition-opacity" title="Line options">
        <MoreVertical size={13} />
      </button>
    )
  }
  const run = (fn) => () => { setOpen(false); fn?.() }
  return (
    <>
      <div className="fixed inset-0 z-10" onClick={() => setOpen(false)} />
      <div className="relative z-20 inline-block">
        <MoreVertical size={13} className="text-navy" />
        <div className="absolute right-0 top-5 w-36 rounded-lg border border-light-grey bg-white shadow-md py-1 text-xs">
          <button type="button" className={item} onClick={run(onDuplicate)}><Copy size={12} /> Duplicate</button>
          <button type="button" className={item} disabled={!canMoveUp} onClick={run(onMoveUp)}><ArrowUp size={12} /> Move up</button>
          <button type="button" className={item} disabled={!canMoveDown} onClick={run(onMoveDown)}><ArrowDown size={12} /> Move down</button>
          <div className="border-t border-light-grey/60 mt-0.5">
            <button type="button" className="w-full flex items-center gap-2 px-2.5 py-1.5 text-left text-red-600 hover:bg-red-50" onClick={run(onDelete)}>
              <Trash2 size={12} /> Delete
            </button>
          </div>
        </div>
      </div>
    </>
  )
}

// ── Line row ────────────────────────────────────────────────────────────────
function LineRow({ line, dragHandlers, dragging, pending, landed, canMoveUp, canMoveDown, onChange, onDuplicate, onMoveUp, onMoveDown, onDelete }) {
  const extension = (Number(line.quantity) || 0) * (Number(line.rate) || 0)
  return (
    <tr
      data-row-id={line.id}
      className={`group border-t border-light-grey/40 ${dragging ? 'opacity-40' : ''} ${landed ? 'animate-pulse' : ''}`}
      style={landed ? { backgroundColor: ACCENT + '12' } : undefined}
    >
      <td className="w-5 align-middle">
        <span
          draggable
          onDragStart={(e) => dragHandlers.handleDragStart(e, line.id)}
          onDragEnd={dragHandlers.handleDragEnd}
          className="flex items-center justify-center cursor-grab active:cursor-grabbing text-mid-grey/30 hover:text-mid-grey/70"
          title="Drag to reorder line"
        >
          {pending ? <Loader2 size={12} className="animate-spin" /> : <GripVertical size={12} />}
        </span>
      </td>
      <td className="py-0.5 pr-1">
        <input
          type="text" value={line.name ?? ''} placeholder="Line description"
          onChange={e => onChange({ name: e.target.value })}
          className="w-full px-1 py-0.5 text-xs border border-transparent rounded hover:border-light-grey focus:border-mid-grey focus:outline-none bg-transparent"
        />
      </td>
      <td className="py-0.5 px-0.5 w-14">
        <input
          type="number" min={0} step={1} value={line.quantity ?? ''} placeholder="0"
          onChange={e => onChange({ quantity: numOrNull(e.target.value) })}
          className="w-full px-1 py-0.5 text-xs text-right tabular-nums border border-light-grey/70 rounded focus:border-mid-grey focus:outline-none"
        />
      </td>
      <td className="py-0.5 px-0.5 w-16">
        <select
          value={line.unit ?? 'nr'}
          onChange={e => onChange({ unit: e.target.value })}
          className="w-full px-0.5 py-0.5 text-xs border border-light-grey/70 rounded focus:border-mid-grey focus:outline-none bg-white"
        >
          {UNITS.map(u => <option key={u} value={u}>{u}</option>)}
        </select>
      </td>
      <td className="py-0.5 px-0.5 w-24">
        <div className="flex items-center gap-0.5">
          <span className="text-[10px] text-mid-grey/45 whitespace-nowrap">£/{line.unit ?? 'nr'}</span>
          <input
            type="number" min={0} step={1} value={line.rate ?? ''} placeholder="0"
            onChange={e => onChange({ rate: numOrNull(e.target.value) })}
            className="w-full px-1 py-0.5 text-xs text-right tabular-nums border border-light-grey/70 rounded focus:border-mid-grey focus:outline-none"
          />
        </div>
      </td>
      <td className="py-0.5 pl-1 pr-1 w-20 text-right text-xs tabular-nums text-navy">{gbp(extension)}</td>
      <td className="w-6 text-right">
        <LineMenu
          canMoveUp={canMoveUp}
          canMoveDown={canMoveDown}
          onDuplicate={onDuplicate}
          onMoveUp={onMoveUp}
          onMoveDown={onMoveDown}
          onDelete={onDelete}
        />
      </td>
    </tr>
  )
}

// ── Group block (header + its own line list with line-level reorder) ──────────
function GroupBlock({ group, onChange, onDelete, groupDragHandlers, groupDragging, groupPending, groupLanded }) {
  const subtotal = useMemo(() => computeGroupSubtotal(group), [group])
  const lineReorder = useVerticalReorder(group.lines ?? [], (lines) => onChange({ lines }))

  const setLine = (lineId, patch) => onChange({
    lines: (group.lines ?? []).map(l => l.id === lineId ? { ...l, ...patch } : l),
  })
  const deleteLine = (lineId) => onChange({ lines: (group.lines ?? []).filter(l => l.id !== lineId) })
  const addLine = () => onChange({ lines: [...(group.lines ?? []), newLine()] })
  const duplicateLine = (lineId) => {
    const lines = group.lines ?? []
    const i = lines.findIndex(l => l.id === lineId)
    if (i < 0) return
    const src = lines[i]
    const copy = newLine({ name: src.name, quantity: src.quantity, unit: src.unit, rate: src.rate, notes: src.notes })
    onChange({ lines: [...lines.slice(0, i + 1), copy, ...lines.slice(i + 1)] })
  }
  const moveLine = (lineId, dir) => {
    const lines = [...(group.lines ?? [])]
    const i = lines.findIndex(l => l.id === lineId)
    const to = i + dir
    if (i < 0 || to < 0 || to >= lines.length) return
    const [m] = lines.splice(i, 1)
    lines.splice(to, 0, m)
    onChange({ lines })
  }
  const collapsed = !!group.collapsed

  return (
    <div className={`rounded-lg border bg-white ${groupLanded ? 'border-[color:var(--accent)]' : 'border-light-grey/70'}`}
         style={groupLanded ? { '--accent': ACCENT, backgroundColor: ACCENT + '0A' } : undefined}>
      {/* Group header */}
      <div className="flex items-center gap-1 px-2 py-1.5 border-b border-light-grey/50">
        <span
          draggable
          onDragStart={(e) => groupDragHandlers.handleDragStart(e, group.id)}
          onDragEnd={groupDragHandlers.handleDragEnd}
          className="flex items-center justify-center cursor-grab active:cursor-grabbing text-mid-grey/40 hover:text-mid-grey/80"
          title="Drag to reorder group"
        >
          {groupPending ? <Loader2 size={13} className="animate-spin" /> : <GripVertical size={13} />}
        </span>
        <button type="button" onClick={() => onChange({ collapsed: !collapsed })}
          className="text-mid-grey/60 hover:text-navy" title={collapsed ? 'Expand' : 'Collapse'}>
          {collapsed ? <ChevronRight size={14} /> : <ChevronDown size={14} />}
        </button>
        <input
          type="text" value={group.name ?? ''} placeholder="Group name (e.g. Enabling works)"
          onChange={e => onChange({ name: e.target.value })}
          className="flex-1 min-w-0 px-1 py-0.5 text-xs font-semibold text-navy border border-transparent rounded hover:border-light-grey focus:border-mid-grey focus:outline-none bg-transparent"
        />
        {group.nrm2_category != null && (
          <span className="text-[10px] px-1 py-0.5 rounded bg-off-white text-mid-grey/70 font-medium" title="NRM2 category">
            NRM2 {group.nrm2_category}
          </span>
        )}
        <span className="text-xs font-semibold tabular-nums text-navy px-1">{gbp(subtotal)}</span>
        <GroupMenu group={group} onSetCategory={(c) => onChange({ nrm2_category: c })} onDelete={onDelete} />
      </div>

      {/* Lines */}
      {!collapsed && (
        <div className="px-2 py-1">
          <table className="w-full">
            <tbody
              ref={lineReorder.listRef}
              onDragOver={lineReorder.handleContainerDragOver}
              onDrop={lineReorder.handleContainerDrop}
            >
              {(group.lines ?? []).length === 0 ? (
                <tr><td className="py-1.5 text-xs text-mid-grey/45 italic">No lines yet.</td></tr>
              ) : (
                (group.lines ?? []).map((line, i) => (
                  <Fragment key={line.id}>
                    {lineReorder.draggingId && lineReorder.dropGap === i
                      ? <tr aria-hidden="true"><td colSpan={7}><DropIndicator /></td></tr> : null}
                    <LineRow
                      line={line}
                      dragHandlers={lineReorder}
                      dragging={lineReorder.draggingId === line.id}
                      pending={lineReorder.pendingId === line.id}
                      landed={lineReorder.landedId === line.id}
                      canMoveUp={i > 0}
                      canMoveDown={i < (group.lines ?? []).length - 1}
                      onChange={(patch) => setLine(line.id, patch)}
                      onDuplicate={() => duplicateLine(line.id)}
                      onMoveUp={() => moveLine(line.id, -1)}
                      onMoveDown={() => moveLine(line.id, +1)}
                      onDelete={() => deleteLine(line.id)}
                    />
                  </Fragment>
                ))
              )}
              {lineReorder.draggingId && lineReorder.dropGap === (group.lines ?? []).length
                ? <tr aria-hidden="true"><td colSpan={7}><DropIndicator /></td></tr> : null}
            </tbody>
          </table>
          <button type="button" onClick={addLine}
            className="mt-1 flex items-center gap-1 text-[11px] font-medium text-mid-grey hover:text-navy px-1 py-0.5">
            <Plus size={11} /> Add line
          </button>
        </div>
      )}
    </div>
  )
}

// ── On-costs footer ───────────────────────────────────────────────────────────
function OnCostsFooter({ cost, projectDefaults, breakdown, onChange }) {
  const onCosts = cost.on_costs ?? {}
  const setPct = (key, raw) => onChange({ ...onCosts, [key]: numOrNull(raw) })
  return (
    <div className="rounded-lg border border-light-grey/70 bg-off-white/40 px-3 py-2">
      <div className="flex items-center justify-between text-xs mb-1">
        <span className="font-semibold text-navy">Subtotal (works)</span>
        <span className="tabular-nums text-navy">{gbp(breakdown.lines_total)}</span>
      </div>
      <div className="text-[10px] uppercase tracking-wider text-mid-grey/50 pt-1 pb-0.5">On-costs</div>
      <table className="w-full text-xs">
        <tbody>
          {ON_COST_ROWS.map(({ key, label, field }) => {
            const override = onCosts[key]
            const isOverride = override != null && override !== ''
            const shown = isOverride ? override : readProjectDefault(key, projectDefaults)
            return (
              <tr key={key} className="border-t border-light-grey/30">
                <td className="py-1 text-mid-grey">{label}</td>
                <td className="py-1 w-24 text-right">
                  <span className="inline-flex items-center gap-0.5">
                    <input
                      type="number" min={0} step={0.5}
                      value={isOverride ? override : ''}
                      placeholder={String(readProjectDefault(key, projectDefaults))}
                      onChange={e => setPct(key, e.target.value)}
                      title={isOverride ? 'Overridden — clear to revert to project default' : 'Project default — type to override'}
                      className={`w-14 px-1 py-0.5 text-right tabular-nums border rounded focus:outline-none focus:border-mid-grey ${
                        isOverride ? 'border-light-grey text-navy' : 'border-transparent text-mid-grey/50 hover:border-light-grey'
                      }`}
                    />
                    <span className="text-mid-grey/50">%</span>
                  </span>
                </td>
                <td className="py-1 w-24 text-right tabular-nums text-navy">{gbp(breakdown[field])}</td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}

// ── Editor ─────────────────────────────────────────────────────────────────
export default function CostPlanEditor({ cost, projectDefaults, onChange }) {
  const groups = Array.isArray(cost?.groups) ? cost.groups : []
  const breakdown = useMemo(() => computeOnCostsBreakdown(cost, projectDefaults), [cost, projectDefaults])
  const groupReorder = useVerticalReorder(groups, (nextGroups) => onChange({ ...cost, groups: nextGroups }))

  const updateGroup = useCallback((groupId, patch) => {
    onChange({ ...cost, groups: groups.map(g => g.id === groupId ? { ...g, ...patch } : g) })
  }, [cost, groups, onChange])
  const deleteGroup = useCallback((groupId) => {
    onChange({ ...cost, groups: groups.filter(g => g.id !== groupId) })
  }, [cost, groups, onChange])
  const addGroup = useCallback(() => {
    onChange({ ...cost, groups: [...groups, newGroup({ lines: [newLine()] })] })
  }, [cost, groups, onChange])
  const setOnCosts = useCallback((on_costs) => onChange({ ...cost, on_costs }), [cost, onChange])

  return (
    <div className="rounded-lg border border-light-grey/70 bg-white px-3 py-2.5">
      <div className="flex items-center justify-between mb-2">
        <div className="text-xxs uppercase tracking-wider text-mid-grey/70 font-semibold">Cost plan</div>
        {/* Template save/apply bar lands in Brief 91b P4. */}
      </div>

      {/* Groups (group-level reorder) */}
      <div
        ref={groupReorder.listRef}
        onDragOver={groupReorder.handleContainerDragOver}
        onDrop={groupReorder.handleContainerDrop}
        className="space-y-1.5"
      >
        {groups.length === 0 ? (
          <div className="text-xs text-mid-grey/50 italic py-2">
            No cost lines yet. Add a group to start building the plan.
          </div>
        ) : (
          groups.map((group, i) => (
            <Fragment key={group.id}>
              {groupReorder.draggingId && groupReorder.dropGap === i ? <DropIndicator /> : null}
              <GroupBlock
                group={group}
                onChange={(patch) => updateGroup(group.id, patch)}
                onDelete={() => deleteGroup(group.id)}
                groupDragHandlers={groupReorder}
                groupDragging={groupReorder.draggingId === group.id}
                groupPending={groupReorder.pendingId === group.id}
                groupLanded={groupReorder.landedId === group.id}
              />
            </Fragment>
          ))
        )}
        {groupReorder.draggingId && groupReorder.dropGap === groups.length ? <DropIndicator /> : null}
      </div>

      <button type="button" onClick={addGroup}
        className="mt-2 w-full flex items-center justify-center gap-1.5 px-3 py-1.5 rounded-lg border border-dashed text-xxs font-medium text-mid-grey hover:text-navy hover:bg-off-white/50 transition-colors"
        style={{ borderColor: ACCENT + '60' }}>
        <Plus size={12} style={{ color: ACCENT }} /> Add group
      </button>

      {/* On-costs footer + total */}
      <div className="mt-2.5">
        <OnCostsFooter cost={cost} projectDefaults={projectDefaults} breakdown={breakdown} onChange={setOnCosts} />
      </div>
      <div className="flex items-center justify-between mt-2 pt-2 border-t-2 border-light-grey">
        <span className="text-sm font-semibold text-navy">Total cost</span>
        <span className="text-sm font-semibold text-navy tabular-nums">{gbp(breakdown.total)}</span>
      </div>
    </div>
  )
}
