/**
 * ChangeList.jsx — Brief 47 Part 2.1 + 2.2 (2026-05-24)
 *
 * Always-visible plain-English list of every patch captured by the
 * intervention editor's capture context. Each row shows the patch's
 * label, before-value, after-value, and a revert button.
 *
 * Reads `currentPatches` from `useInterventionCapture`. Reverts via
 * the same context's `revertPatch(id)`. Re-renders on every patch
 * change.
 *
 * Plain-English rendering reuses the existing `summarizePatch`
 * helper from `patchCapture.js` (Brief 41) — same renderer the
 * stack row's short summary uses.
 *
 * Empty state: explains the panel will populate as the user edits.
 *
 * Placement (Part 2): mounted as a horizontal strip above the
 * EditorFooter so it's visible regardless of which section is active
 * in the right pane. Part 3 may relocate it as part of the
 * inputs-left / visualiser-right layout restructure; the component
 * itself is layout-agnostic.
 *
 * Brief 47 Principle 2 (faithful state display): this is one of the
 * three complementary ways to see an intervention's changes — the
 * change list (here), the nav flags (EditorNav), the control flags
 * (PatchedInputBadge, per-input — coverage extends in Part 4 polish).
 */

import { Trash2, ListChecks, AlertTriangle } from 'lucide-react'
import { useInterventionCapture } from '../../../context/InterventionCaptureContext.jsx'
import { summarizePatch } from './patchCapture.js'

const INTERVENTIONS_ACCENT = '#E84393'

function ToneText({ tone, children }) {
  if (tone === 'good')    return <span className="text-green-700 font-medium">{children}</span>
  if (tone === 'bad')     return <span className="text-red-700 font-medium">{children}</span>
  return <span className="text-navy font-medium">{children}</span>
}

function ChangeRow({ patch, baselineConfig, libraryData, onRevert, conflict }) {
  // summarizePatch handles every op shape (set/add/remove/replace) and
  // produces `{ label, verb, before, after, pct, tone }`. Falls back
  // to a path-based label when the path isn't in its dictionary.
  const summary = summarizePatch(patch, baselineConfig?.building ?? baselineConfig, libraryData)
  if (!summary) {
    // Defensive — render the raw path so the user at least sees that
    // _something_ is captured. Revert still works.
    return (
      <li className="flex items-center gap-2 px-2 py-1 text-xxs border-b border-light-grey/60 last:border-b-0">
        <code className="flex-1 truncate text-mid-grey">{patch?.path ?? '(unknown patch)'}</code>
        <button
          type="button"
          onClick={() => onRevert(patch.id)}
          className="flex-shrink-0 p-1 rounded hover:bg-red-50 text-mid-grey hover:text-red-600 transition-colors"
          title="Revert this change"
        >
          <Trash2 size={11} />
        </button>
      </li>
    )
  }

  const verbLabel = summary.verb === 'set'     ? '→' :
                    summary.verb === 'add'     ? 'added' :
                    summary.verb === 'remove'  ? 'removed' :
                    summary.verb === 'replace' ? 'replaced' : summary.verb

  // Brief 55 Part 5 (2026-05-26): per-patch field-level conflict.
  // When another enabled intervention edits the same field path, we
  // show the conflict context inline + a "Drop this edit" affordance.
  // `likelyArtefact` flags conflicts that look like legacy capture
  // artefacts (an intervention edits a field outside its concern, e.g.
  // "MVHR Bedrooms" carrying a heating share_pct edit) — the UI nudges
  // the user toward Drop rather than treating it as a real choice.
  const isConflict = conflict != null
  const isArtefact = !!conflict?.likelyArtefact

  const rowBg = isConflict
    ? (isArtefact ? 'bg-amber-50/60 hover:bg-amber-50' : 'bg-red-50/40 hover:bg-red-50/70')
    : 'hover:bg-off-white/40'

  return (
    <li className={`flex flex-col gap-0.5 px-2 py-1 text-xxs border-b border-light-grey/60 last:border-b-0 ${rowBg}`}>
      <div className="flex items-center gap-2">
        <span className="flex-shrink-0 min-w-[8rem] text-navy font-medium truncate">
          {summary.label}
        </span>
        <span className="flex-1 flex items-center gap-1.5 min-w-0">
          <span className="text-mid-grey truncate">{summary.before}</span>
          <span className="text-mid-grey/60 flex-shrink-0">{verbLabel}</span>
          <ToneText tone={summary.tone}>{summary.after}</ToneText>
          {summary.pct && (
            <span className={`flex-shrink-0 text-xxs ${
              summary.tone === 'good' ? 'text-green-700/70' :
              summary.tone === 'bad'  ? 'text-red-700/70'   : 'text-mid-grey/70'
            }`}>({summary.pct})</span>
          )}
        </span>
        <button
          type="button"
          onClick={() => onRevert(patch.id)}
          className={`flex-shrink-0 p-1 rounded transition-colors ${
            isConflict
              ? 'text-amber-700 hover:text-red-700 hover:bg-red-50 bg-amber-100/60'
              : 'hover:bg-red-50 text-mid-grey hover:text-red-600'
          }`}
          title={isConflict
            ? (isArtefact
                ? 'Drop this edit — likely a capture artefact (this intervention\'s label suggests its concern is elsewhere)'
                : 'Drop this edit — another intervention also sets this field')
            : 'Revert this change'}
          aria-label={isConflict ? `Drop conflicting edit: ${summary.label}` : `Revert ${summary.label}`}
        >
          <Trash2 size={11} />
        </button>
      </div>
      {/* Conflict context strip — visible only when this patch collides
          with a same-field edit in another enabled intervention. */}
      {isConflict && (
        <div className="flex items-center gap-1.5 pl-1 pt-0.5 pb-0.5 text-[10px]">
          <AlertTriangle size={10} className={isArtefact ? 'text-amber-600 flex-shrink-0' : 'text-red-600 flex-shrink-0'} />
          <span className={isArtefact ? 'text-amber-700' : 'text-red-700'}>
            {isArtefact
              ? <>Likely capture artefact — also set by <em>"{conflict.otherInterventionLabel}"</em> to <span className="tabular-nums font-medium">{String(conflict.otherValue)}</span> (last-write-wins). Drop unless this edit was intentional.</>
              : <>Same field also set by <em>"{conflict.otherInterventionLabel}"</em> to <span className="tabular-nums font-medium">{String(conflict.otherValue)}</span> — last-write-wins.</>
            }
          </span>
        </div>
      )}
    </li>
  )
}

export default function ChangeList({ baselineConfig, libraryData, patchConflicts }) {
  const capture = useInterventionCapture()
  // Outside the capture context (defensive — shouldn't happen since this
  // component is mounted by InterventionEditorPopout inside the provider):
  if (!capture?.isCapturing) return null

  const patches = Array.isArray(capture.currentPatches) ? capture.currentPatches : []
  const count = patches.length
  // Brief 55 Part 5: count of conflicts among CURRENT patches (the ones
  // the user is editing now). Shows as a chip next to the changes count.
  const conflicts = patchConflicts instanceof Map ? patchConflicts : null
  const conflictCount = conflicts
    ? patches.reduce((n, p) => n + (conflicts.has(p.id) ? 1 : 0), 0)
    : 0

  return (
    <div className="flex-shrink-0 border-t border-light-grey bg-white">
      <div className="flex items-center gap-2 px-3 py-1.5 border-b border-light-grey bg-off-white/40">
        <ListChecks size={12} style={{ color: INTERVENTIONS_ACCENT }} />
        <span className="text-xxs uppercase tracking-wider font-semibold text-navy">
          Changes
        </span>
        <span className="text-xxs text-mid-grey tabular-nums">
          ({count})
        </span>
        {conflictCount > 0 && (
          <span
            className="ml-1 inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-medium bg-amber-100 text-amber-800 border border-amber-200"
            title={`${conflictCount} field-level conflict${conflictCount === 1 ? '' : 's'} with other enabled interventions. Click the trash icon on a row to drop the unintended edit.`}
          >
            <AlertTriangle size={9} />
            {conflictCount} conflict{conflictCount === 1 ? '' : 's'}
          </span>
        )}
      </div>
      {count === 0 ? (
        <p className="text-xxs italic text-mid-grey/80 px-3 py-2">
          No changes yet. Edit any control on the right and it'll appear here as a captured change — with a revert button.
        </p>
      ) : (
        <ul
          className="max-h-40 overflow-y-auto"
          aria-label={`${count} captured changes`}
        >
          {patches.map(p => (
            <ChangeRow
              key={p.id}
              patch={p}
              baselineConfig={baselineConfig}
              libraryData={libraryData}
              onRevert={capture.revertPatch}
              conflict={conflicts ? conflicts.get(p.id) : null}
            />
          ))}
        </ul>
      )}
    </div>
  )
}
