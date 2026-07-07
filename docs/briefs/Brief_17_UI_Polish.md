# Brief 17: UI Polish — Project Landing, Camera Views, Typography & Sankey Naming

BEFORE DOING ANYTHING:
1. Read CLAUDE.md
2. Read STATUS.md
3. Read this ENTIRE brief before writing a single line of code
4. All parts can be verified together, then committed together. No need for separate commit cycles per part — these are small UI changes.

---

## VERIFICATION RULES

**Browser verification is mandatory.** Take screenshots, check console for errors. For this brief, combined verification is allowed — fix all parts, verify all at once, commit once.

---

## Context

Chris is polishing the UI after extensive testing. The tool is functionally strong but needs visual refinement: text is too pale, body text is too large in the side panels, section headers need visual weight, the Sankey labels are inconsistent with the facade naming convention, and the 3D viewer needs preset camera views instead of fighting auto-rotate.

8 parts. Can be committed together after combined verification.

---

## PART 1: Project landing page

**File(s):** `frontend/src/pages/HomePage.jsx` (rewrite), update `frontend/src/components/layout/Sidebar.jsx`, update `frontend/src/components/layout/TopBar.jsx`

**The N icon in the top-left sidebar** should navigate to a proper landing page — not just a welcome message but a project selector.

**Landing page layout:**

Header: "NZA Simulate" with the NZA branding

**Project cards grid:**
- Show all projects as cards (fetch from `GET /api/projects`)
- Each card shows:
  - Project name (bold)
  - Building dimensions summary: "50m × 15m × 4fl — 3,000 m² GIA"
  - Last modified date
  - Latest EUI if a simulation has been run: "EUI: 83 kWh/m²"
  - A small thumbnail or icon (building silhouette or the module colour)
- Click a card → loads the project and navigates to /building
- "New Project" card with a + icon → creates a new project

**Recent projects** at the top (last 3 accessed), then "All Projects" below.

**The TopBar project dropdown** should still work for switching projects while inside a module, but clicking the N icon in the sidebar always returns to this landing page.

**Commit message:** (combined with other parts)

---

## PART 2: Typography refresh — darker text, smaller body

**File(s):** `frontend/src/index.css`

**The core problem:** `text-mid-grey` (#95A5A6) is used everywhere for labels and body text, and it's too pale on a white/off-white background. The body text in the side panels is also too large for the density we need.

**Changes:**

1. **Darken `mid-grey`:** Change from `#95A5A6` to `#6B7280` (Tailwind's gray-500). This is noticeably darker and more readable while still being clearly secondary to navy headings.

2. **Darken `dark-grey`:** Change from `#58595B` to `#4B5563` (Tailwind's gray-600). Used for primary body text.

3. **Reduce body text in side panels:** Add a new utility class `text-panel` at `0.5625rem` (9px) for body text inside the left and right columns. This is smaller than `text-caption` (10px) and gives more breathing room.

4. **Keep chart/Sankey text at current sizes** — Chris likes the Sankey label size, so don't touch chart fonts.

5. **Section headings inside panels** should use `text-caption` (10px) with `font-semibold` — slightly larger than the panel body text, creating clear hierarchy.

**Updated scale for side panels:**
| Element | Size | Weight | Colour |
|---------|------|--------|--------|
| Section header | text-caption (10px) | font-semibold | module accent colour |
| Field label | text-panel (9px) | font-medium uppercase tracking-wider | mid-grey (#6B7280) |
| Body/value text | text-panel (9px) | font-normal | dark-grey (#4B5563) |
| Metric value | text-caption (10px) | font-semibold | navy |
| Hint/guidance | text-panel (9px) | font-normal | mid-grey |

---

## PART 3: Collapsible section headers with coloured banners

**File(s):** `frontend/src/components/modules/building/BuildingDefinition.jsx`, `frontend/src/components/modules/SystemsZones.jsx`

Replace the current plain uppercase grey section headers (e.g. "GEOMETRY", "GLAZING (WWR)", "FABRIC", "OCCUPANCY") with **collapsible banners** that have a coloured background and white text.

**Building module sections — use the warm earth accent (#A1887F):**

```jsx
function CollapsibleSection({ title, children, defaultOpen = true, accentColor = '#A1887F' }) {
  const [open, setOpen] = useState(defaultOpen)
  return (
    <div className="mb-2">
      <button
        onClick={() => setOpen(!open)}
        className="w-full flex items-center justify-between px-2.5 py-1.5 rounded text-left transition-colors"
        style={{ backgroundColor: accentColor }}
      >
        <span className="text-white text-panel font-semibold uppercase tracking-wider">{title}</span>
        <span className="text-white/70 text-xs">{open ? '▾' : '▸'}</span>
      </button>
      {open && (
        <div className="pt-2 pb-1">
          {children}
        </div>
      )}
    </div>
  )
}
```

**Building sections:** Geometry, Glazing, Fabric, Airtightness, Occupancy — all collapsible with warm earth banners.

**Systems sections:** Already have the accordion from Brief 13, but update the styling to use teal banners (#00AEEF) with white text instead of the current plain text + chevron.

**Profiles sections:** Use purple banners (#8B5CF6).

All sections default to **open** on first load. Collapsing is for when the user wants to hide completed sections to focus on one area.

---

## PART 4: Sankey facade naming — match F1/F2/F3/F4 convention

**File(s):** `frontend/src/components/modules/building/FabricSankey.jsx`, `frontend/src/utils/instantCalc.js`

**Change Sankey labels:**
- "Solar South" → "Glazing F3 (S)" (or whatever the actual compass direction is at the current orientation)
- "Solar East" → "Glazing F2 (E)"
- etc.
- "Solar Opaque" → split into "Wall Solar" and "Roof Solar" as separate nodes

**The labels should use the same `facadeLabel()` helper** used in the butterfly chart and WWR sliders, so they update dynamically with orientation.

**In the instant calc `gains_losses` and `systems_flow` outputs**, rename the solar keys:
- `solar_south` → `solar_f3` (the facade number is fixed; the compass direction is dynamic)
- etc.

The Sankey node label is then computed at render time: `Glazing ${facadeLabel(3, orientation)}` → "Glazing F3 (S)" at 0° or "Glazing F3 (N)" at 180°.

---

## PART 5: Window height scales with WWR

**File(s):** `frontend/src/components/modules/building/BuildingViewer3D.jsx`

At high WWR values (>80%), windows should fill more of the floor-to-floor height. At 100%, windows should cover the entire facade — full floor-to-ceiling curtain wall.

**Current:** Window height = 60% of floor height, sill at 20%. Fixed regardless of WWR.

**New behaviour:**
```js
// Window height scales with WWR above 80%
const baseWinHeightFraction = 0.6  // at WWR ≤ 80%
const baseSillFraction = 0.2

let winHeightFraction, sillFraction
if (wwr <= 0.8) {
  winHeightFraction = baseWinHeightFraction
  sillFraction = baseSillFraction
} else {
  // Scale from 60% height at 80% WWR to 95% height at 100% WWR
  const t = (wwr - 0.8) / 0.2  // 0 at 80%, 1 at 100%
  winHeightFraction = baseWinHeightFraction + t * (0.95 - baseWinHeightFraction)
  sillFraction = baseSillFraction * (1 - t * 0.9)  // sill shrinks toward zero
}
```

At 100% WWR: windows are 95% of floor height with a tiny 2% sill — essentially floor-to-ceiling glass.

At 50% WWR: windows are 60% height with normal 20% sill — standard punched windows.

---

## PART 6: Camera preset views

**File(s):** `frontend/src/components/modules/building/BuildingViewer3D.jsx`

Add preset camera view buttons to the 3D viewer toolbar.

**Buttons (add to the existing toolbar area):**

```
[⌖ Reset] [↻ Auto] [F1] [F2] [F3] [F4] [Iso]
```

- **F1 / F2 / F3 / F4:** Snap camera to face each facade directly, centred on the building. Camera distance auto-calculated to show the full facade. Show the facade label with compass direction: hovering F1 shows "Facade 1 (SE)" in a tooltip.
- **Iso:** Return to the default isometric 3/4 view (same as Reset but named more intuitively)
- **Auto-rotate: OFF by default.** The toggle is still there but starts disabled. Users can enable it if they want the slow rotation for presentations.

**Camera transition:** When clicking a preset, the camera should smoothly animate to the new position over 500ms (not snap instantly). Use a lerp on the camera position in the render loop, or use `@react-three/drei`'s camera transition utilities.

**Remove the current "Reset" button** — replace with "Iso" which does the same thing with a clearer name.

---

## PART 7: Auto-rotate default OFF

**File(s):** `frontend/src/components/modules/building/BuildingViewer3D.jsx`

Change auto-rotate from defaulting ON to defaulting OFF.

```js
const [autoRotateEnabled, setAutoRotate] = useState(false)  // was true
```

The toggle button stays in the toolbar for users who want it.

---

## PART 8: Combined verification

Verify ALL changes together:

1. **N icon → landing page:** Click the N icon → project cards visible. Click Bridgewater → loads project, navigates to /building.
2. **Typography:** Text is noticeably darker throughout. Body text in panels is smaller. Section headers are larger with coloured banners.
3. **Collapsible sections:** Click a section header (e.g. "Geometry") → it collapses. Click again → expands. White text on coloured banner.
4. **Sankey naming:** Energy Flow shows "Glazing F1 (SE)", "Glazing F3 (NW)" etc., not "Solar South". "Wall Solar" and "Roof Solar" as separate nodes.
5. **Window height:** Set a facade to 100% WWR → windows should nearly fill floor-to-ceiling. Set to 25% → normal punched window look.
6. **Camera views:** Click F1 → camera faces Facade 1. Click F3 → swings to opposite side. Click Iso → returns to 3/4 view. Smooth transitions.
7. **Auto-rotate OFF:** Building should NOT rotate on load. Toggle "Auto" → starts rotating. Toggle off → stops.
8. **Zero console errors**

**SCREENSHOTS:**
1. Landing page with project cards
2. Building module with collapsible coloured section headers
3. Sankey with F1/F2/F3/F4 naming
4. 100% WWR showing floor-to-ceiling glass
5. Camera facing F1 directly

**Commit message:** "Brief 17: UI polish — project landing, darker text, coloured headers, Sankey naming, camera presets, window height scaling"

---

## After all parts verified

Update STATUS.md. Push to GitHub.

Tell Chris: "Brief 17 complete. Project landing page with cards. Text darkened throughout — body text smaller in panels, section headers have coloured banners (warm earth for Building, teal for Systems, purple for Profiles). Sankey uses F1-F4 facade naming with dynamic compass. Windows scale to floor-to-ceiling at high WWR. Camera presets: F1/F2/F3/F4 snap to each facade with smooth transition. Auto-rotate off by default."
