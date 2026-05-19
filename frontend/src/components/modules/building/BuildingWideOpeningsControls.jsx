/**
 * BuildingWideOpeningsControls.jsx
 *
 * Three building-wide controls that drive wind-driven flow for **both**
 * permanent louvres (Building module) AND operable openings (Operation
 * module) under the unified flow_mode dispatch (Brief 33/34 → Brief 39 →
 * Brief 41):
 *
 *   1. Flow topology dropdown — `openings.flow_mode` ('single_sided' | 'cross')
 *   2. Discharge coefficient slider — `openings.cd` (0.15 – 0.65)
 *   3. Site exposure dropdown — `openings.site_exposure` ('sheltered' | 'normal' | 'exposed')
 *
 * Surfaced in two modules:
 *   - Building (`BuildingDefinition.jsx`) — canonical home, inside the
 *     "Permanent openings" section.
 *   - Operation (`OperationModule.jsx`) — at the top of the openings panel,
 *     above the "Add opening" buttons.
 *
 * Both consumers wire to the same `params.openings` via ProjectContext, so
 * a change in one module appears reactively in the other.
 *
 * Brief 41 Part 7 (2026-05-19) — factored out of the inline implementation
 * in BuildingDefinition.jsx (lines 817-902 pre-factor). Single source of
 * truth: no chance of UI drift between the two modules surfacing the same
 * inputs. (Companion rule: CLAUDE.md Rule 14 amendment on
 * mirror-correctness-vs-physics-correctness applies to UI too — two
 * implementations of the same control would have created exactly the
 * drift risk Rule 14 warns against.)
 */

import { cwProvenance } from '../../../utils/openingCoefficients.js'

const CD_ANCHORS = [
  { v: 0.25, label: 'Trickle vent', pct: 20, tip: '0.25 — trickle vent with mesh and flap (typical)' },
  { v: 0.40, label: 'Louvre',        pct: 50, tip: '0.40 — fixed louvre or grille (45° blades)' },
  { v: 0.60, label: 'Open window',   pct: 90, tip: '0.60 — open window or sharp-edged orifice' },
]

export default function BuildingWideOpeningsControls({ openings = {}, onChange }) {
  const flow_mode      = openings.flow_mode ?? 'single_sided'
  const cd             = typeof openings.cd === 'number' ? openings.cd : 0.25
  const site_exposure  = openings.site_exposure ?? 'normal'
  const cwp            = cwProvenance(site_exposure)

  return (
    <div className="space-y-3">
      {/* Flow topology */}
      <div>
        <label className="text-xxs text-mid-grey block mb-0.5">Flow topology</label>
        <select
          value={flow_mode}
          onChange={e => onChange({ flow_mode: e.target.value })}
          className="w-full px-2 py-1 text-xxs text-navy border border-light-grey rounded bg-white focus:outline-none focus:border-teal cursor-pointer"
          title="Which wind-driven correlation the Static engine uses for both permanent louvres and operable openings"
        >
          <option value="single_sided">Single-sided (one façade per room — BS EN 16798-7 §6.4)</option>
          <option value="cross">Cross-flow (wind-driven, openings on opposite façades)</option>
        </select>
        <p className="text-xxs text-mid-grey/70 mt-1 leading-tight">
          {flow_mode === 'single_sided' && (
            <>Single-sided: <code>Q ≈ 0.025 · A · v<sub>wind</sub></code>. BS EN 16798-7 §6.4 empirical correlation for one-façade openings or cellular layouts with no cross-flow path.</>
          )}
          {flow_mode === 'cross' && (
            <>Cross-flow: <code>Q = C<sub>d</sub> · A · √C<sub>w</sub> · v<sub>wind</sub></code>. Use when openings on opposite façades have an open internal air path (atrium, open plan).</>
          )}
        </p>
      </div>

      {/* C_d slider with anchor labels */}
      <div>
        <div className="flex items-baseline justify-between gap-2 mb-0.5">
          <label className="text-xxs text-mid-grey">C<sub>d</sub> (discharge coefficient)</label>
          <span className="text-xxs text-navy/70 tabular-nums">
            Current: <span className="font-semibold text-navy">{cd.toFixed(2)}</span>
          </span>
        </div>
        <input
          type="range" min={0.15} max={0.65} step={0.01}
          value={cd}
          onChange={e => onChange({ cd: Number(e.target.value) })}
          className="w-full h-[3px] accent-navy"
          title="Building-wide discharge coefficient applied to both permanent louvres and operable openings — see docs/audit/29_permanent_vent_methodology.md"
        />
        {/* Anchor labels at 0.25 / 0.40 / 0.60 → positions 20% / 50% / 90%
            of the 0.15-0.65 slider range. Hover for usage notes. */}
        <div className="relative h-7 mt-0.5 text-xxs text-mid-grey/80">
          {CD_ANCHORS.map(a => (
            <span
              key={a.v}
              className="absolute -translate-x-1/2 cursor-help text-center leading-tight"
              style={{ left: `${a.pct}%` }}
              title={a.tip}
            >
              <span className="tabular-nums">{a.v.toFixed(2)}</span>
              <span className="block">{a.label}</span>
            </span>
          ))}
        </div>
      </div>

      {/* Site exposure */}
      <div>
        <div className="flex items-baseline justify-between gap-2 mb-0.5">
          <label className="text-xxs text-mid-grey">Site exposure</label>
          <span
            className="text-xxs text-navy/70 tabular-nums cursor-help"
            title={`C_w = ${cwp.text}`}
          >
            C<sub>w</sub> = <span className="font-semibold text-navy">{cwp.cw.toFixed(2)}</span>
          </span>
        </div>
        <select
          value={site_exposure}
          onChange={e => onChange({ site_exposure: e.target.value })}
          className="w-full px-2 py-1 text-xxs text-navy border border-light-grey rounded bg-white focus:outline-none focus:border-teal cursor-pointer"
          title="Wind-pressure coefficient: sheltered = 0.05, normal = 0.10, exposed = 0.20"
        >
          <option value="sheltered">Sheltered</option>
          <option value="normal">Normal</option>
          <option value="exposed">Exposed</option>
        </select>
      </div>
    </div>
  )
}
