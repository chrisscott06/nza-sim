/**
 * MiniProfile.jsx — read-only thumbnail of a schedule's weekday curve.
 *
 * Brief 27 Revised Part 7. Used in left-panel sections after the
 * ScheduleEditor moves to the centre canvas. Visual cue for "what's
 * the rough shape of this schedule" without needing the full editor.
 *
 * Renders a horizontal row of 24 mini-bars proportional to the weekday
 * curve's hourly fractions, with the gain accent colour. Click anywhere
 * fires `onEdit` so users can jump to the centre-canvas editor without
 * having to click the bigger "Edit schedule →" link.
 */

export default function MiniProfile({ schedule, accent, onEdit, label = 'Weekday' }) {
  const values = schedule?.weekday ?? new Array(24).fill(0)
  const empty = values.every(v => v === 0)

  return (
    <button
      type="button"
      onClick={onEdit}
      className="w-full block group focus:outline-none"
      title={onEdit ? 'Click to edit in centre canvas' : undefined}
    >
      <div className="flex items-center justify-between text-xxs text-mid-grey mb-1">
        <span>{label}</span>
        {onEdit && (
          <span className="text-mid-grey/70 group-hover:text-navy transition-colors">
            Edit →
          </span>
        )}
      </div>
      <div className="relative h-8 bg-off-white border border-light-grey rounded overflow-hidden">
        <div className="absolute inset-0 flex">
          {values.map((v, i) => (
            <div key={i} className="flex-1 flex flex-col-reverse">
              <div
                style={{
                  height: `${v * 100}%`,
                  backgroundColor: accent,
                  opacity: 0.75,
                }}
              />
            </div>
          ))}
        </div>
        {empty && (
          <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
            <span className="text-xxs italic text-mid-grey/70">No schedule set</span>
          </div>
        )}
      </div>
    </button>
  )
}
