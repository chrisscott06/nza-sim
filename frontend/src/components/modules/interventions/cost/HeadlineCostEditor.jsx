/**
 * HeadlineCostEditor.jsx — Brief 90 (Brief B) Part 4: the NRM2 Headline 6-line
 * cost editor (Applemore "Summary Interventions" structure).
 *
 * The three derived lines (design, project delivery, contingency) can be filled
 * from the project defaults (% of the works lines) via "Fill from defaults", then
 * any line is directly editable. Live total. No fabricated rates — lines start
 * empty (£0) until the user enters them or Applemore seeds are ingested.
 */
import { HEADLINE_LINES } from '../../../../data/costLibrary.js'
import { computeHeadlineTotal, deriveHeadlineLines } from '../../../../utils/costModel.js'

const gbp = n => `£${Math.round(Number(n) || 0).toLocaleString('en-GB')}`

export default function HeadlineCostEditor({ headline, projectDefaults, onChange }) {
  const total = computeHeadlineTotal(headline)

  const setLine = (key, raw) => {
    const v = raw === '' ? null : Number(raw)
    onChange({ ...headline, [key]: Number.isFinite(v) ? v : null })
  }
  const fillDefaults = () => onChange({ ...headline, ...deriveHeadlineLines(headline, projectDefaults) })

  return (
    <div className="rounded-lg border border-light-grey/70 bg-white px-3 py-2.5">
      <div className="flex items-center justify-between mb-1.5">
        <div className="text-xxs uppercase tracking-wider text-mid-grey/70 font-semibold">
          Cost · NRM2 headline
        </div>
        <button
          type="button"
          onClick={fillDefaults}
          className="text-xxs font-semibold text-navy/70 hover:text-navy underline decoration-dotted"
          title="Fill design, delivery & contingency from project % defaults"
        >
          Fill % lines from defaults
        </button>
      </div>
      <table className="w-full text-xs">
        <tbody>
          {HEADLINE_LINES.map(({ key, label, derived }) => (
            <tr key={key} className="border-t border-light-grey/40 first:border-0">
              <td className="py-1 pr-2 text-mid-grey">
                {label}
                {derived && <span className="ml-1 text-xxs text-mid-grey/40">(derived)</span>}
              </td>
              <td className="py-1 text-right w-32">
                <span className="text-mid-grey/40 mr-0.5">£</span>
                <input
                  type="number" min={0} step={100}
                  value={headline?.[key] ?? ''}
                  onChange={e => setLine(key, e.target.value)}
                  placeholder="0"
                  className="w-24 px-1 py-0.5 text-right tabular-nums border border-light-grey rounded focus:outline-none focus:border-mid-grey"
                />
              </td>
            </tr>
          ))}
          <tr className="border-t-2 border-light-grey">
            <td className="py-1.5 pr-2 font-semibold text-navy">Total cost</td>
            <td className="py-1.5 text-right font-semibold text-navy tabular-nums">{gbp(total)}</td>
          </tr>
        </tbody>
      </table>
      <p className="text-xxs text-mid-grey/45 mt-1.5">
        Direct £ entry per line. Type-default rates (Applemore) will pre-fill these once the cost plan is ingested.
      </p>
    </div>
  )
}
