/**
 * SystemEditorPopout.jsx — Brief 42 Part 3 (2026-05-20)
 *
 * Draggable pop-out for the per-system editor. Reuses the Brief 37
 * `SchedulePopout` chrome (proven pattern; same shape as Brief 41's
 * `InterventionEditorPopout`). localStorage position key:
 * `nza-system-editor-popout-position`.
 *
 * Body content is the refactored `SystemEditorCard` (Brief 42 Part 3
 * — building-level field groups removed; only system-level fields
 * remain). The pop-out lets the editor live at a wider, less cramped
 * size than the ~300px left panel allowed.
 *
 * Wiring:
 *   - `system` is the per-system entry from
 *     `params.systems_config_v40.{service}[idx]`
 *   - `engineSystem` is the corresponding row from
 *     `consumption.brief40.{service}.systems[i]`
 *   - `onUpdate(patch)` merges into the per-system entry (parent
 *     wires to writeV40)
 *   - `onClose` closes the pop-out (no separate Save/Cancel — edits
 *     are committed inline via onUpdate; same pattern as the
 *     existing inline-expand SystemEditorCard from Brief 40 Part 3)
 */

import SchedulePopout from '../../shared/SchedulePopout.jsx'
import SystemEditorCard, { SERVICE_COLOURS } from './SystemEditorCard.jsx'

export default function SystemEditorPopout({
  system,
  engineSystem,
  comfortBand,
  onUpdate,
  onDelete,
  onSaveToLibrary,
  openScheduleEditor,
  shareInvalid,
  onClose,
}) {
  const isOpen = !!system
  const service = system?.service ?? 'heating'
  const accent = SERVICE_COLOURS[service] ?? '#00AEEF'

  return (
    <SchedulePopout
      isOpen={isOpen}
      onClose={onClose}
      title={`Editing system: ${system?.label ?? '(unnamed)'}`}
      accent={accent}
      persistKey="nza-system-editor-popout-position"
    >
      <div className="p-3">
        {system && (
          <SystemEditorCard
            system={system}
            engineSystem={engineSystem}
            comfortBand={comfortBand}
            expanded={true}                /* always-expanded in pop-out */
            onToggleExpanded={onClose}     /* clicking the collapse chevron closes the pop-out */
            onUpdate={onUpdate}
            onDelete={() => {
              onDelete?.()
              onClose?.()
            }}
            onSaveToLibrary={onSaveToLibrary}
            openScheduleEditor={openScheduleEditor}
            shareInvalid={shareInvalid}
          />
        )}
      </div>
    </SchedulePopout>
  )
}
