/**
 * InterventionStackView.jsx — Brief 41 Part 3
 *
 * Ordered list of interventions stacked against a non-removable
 * "Baseline" row at the top. Each row composes:
 *   [drag handle] [enable dot] [label] [marginal Δ] [cumulative Δ] [edit]
 *
 * Drag-and-drop reordering uses native HTML5 drag events. On drop,
 * onReorder(newOrder) fires with the reordered intervention array;
 * the parent persists via updateParam('interventions', ...).
 *
 * Override-warning detection (Notion §10 boundary condition): walk
 * the interventions list left-to-right; for each enabled
 * intervention I, check whether any of its patches' paths are also
 * patched by a later enabled intervention J. If so, I's row gets the
 * ⚠ marker. Last-write-wins per audit doc §6.
 *
 * Empty state (no interventions): brief inline explainer + "+ Add
 * your first intervention" CTA.
 */

import { Fragment, useState } from 'react'
import { Plus } from 'lucide-react'
import InterventionRow from './InterventionRow.jsx'
import { useUISettings } from '../../../context/UISettingsContext.jsx'
import { toDisplay, KIND, getGia } from './visualiser/unitFmt.js'

const INTERVENTIONS_ACCENT = '#E84393'

/**
 * Brief 87 (drag UX rework) — the pink insertion indicator that shows exactly
 * where a dragged intervention will land. A glowing accent line with a dot on
 * the left; its height opens a small gap so the rows below "make room".
 */
function DropIndicator() {
  return (
    <div className="relative h-2.5 my-0.5 pointer-events-none" aria-hidden="true">
      <div
        className="absolute left-1 right-1 top-1/2 -translate-y-1/2 h-[3px] rounded-full"
        style={{ backgroundColor: INTERVENTIONS_ACCENT, boxShadow: `0 0 8px ${INTERVENTIONS_ACCENT}` }}
      />
      <div
        className="absolute left-0 top-1/2 -translate-y-1/2 w-2.5 h-2.5 rounded-full ring-2 ring-white"
        style={{ backgroundColor: INTERVENTIONS_ACCENT }}
      />
    </div>
  )
}

/**
 * Brief 55 Part 5 (2026-05-26) — Same-field conflict signal.
 *
 * Pre-Brief-55 the "Overridden by a later intervention" warning was
 * a side-effect of whole-object snapshot collision: two interventions
 * that captured `systems_config_v40` snapshots would always collide
 * because each REPLACES the entire sub-tree. Now (post Brief 55 Part 2)
 * patches are field-level, so this signal fires only on GENUINE
 * same-field conflict — two enabled interventions edit the literal
 * same patch path with different values.
 *
 * Returns:
 *   {
 *     interventionHasConflict: Set<interventionId>,
 *     patchConflicts: Map<patchId, {
 *       interventionId,
 *       otherInterventionId,
 *       otherInterventionLabel,
 *       otherValue,
 *       // Heuristic flag — likely a legacy-snapshot capture artefact.
 *       // True when the intervention's label suggests its concern is
 *       // OTHER than the field in conflict (e.g. "MVHR Bedrooms" with
 *       // a heating share_pct edit). The UI uses this to nudge the
 *       // user toward dropping the unintended field edit.
 *       likelyArtefact: boolean,
 *     }>,
 *   }
 *
 * Coarse path-string match — finer-grained array-entry detection
 * (add[id=X] followed by remove[id=X]) is a future refinement.
 */
export function computeFieldConflicts(interventions) {
  const interventionHasConflict = new Set()
  const patchConflicts = new Map()
  if (!Array.isArray(interventions)) return { interventionHasConflict, patchConflicts }

  // First pass: index every enabled set/replace patch by path so we can
  // find collisions across interventions.
  // pathOwners.get(path) = [{ intvId, intvLabel, patchId, value }, ...]
  const pathOwners = new Map()
  for (const intv of interventions) {
    if (!intv || intv.enabled === false) continue
    const patches = Array.isArray(intv.patches) ? intv.patches : []
    for (const p of patches) {
      if (!p || (p.op !== 'set' && p.op !== 'replace')) continue
      if (!p.path) continue
      const owners = pathOwners.get(p.path) ?? []
      owners.push({ intvId: intv.id, intvLabel: intv.label ?? '(unnamed)', patchId: p.id, value: p.value })
      pathOwners.set(p.path, owners)
    }
  }

  // Second pass: any path with >1 owner is a conflict. For each owner,
  // mark its patch as conflicting (paired with the immediately-following
  // owner — that's the "later intervention" semantics).
  for (const [pathStr, owners] of pathOwners) {
    if (owners.length < 2) continue
    for (let i = 0; i < owners.length - 1; i++) {
      const self = owners[i]
      const later = owners[i + 1]
      interventionHasConflict.add(self.intvId)
      patchConflicts.set(self.patchId, {
        interventionId: self.intvId,
        otherInterventionId: later.intvId,
        otherInterventionLabel: later.intvLabel,
        otherValue: later.value,
        likelyArtefact: _isLikelyArtefact(self.intvLabel, pathStr),
      })
    }
  }
  return { interventionHasConflict, patchConflicts }
}

/**
 * Heuristic: does this intervention's label suggest its concern is
 * something OTHER than the field path it edits? Used to flag legacy-
 * snapshot capture artefacts (e.g. "MVHR Bedrooms" carrying a
 * `heating[id=X].share_pct` edit picked up from a drifted-view
 * snapshot). The UI then nudges the user to drop the unintended edit.
 *
 * Conservative — when uncertain, return false (treat as a real conflict).
 */
function _isLikelyArtefact(intvLabel, patchPath) {
  if (typeof intvLabel !== 'string' || typeof patchPath !== 'string') return false
  const label = intvLabel.toLowerCase()
  // Path segment tells us which service area the patch touches.
  const m = patchPath.match(/systems_config_v\d+\.(heating|cooling|dhw|ventilation|lighting|small_power)/)
  if (!m) return false
  const fieldService = m[1]
  // Map label keywords to expected service.
  const labelService =
      /mvhr|vent|hre|extract|airflow|fan/.test(label) ? 'ventilation'
    : /vrf|ashp|scop|boiler|heat\b|heating/.test(label) ? 'heating'
    : /cool/.test(label)                          ? 'cooling'
    : /dhw|hot water/.test(label)                 ? 'dhw'
    : /light/.test(label)                         ? 'lighting'
    : /small power|appliance/.test(label)         ? 'small_power'
    : null
  if (labelService == null) return false
  return labelService !== fieldService
}

// Back-compat alias for callers that just need the boolean set.
function computeOverriddenSet(interventions) {
  return computeFieldConflicts(interventions).interventionHasConflict
}

function BaselineRow({ baselineSummary, gia_m2 = 0 }) {
  // Brief 47 Part 5a (2026-05-24): card layout matching InterventionRow,
  // sized + spaced so the stack of cards reads as a single visual
  // sequence. Baseline has no marginal/cumulative — show the absolute
  // EUI + Carbon figures in a small two-cell table so the user has the
  // anchor values to read intervention deltas against.
  //
  // 2026-05-26: both EUI and Carbon honour the global Per m² ↔ Total
  // toggle. Per m² → kWh/m²·yr + kgCO₂/m²·yr. Total → MWh + tCO₂.
  const { unit } = useUISettings()
  const euiConv    = toDisplay(baselineSummary?.eui,    KIND.KWH_M2, unit, gia_m2)
  const carbonConv = toDisplay(baselineSummary?.carbon, KIND.KG_M2,  unit, gia_m2)
  const euiLabel    = euiConv.label    || 'kWh/m²·yr'
  const carbonLabel = carbonConv.label || 'kgCO₂/m²·yr'

  return (
    <div className="rounded-lg border border-light-grey bg-off-white p-3">
      <div className="flex items-center gap-2">
        <span className="block w-2.5 h-2.5 rounded-full bg-mid-grey/70 flex-shrink-0" title="Baseline" />
        <span className="text-caption text-navy font-semibold">Baseline</span>
        <span className="text-xxs text-mid-grey italic ml-1">starting point</span>
      </div>
      <table className="w-full mt-2 text-xxs border-collapse">
        <tbody>
          <tr className="border-t border-light-grey/60">
            <td className="text-mid-grey font-medium py-1 w-16">EUI</td>
            <td className="text-right tabular-nums text-navy font-semibold py-1">
              {euiConv.value != null ? euiConv.value.toFixed(1) : '—'}
            </td>
            <td className="text-mid-grey/70 pl-2 py-1">{euiLabel}</td>
          </tr>
          <tr className="border-t border-light-grey/60">
            <td className="text-mid-grey font-medium py-1">Carbon</td>
            <td className="text-right tabular-nums text-navy font-semibold py-1">
              {carbonConv.value != null ? carbonConv.value.toFixed(1) : '—'}
            </td>
            <td className="text-mid-grey/70 pl-2 py-1">{carbonLabel}</td>
          </tr>
        </tbody>
      </table>
    </div>
  )
}

// Brief 94 P3 — the Strategy is a selection FROM the library. Empty strategy →
// prompt to add from the library (or, if the library itself is empty, to create
// one on the Library tab). No "create" here: the strategy never authors definitions.
function EmptyState({ hasLibrary }) {
  return (
    <div className="border border-dashed border-light-grey rounded-xl bg-off-white/30 p-8 text-center">
      <div className="mx-auto mb-3 w-12 h-12 rounded-full flex items-center justify-center" style={{ backgroundColor: INTERVENTIONS_ACCENT + '15' }}>
        <Plus size={20} style={{ color: INTERVENTIONS_ACCENT }} />
      </div>
      <p className="text-caption font-medium text-navy mb-1">Strategy is empty</p>
      <p className="text-xxs text-mid-grey max-w-md mx-auto">
        {hasLibrary
          ? 'Add interventions from your library below, then order them — each compounds on top of the ones above it.'
          : 'Your library has no interventions yet. Create one on the Library tab, then add it to this strategy.'}
      </p>
    </div>
  )
}

// Brief 94 P3 — Add-from-library picker. Lists library items grouped by theme;
// items already in the strategy are shown disabled ("In strategy" — duplicate guard,
// Decision 2). Clicking an available item adds a reference (order = end).
function AddFromLibraryPicker({ library = [], strategyRefIds, onAddFromLibrary }) {
  const [open, setOpen] = useState(false)
  const inStrategy = strategyRefIds instanceof Set ? strategyRefIds : new Set(strategyRefIds || [])

  // Group by theme (fallback "Other"), preserving first-seen order.
  const groups = []
  const byTheme = new Map()
  for (const iv of library) {
    const theme = (iv?.theme && String(iv.theme).trim()) || 'Other'
    if (!byTheme.has(theme)) { byTheme.set(theme, []); groups.push(theme) }
    byTheme.get(theme).push(iv)
  }

  return (
    <div>
      <button
        type="button"
        onClick={() => setOpen(o => !o)}
        className="w-full flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg border border-dashed text-xxs font-medium text-mid-grey hover:text-navy hover:bg-off-white/50 transition-colors"
        style={{ borderColor: INTERVENTIONS_ACCENT + '60' }}
      >
        <Plus size={12} style={{ color: INTERVENTIONS_ACCENT }} />
        Add from library
      </button>
      {open ? (
        <div className="mt-1.5 rounded-lg border border-light-grey bg-white shadow-sm p-2 space-y-2 max-h-72 overflow-auto">
          {library.length === 0 ? (
            <p className="text-xxs text-mid-grey/60 italic px-1 py-1.5">
              Library is empty — create interventions on the Library tab.
            </p>
          ) : (
            groups.map(theme => (
              <div key={theme}>
                <p className="text-[10px] uppercase tracking-wider font-semibold text-mid-grey/70 px-1 mb-0.5">{theme}</p>
                {byTheme.get(theme).map(iv => {
                  const already = inStrategy.has(iv.id)
                  return (
                    <button
                      key={iv.id}
                      type="button"
                      disabled={already}
                      onClick={() => { if (!already) { onAddFromLibrary?.(iv.id); setOpen(false) } }}
                      className={`w-full flex items-center justify-between gap-2 px-2 py-1.5 rounded text-left transition-colors ${
                        already ? 'cursor-not-allowed opacity-50' : 'hover:bg-off-white'
                      }`}
                    >
                      <span className="text-xs text-navy truncate">{iv.label || '(untitled)'}</span>
                      {already
                        ? <span className="text-[10px] text-mid-grey/60 flex-shrink-0">In strategy</span>
                        : <Plus size={12} className="flex-shrink-0" style={{ color: INTERVENTIONS_ACCENT }} />}
                    </button>
                  )
                })}
              </div>
            ))
          )}
        </div>
      ) : null}
    </div>
  )
}

export default function InterventionStackView({
  interventions = [],    // Brief 94 P3: the RESOLVED strategy (ordered library items + enabled)
  baselineSummary,
  stackResult,
  baselineConfig,
  onToggleEnabled,
  onReorder,
  onRemove,              // Brief 94 P3: remove the reference from the strategy (library item survives)
  library = [],          // Brief 94 P3: all library items (for the Add-from-library picker)
  strategyRefIds,        // Brief 94 P3: Set of library_ids already in the strategy (dup guard)
  onAddFromLibrary,      // Brief 94 P3: add a library item to the strategy
}) {
  // Brief 87 drag UX: track the grabbed item + the insertion GAP (0..N) the
  // pink indicator points at, computed from the cursor's position within the
  // hovered row (top half → before it, bottom half → after it). `landedId`
  // drives a brief pink flash on the row once it settles into its new slot so
  // the reorder is obvious.
  const [draggingId, setDraggingId] = useState(null)
  const [dropGap,    setDropGap]    = useState(null)
  const [landedId,   setLandedId]   = useState(null)

  const resetDrag = () => { setDraggingId(null); setDropGap(null) }

  const handleDragStart = (e, id) => {
    setDraggingId(id)
    e.dataTransfer.effectAllowed = 'move'
    // Some browsers require setData to enable drop
    try { e.dataTransfer.setData('text/plain', id) } catch { /* ignore */ }
  }
  const handleDragOver = (e, id) => {
    e.preventDefault()
    e.dataTransfer.dropEffect = 'move'
    if (!draggingId) return
    const idx = interventions.findIndex(i => i.id === id)
    if (idx === -1) return
    const rect = e.currentTarget.getBoundingClientRect()
    const before = e.clientY < rect.top + rect.height / 2
    const gap = before ? idx : idx + 1
    // Hide the indicator when the gap is adjacent to the item's own slot —
    // dropping there wouldn't move it, so don't promise a move.
    const d = interventions.findIndex(i => i.id === draggingId)
    setDropGap(gap === d || gap === d + 1 ? null : gap)
  }
  // Brief 94 P3 fix (P1 diagnostic root cause: a106438): drop must NOT depend solely
  // on the transient `dropGap` — the <DropIndicator> reflow shifts the list under the
  // cursor and can leave `dropGap` null at release, silently no-op'ing the reorder.
  // Recompute the destination from the row the drop fired on (`targetId`) + cursor Y
  // at release, falling back to `dropGap` when it is set.
  const handleDrop = (e, targetId) => {
    e.preventDefault()
    const d = interventions.findIndex(i => i.id === draggingId)
    if (d === -1) { resetDrag(); return }
    let gap = dropGap
    if (gap == null && targetId != null) {
      const idx = interventions.findIndex(i => i.id === targetId)
      if (idx !== -1) {
        const rect = e.currentTarget.getBoundingClientRect()
        gap = e.clientY < rect.top + rect.height / 2 ? idx : idx + 1
      }
    }
    if (gap == null) { resetDrag(); return }
    const insertAt = gap > d ? gap - 1 : gap
    if (insertAt === d) { resetDrag(); return }
    const reordered = [...interventions]
    const [moved] = reordered.splice(d, 1)
    reordered.splice(insertAt, 0, moved)
    onReorder?.(reordered)
    setLandedId(draggingId)
    setTimeout(() => setLandedId(null), 850)
    resetDrag()
  }
  const handleDragEnd = () => resetDrag()

  // 2026-05-26: GIA from the baseline result so child rows can honour
  // the global unit toggle (kWh/m²·yr ↔ MWh) on their EUI numbers.
  const gia_m2 = getGia(stackResult?.baseline)

  if (!Array.isArray(interventions) || interventions.length === 0) {
    return (
      <div className="space-y-3">
        <BaselineRow baselineSummary={baselineSummary} gia_m2={gia_m2} />
        <EmptyState hasLibrary={library.length > 0} />
        <AddFromLibraryPicker
          library={library}
          strategyRefIds={strategyRefIds}
          onAddFromLibrary={onAddFromLibrary}
        />
      </div>
    )
  }

  // Brief 55 Part 5 — richer conflict info (per-patch, with artefact heuristic).
  const { interventionHasConflict: overridden, patchConflicts } = computeFieldConflicts(interventions)
  const stackRows = Array.isArray(stackResult?.interventions) ? stackResult.interventions : []

  // Brief 47 Part 5a (2026-05-24): column-headers row retired. Each
  // card (BaselineRow + InterventionRow) carries its own labelled
  // metrics table — the global header strip is redundant and was the
  // source of the squeezed-label issue in the 560 px-wide left pane.
  // Brief 47 Part 5c (2026-05-24): inter-card gap tightened from
  // space-y-3 → space-y-1.5 so collapsed rows pack tightly enough that
  // a long stack stays drag-reorderable without scrolling.
  return (
    <div className="space-y-1.5">
      {/* Baseline card */}
      <BaselineRow baselineSummary={baselineSummary} gia_m2={gia_m2} />

      {/* Intervention rows — with the pink insertion indicator at the live
          drop gap (Brief 87 drag UX rework). */}
      {interventions.map((intervention, i) => {
        // Engine result rows align 1:1 with interventions (one row per
        // intervention, including disabled ones — see audit §8.2).
        const row = stackRows[i]
        return (
          <Fragment key={intervention.id}>
            {draggingId && dropGap === i ? <DropIndicator /> : null}
            <InterventionRow
              intervention={intervention}
              marginalDeltaFull={row?.marginal_delta ?? null}
              cumulativeDeltaFull={row?.cumulative_delta ?? null}
              overridden={overridden.has(intervention.id)}
              baselineConfig={baselineConfig}
              gia_m2={gia_m2}
              onToggleEnabled={() => onToggleEnabled?.(intervention.id)}
              onRemove={() => onRemove?.(intervention.id)}
              onDragStart={handleDragStart}
              onDragOver={handleDragOver}
              onDrop={handleDrop}
              onDragEnd={handleDragEnd}
              draggingId={draggingId}
              landed={landedId === intervention.id}
            />
          </Fragment>
        )
      })}
      {draggingId && dropGap === interventions.length ? <DropIndicator /> : null}

      {/* Brief 94 P3 — Add from library (not "create"): pick an existing library
          item; items already in the strategy are shown disabled (duplicate guard). */}
      <AddFromLibraryPicker
        library={library}
        strategyRefIds={strategyRefIds}
        onAddFromLibrary={onAddFromLibrary}
      />
    </div>
  )
}
