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

import { useState } from 'react'
import { Plus } from 'lucide-react'
import InterventionRow from './InterventionRow.jsx'

const INTERVENTIONS_ACCENT = '#E84393'

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

function BaselineRow({ baselineSummary }) {
  // Brief 47 Part 5a (2026-05-24): card layout matching InterventionRow,
  // sized + spaced so the stack of cards reads as a single visual
  // sequence. Baseline has no marginal/cumulative — show the absolute
  // EUI + Carbon figures in a small two-cell table so the user has the
  // anchor values to read intervention deltas against.
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
              {baselineSummary?.eui != null ? baselineSummary.eui.toFixed(1) : '—'}
            </td>
            <td className="text-mid-grey/70 pl-2 py-1">kWh/m²·yr</td>
          </tr>
          <tr className="border-t border-light-grey/60">
            <td className="text-mid-grey font-medium py-1">Carbon</td>
            <td className="text-right tabular-nums text-navy font-semibold py-1">
              {baselineSummary?.carbon != null ? baselineSummary.carbon.toFixed(1) : '—'}
            </td>
            <td className="text-mid-grey/70 pl-2 py-1">kgCO₂/m²·yr</td>
          </tr>
        </tbody>
      </table>
    </div>
  )
}

function EmptyState({ onAdd }) {
  return (
    <div className="border border-dashed border-light-grey rounded-xl bg-off-white/30 p-10 text-center">
      <div className="mx-auto mb-3 w-12 h-12 rounded-full flex items-center justify-center" style={{ backgroundColor: INTERVENTIONS_ACCENT + '15' }}>
        <Plus size={20} style={{ color: INTERVENTIONS_ACCENT }} />
      </div>
      <p className="text-caption font-medium text-navy mb-1">No interventions yet</p>
      <p className="text-xxs text-mid-grey max-w-md mx-auto mb-5">
        Interventions let you test what-if changes against the baseline
        without modifying the baseline itself. Stack them in order to
        see compounding effects.
      </p>
      <button
        onClick={onAdd}
        className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg text-white text-caption font-medium hover:opacity-90 transition-opacity"
        style={{ backgroundColor: INTERVENTIONS_ACCENT }}
      >
        <Plus size={14} /> Add your first intervention
      </button>
    </div>
  )
}

export default function InterventionStackView({
  interventions = [],
  baselineSummary,
  stackResult,
  baselineConfig,
  onToggleEnabled,
  onReorder,
  onEdit,
  onAdd,
  onDuplicate,           // Brief 45 Part 2
  onDelete,              // Brief 47 Part 1.3
}) {
  const [draggingId, setDraggingId] = useState(null)
  const [hoverId,    setHoverId]    = useState(null)

  const handleDragStart = (e, id) => {
    setDraggingId(id)
    e.dataTransfer.effectAllowed = 'move'
    // Some browsers require setData to enable drop
    try { e.dataTransfer.setData('text/plain', id) } catch { /* ignore */ }
  }
  const handleDragOver = (e, id) => {
    e.preventDefault()
    e.dataTransfer.dropEffect = 'move'
    if (id !== hoverId) setHoverId(id)
  }
  const handleDrop = (e, targetId) => {
    e.preventDefault()
    if (!draggingId || draggingId === targetId) {
      setDraggingId(null)
      setHoverId(null)
      return
    }
    const fromIdx = interventions.findIndex(i => i.id === draggingId)
    const toIdx   = interventions.findIndex(i => i.id === targetId)
    if (fromIdx === -1 || toIdx === -1) {
      setDraggingId(null)
      setHoverId(null)
      return
    }
    const reordered = [...interventions]
    const [moved] = reordered.splice(fromIdx, 1)
    reordered.splice(toIdx, 0, moved)
    onReorder?.(reordered)
    setDraggingId(null)
    setHoverId(null)
  }
  const handleDragEnd = () => {
    setDraggingId(null)
    setHoverId(null)
  }

  if (!Array.isArray(interventions) || interventions.length === 0) {
    return (
      <div className="space-y-3">
        <BaselineRow baselineSummary={baselineSummary} />
        <EmptyState onAdd={onAdd} />
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
      <BaselineRow baselineSummary={baselineSummary} />

      {/* Intervention rows */}
      {interventions.map((intervention, i) => {
        // Engine result rows align 1:1 with interventions (one row per
        // intervention, including disabled ones — see audit §8.2).
        const row = stackRows[i]
        return (
          <InterventionRow
            key={intervention.id}
            intervention={intervention}
            marginalDeltaFull={row?.marginal_delta ?? null}
            cumulativeDeltaFull={row?.cumulative_delta ?? null}
            overridden={overridden.has(intervention.id)}
            baselineConfig={baselineConfig}
            onToggleEnabled={() => onToggleEnabled?.(intervention.id)}
            onEdit={() => onEdit?.(intervention.id)}
            onDuplicate={() => onDuplicate?.(intervention.id)}
            onDelete={() => onDelete?.(intervention.id)}
            onDragStart={handleDragStart}
            onDragOver={handleDragOver}
            onDrop={handleDrop}
            onDragEnd={handleDragEnd}
            draggingId={draggingId}
          />
        )
      })}

      {/* + Add intervention */}
      <button
        onClick={onAdd}
        className="w-full flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg border border-dashed text-xxs font-medium text-mid-grey hover:text-navy hover:bg-off-white/50 transition-colors"
        style={{ borderColor: INTERVENTIONS_ACCENT + '60' }}
      >
        <Plus size={12} style={{ color: INTERVENTIONS_ACCENT }} />
        Add intervention
      </button>
    </div>
  )
}
