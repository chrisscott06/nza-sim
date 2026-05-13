import { useRef, useMemo, useState, Suspense, Component } from 'react'
import { Canvas, useFrame, useLoader } from '@react-three/fiber'
import { OrbitControls, Environment, Sky, useTexture, Edges, ContactShadows, Billboard, Text } from '@react-three/drei'
import * as THREE from 'three'
import { getSolarRadiation, SOLAR_BY_COMPASS } from '../../../utils/instantCalc.js'

/* ── Facade label helper ────────────────────────────────────────────────────── */
// F1=north (0°), F2=east (90°), F3=south (180°), F4=west (270°)
function facadeLabel(facadeNumber, orientationDeg) {
  const baseAngles = { 1: 0, 2: 90, 3: 180, 4: 270 }
  const trueAngle = (baseAngles[facadeNumber] + (orientationDeg ?? 0)) % 360
  const directions = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW']
  const compass = directions[Math.round(trueAngle / 45) % 8]
  return `F${facadeNumber} (${compass})`
}

/* ── Architectural material palette — clean grey massing model ─────────────── */
const COLORS = {
  wall:        '#EBEBEB',  // clean light grey wall (brief Part 1 fix)
  roof:        '#D8D8D8',  // slightly darker than walls
  // Glass tuned for legibility against the white walls. Previously '#A8C8E0'
  // (pale blue-grey) with opacity 0.35 — the wall colour bled through and
  // washed it out, leaving the window hard to read at high WWR. Now a more
  // saturated architectural blue at higher opacity so the glazing reads as
  // a clear feature on the facade.
  glazing:     '#5E94C2',
  floorLine:   '#BBBBBB',  // floor band line
  groundPlane: '#E0E0E0',  // off-white ground
  // Frame lightened from '#B0B0B0' so it doesn't outweigh the glass —
  // sits between wall and roof tone, reads as a thin reveal rather than
  // a feature in its own right.
  frame:       '#D8D8D8',
  basePlate:   '#E4E4E4',  // base platform — slightly darker than wall
  edges:       '#888888',  // soft edge lines
}

/* ── Solar tint helper ─────────────────────────────────────────────────────── */
const SOLAR_MIN = 350  // N
const SOLAR_MAX = 750  // S
const COOL_COLOR = new THREE.Color('#A8C4D0')  // cool grey-blue for low-solar faces
const WARM_COLOR = new THREE.Color('#D4883A')  // warm amber for high-solar faces
const BASE_COLOR = new THREE.Color('#EBEBEB')  // matches COLORS.wall — used for solar tint blending

function solarFaceColor(facadeLabel, orientationDeg, enabled) {
  if (!enabled) return COLORS.wall
  const solar = getSolarRadiation(facadeLabel, orientationDeg)
  const t = Math.max(0, Math.min(1, (solar - SOLAR_MIN) / (SOLAR_MAX - SOLAR_MIN)))
  const tint = COOL_COLOR.clone().lerp(WARM_COLOR, t)
  // Blend 55% base wall, 45% tint — subtle effect
  return '#' + BASE_COLOR.clone().lerp(tint, 0.45).getHexString()
}

/* ── Building geometry from params ────────────────────────────────────────── */
function Building({ params, solarOverlay, onFacadeHover }) {
  const { length, width, num_floors, floor_height, wwr, window_count, orientation } = params

  const totalHeight = num_floors * floor_height

  // Axis convention:
  //   X axis = length (east-west) → building's LONG dimension
  //   Z axis = width  (north-south) → building's SHORT dimension
  //   -Z face = North (60m wide for HIX), +X face = East (15m wide for HIX)
  //
  // Why -Z (and not +Z) is north: Three.js is Y-up. Looking straight down
  // at the ground, you want north at the top of the screen and east on the
  // right. With Y-up and a right-handed coordinate system, that pairing
  // forces north to be along -Z (the "into the screen" direction in the
  // default camera). Choosing +Z = north (as the file previously did) made
  // the top-down plan view chirality-flipped — east ended up on the left,
  // or north ended up not at the top, depending on how the camera was
  // oriented.
  //
  // The simulation side (geometry.py) uses Z-up with +Y = north — that's
  // unchanged. The viewer-to-sim mapping is via facade NAME ("north",
  // "south", "east", "west"), not axis sign, so the viewer is free to
  // pick whichever Three.js convention renders cleanly.
  //
  // Brief 26 Part 2.5 fixed the dimension assignment (X=length, Z=width
  // — was X=width / Z=length before, which made the north face render
  // short and produced the F3>F2 solar magnitude bug). The sign flip
  // here is a separate refinement on top of that.
  const halfL = length / 2   // half-extent along X
  const halfW = width / 2    // half-extent along Z

  // Individual window panels per facade — with recessed reveal frames
  // Window height scales with WWR: at ≤80% use 60% height; above 80% scale up to 95% at 100%
  const GlassFace = useMemo(() => {
    return function GlassFaceInner({ axis, sign, wwr: wwrFace, faceW, count }) {
      if (!wwrFace || wwrFace < 0.01) return null

      // Defensive cap — at 5 meshes/window × num_floors a stray count of
      // 100+ overwhelms Three.js. The input UI caps at MAX_WINDOWS_PER_FACADE,
      // but old projects may have persisted higher values.
      const n = Math.min(40, Math.max(1, Math.round(count ?? 4)))

      // Scale window height with WWR above 80%
      let winHeightFraction, sillFrac
      if (wwrFace <= 0.8) {
        winHeightFraction = 0.6
        sillFrac          = 0.2
      } else {
        const t           = (wwrFace - 0.8) / 0.2          // 0 at 80%, 1 at 100%
        winHeightFraction = 0.6 + t * (0.95 - 0.6)
        sillFrac          = 0.2 * (1 - t * 0.9)
      }
      const winH  = floor_height * winHeightFraction
      const winY0 = floor_height * sillFrac

      const totalGlaz = faceW * wwrFace
      const winW  = totalGlaz / n
      const gap   = (faceW - totalGlaz) / (n + 1)

      // Reveal frame constants
      const FW = Math.max(0.04, Math.min(0.08, winW * 0.12))  // frame strip width 40–80mm
      const FD = 0.08  // reveal depth — frame protrudes 80mm outward from wall surface

      // Wall face distance from origin along the perpendicular axis
      // axis='z' (N/S face perpendicular to Z): wall at z = ±halfW = ±width/2
      // axis='x' (E/W face perpendicular to X): wall at x = ±halfL = ±length/2
      const wallFace  = axis === 'z' ? halfW : halfL
      // Centre of the frame box (half FD out from wall surface, in the outward direction)
      const frameCtr  = sign * (wallFace + FD / 2)
      // Glass sits just 10mm in front of wall surface (inside the frame reveal)
      const glassFace = sign * (wallFace + 0.01)

      const panels = []

      for (let f = 0; f < num_floors; f++) {
        const cy = f * floor_height + winY0 + winH / 2

        for (let w = 0; w < n; w++) {
          const along = -faceW / 2 + gap + w * (winW + gap) + winW / 2
          const gw    = winW * 0.95  // glass width (5% narrower than the opening)

          // Helper: build [x,y,z] from the 'along' (facade-parallel) and perpendicular coords
          const p = (al, yy, perp) =>
            axis === 'z' ? [al, yy, perp] : [perp, yy, al]

          // Frame box sizes: horizontal (top/bot) and vertical (left/right) strips
          const hArgs = axis === 'z' ? [gw + 2 * FW, FW, FD] : [FD, FW, gw + 2 * FW]
          const vArgs = axis === 'z' ? [FW, winH, FD]         : [FD, winH, FW]

          panels.push(
            <group key={`${f}-${w}`}>
              {/* Glass panel — sits at wall surface level, inside the reveal frame.
                  Opacity 0.55 (was 0.35) + lower reflectivity so the blue tint
                  dominates rather than the white wall bleeding through. */}
              <mesh
                castShadow receiveShadow
                position={p(along, cy, glassFace)}
                rotation={axis === 'z' ? [0, 0, 0] : [0, Math.PI / 2, 0]}
              >
                <planeGeometry args={[gw, winH]} />
                <meshPhysicalMaterial
                  color={COLORS.glazing}
                  roughness={0.12}
                  metalness={0.05}
                  transparent
                  opacity={0.55}
                  reflectivity={0.35}
                  side={THREE.DoubleSide}
                />
              </mesh>

              {/* Reveal frame — 4 dark strips protruding outward from wall face */}
              {/* Top bar */}
              <mesh castShadow receiveShadow position={p(along, cy + winH / 2 + FW / 2, frameCtr)}>
                <boxGeometry args={hArgs} />
                <meshStandardMaterial color={COLORS.frame} roughness={0.55} metalness={0.05} />
              </mesh>
              {/* Bottom bar */}
              <mesh castShadow receiveShadow position={p(along, cy - winH / 2 - FW / 2, frameCtr)}>
                <boxGeometry args={hArgs} />
                <meshStandardMaterial color={COLORS.frame} roughness={0.55} metalness={0.05} />
              </mesh>
              {/* Left bar */}
              <mesh castShadow receiveShadow position={p(along - gw / 2 - FW / 2, cy, frameCtr)}>
                <boxGeometry args={vArgs} />
                <meshStandardMaterial color={COLORS.frame} roughness={0.55} metalness={0.05} />
              </mesh>
              {/* Right bar */}
              <mesh castShadow receiveShadow position={p(along + gw / 2 + FW / 2, cy, frameCtr)}>
                <boxGeometry args={vArgs} />
                <meshStandardMaterial color={COLORS.frame} roughness={0.55} metalness={0.05} />
              </mesh>
            </group>
          )
        }
      }
      return <>{panels}</>
    }
  }, [num_floors, floor_height, halfL, halfW])

  // Floor-line edges for depth — vertices on the building footprint corners.
  // X spans ±halfL (length axis), Z spans ±halfW (width axis).
  const floorLines = useMemo(() => {
    const lines = []
    for (let f = 1; f < num_floors; f++) {
      const y = f * floor_height
      const pts = [
        new THREE.Vector3(-halfL, y, -halfW),
        new THREE.Vector3( halfL, y, -halfW),
        new THREE.Vector3( halfL, y,  halfW),
        new THREE.Vector3(-halfL, y,  halfW),
        new THREE.Vector3(-halfL, y, -halfW),
      ]
      const geom = new THREE.BufferGeometry().setFromPoints(pts)
      lines.push(<line key={f} geometry={geom}>
        <lineBasicMaterial color={COLORS.floorLine} opacity={0.5} transparent />
      </line>)
    }
    return lines
  }, [num_floors, floor_height, halfL, halfW])

  // Facade metadata for hover tooltip (BoxGeometry materialIndex order: +X,-X,+Y,-Y,+Z,-Z)
  // Axis convention: X=length, Z=width, -Z = north (see top-of-file comment).
  //   North/South faces (perpendicular to Z) span X = length → LONG (60m for HIX)
  //   East/West faces  (perpendicular to X) span Z = width  → SHORT (15m for HIX)
  // F1=north, F2=east, F3=south, F4=west (compass label rotates with orientation)
  const facadeMap = [
    { label: facadeLabel(2, orientation), key: 'east',  faceW: width,  area: width  * totalHeight, wwrVal: wwr.east  },  // +X
    { label: facadeLabel(4, orientation), key: 'west',  faceW: width,  area: width  * totalHeight, wwrVal: wwr.west  },  // -X
    null,  // +Y top — not a facade
    null,  // -Y bottom
    { label: facadeLabel(3, orientation), key: 'south', faceW: length, area: length * totalHeight, wwrVal: wwr.south },  // +Z
    { label: facadeLabel(1, orientation), key: 'north', faceW: length, area: length * totalHeight, wwrVal: wwr.north },  // -Z
  ]

  return (
    <group position={[0, 0, 0]}>
      {/* Main building box — per-face solar tint (BoxGeometry face order: +X,-X,+Y,-Y,+Z,-Z) */}
      <mesh
        position={[0, totalHeight / 2, 0]}
        castShadow
        receiveShadow
        onPointerEnter={e => {
          e.stopPropagation()
          const face = facadeMap[e.face?.materialIndex]
          if (face && onFacadeHover) {
            const glazArea = Math.round(face.area * face.wwrVal)
            const solar    = getSolarRadiation(face.key, orientation)
            onFacadeHover({ label: face.label, area: Math.round(face.area), glazArea, wwr: Math.round(face.wwrVal * 100), solar })
          }
        }}
        onPointerLeave={() => onFacadeHover?.(null)}
      >
        <boxGeometry args={[length, totalHeight, width]} />
        {/* +X = East */}
        <meshStandardMaterial attach="material-0" color={solarFaceColor('east',  orientation, solarOverlay)} roughness={0.9} metalness={0} />
        {/* -X = West */}
        <meshStandardMaterial attach="material-1" color={solarFaceColor('west',  orientation, solarOverlay)} roughness={0.9} metalness={0} />
        {/* +Y = Top (roof) */}
        <meshStandardMaterial attach="material-2" color={COLORS.roof} roughness={0.85} metalness={0} />
        {/* -Y = Bottom */}
        <meshStandardMaterial attach="material-3" color={COLORS.wall} roughness={0.9} metalness={0} />
        {/* +Z = South */}
        <meshStandardMaterial attach="material-4" color={solarFaceColor('south', orientation, solarOverlay)} roughness={0.9} metalness={0} />
        {/* -Z = North */}
        <meshStandardMaterial attach="material-5" color={solarFaceColor('north', orientation, solarOverlay)} roughness={0.9} metalness={0} />
        <Edges color={COLORS.edges} threshold={15} />
      </mesh>

      {/* Roof cap — slightly wider for overhang effect */}
      <mesh position={[0, totalHeight + 0.05, 0]} castShadow receiveShadow>
        <boxGeometry args={[length + 0.4, 0.2, width + 0.4]} />
        <meshStandardMaterial color={COLORS.roof} roughness={0.85} metalness={0} />
        <Edges color={COLORS.edges} threshold={15} />
      </mesh>

      {/* Base plate — raised platform extending 2m beyond footprint on all sides */}
      <mesh position={[0, -0.15, 0]} receiveShadow>
        <boxGeometry args={[length + 4, 0.3, width + 4]} />
        <meshStandardMaterial color={COLORS.basePlate} roughness={0.95} metalness={0} />
        <Edges color={COLORS.edges} threshold={15} />
      </mesh>

      {/* Floor lines */}
      {floorLines}

      {/* Glazing — North face (negative Z, per axis convention). N/S faces are LONG: span X = length. */}
      <GlassFace axis="z" sign={-1} wwr={wwr.north} faceW={length} count={window_count?.north ?? 8} />
      {/* Glazing — South face (positive Z) */}
      <GlassFace axis="z" sign={1}  wwr={wwr.south} faceW={length} count={window_count?.south ?? 8} />
      {/* Glazing — East face (positive X). E/W faces are SHORT: span Z = width. */}
      <GlassFace axis="x" sign={1}  wwr={wwr.east}  faceW={width}  count={window_count?.east  ?? 3} />
      {/* Glazing — West face (negative X) */}
      <GlassFace axis="x" sign={-1} wwr={wwr.west}  faceW={width}  count={window_count?.west  ?? 3} />

      {/* Per-window shading reveals — 4-edge frames extruding outward by
          shading_overhang.depth_m for each facade. Mirrors GlassFace
          window-placement maths so frames line up exactly. */}
      <WindowShadingFrames
        axis="z" sign={-1} wwr={wwr.north} faceW={length} count={window_count?.north ?? 8}
        depth={Number((params?.shading_overhang?.north ?? {}).depth_m ?? 0)}
        floor_height={floor_height} num_floors={num_floors} halfL={halfL} halfW={halfW}
      />
      <WindowShadingFrames
        axis="z" sign={1}  wwr={wwr.south} faceW={length} count={window_count?.south ?? 8}
        depth={Number((params?.shading_overhang?.south ?? {}).depth_m ?? 0)}
        floor_height={floor_height} num_floors={num_floors} halfL={halfL} halfW={halfW}
      />
      <WindowShadingFrames
        axis="x" sign={1}  wwr={wwr.east}  faceW={width}  count={window_count?.east ?? 3}
        depth={Number((params?.shading_overhang?.east ?? {}).depth_m ?? 0)}
        floor_height={floor_height} num_floors={num_floors} halfL={halfL} halfW={halfW}
      />
      <WindowShadingFrames
        axis="x" sign={-1} wwr={wwr.west}  faceW={width}  count={window_count?.west ?? 3}
        depth={Number((params?.shading_overhang?.west ?? {}).depth_m ?? 0)}
        floor_height={floor_height} num_floors={num_floors} halfL={halfL} halfW={halfW}
      />
    </group>
  )
}

/* ── Per-window shading frames ─────────────────────────────────────────────
   Renders a 4-edge "tube" around every window on a facade, extruding
   outward by `depth` m. Effectively a deep window reveal — the
   simplest representation of brise soleil where the user just dials
   one depth per facade. Same axis/sign convention as GlassFace.
*/
function WindowShadingFrames({
  axis, sign, wwr, faceW, count, depth,
  floor_height, num_floors, halfL, halfW,
}) {
  if (!depth || depth < 0.01) return null
  if (!wwr || wwr < 0.01) return null

  const n = Math.max(1, Math.round(count ?? 4))

  // Same window sizing as GlassFace
  let winHeightFraction, sillFrac
  if (wwr <= 0.8) {
    winHeightFraction = 0.6
    sillFrac          = 0.2
  } else {
    const t = (wwr - 0.8) / 0.2
    winHeightFraction = 0.6 + t * (0.95 - 0.6)
    sillFrac          = 0.2 * (1 - t * 0.9)
  }
  const winH  = floor_height * winHeightFraction
  const winY0 = floor_height * sillFrac

  const totalGlaz = faceW * wwr
  const winW = totalGlaz / n
  const gap  = (faceW - totalGlaz) / (n + 1)

  // Wall surface offset from origin along the perpendicular axis.
  // Axis convention (Brief 26 Part 2.5 — matches EP + live calc):
  //   X = length (east-west), Z = width (north-south)
  //   axis='z' (N/S faces, perpendicular to Z): wall at z = ±width/2  = ±halfW
  //   axis='x' (E/W faces, perpendicular to X): wall at x = ±length/2 = ±halfL
  const wallFace = axis === 'z' ? halfW : halfL

  // Slab thickness — 4 cm reads as architectural detail
  const T = 0.04

  // Frame depth — extends outward from the wall by `depth` m
  // Centre of slab is at wallFace + depth/2 perpendicular to facade
  const perpCentre = sign * (wallFace + depth / 2)

  // Helper: build [x,y,z] from facade-parallel `along`, vertical `yy`, and perp coord
  const p = (along, yy, perp) => axis === 'z' ? [along, yy, perp] : [perp, yy, along]

  // Box args helper — primary axis along facade, depth perpendicular, vertical
  // For axis='z': [facade_w, vertical, depth]
  // For axis='x': [depth, vertical, facade_w]
  const sideArgs = (alongLen, vertLen) => axis === 'z'
    ? [alongLen, vertLen, depth]
    : [depth,    vertLen, alongLen]

  const frames = []

  for (let f = 0; f < num_floors; f++) {
    const cy = f * floor_height + winY0 + winH / 2  // window centre y

    for (let w = 0; w < n; w++) {
      const along = -faceW / 2 + gap + w * (winW + gap) + winW / 2
      const halfW = winW / 2

      // Top slab — sits at window head, full window width
      frames.push(
        <mesh
          key={`${f}-${w}-top`}
          castShadow receiveShadow
          position={p(along, cy + winH / 2 + T / 2, perpCentre)}
        >
          <boxGeometry args={sideArgs(winW + 2 * T, T)} />
          <meshStandardMaterial color={SHADING_COLOUR} roughness={0.85} metalness={0.05} />
        </mesh>
      )
      // Bottom slab
      frames.push(
        <mesh
          key={`${f}-${w}-bot`}
          castShadow receiveShadow
          position={p(along, cy - winH / 2 - T / 2, perpCentre)}
        >
          <boxGeometry args={sideArgs(winW + 2 * T, T)} />
          <meshStandardMaterial color={SHADING_COLOUR} roughness={0.85} metalness={0.05} />
        </mesh>
      )
      // Left fin
      frames.push(
        <mesh
          key={`${f}-${w}-left`}
          castShadow receiveShadow
          position={p(along - halfW - T / 2, cy, perpCentre)}
        >
          <boxGeometry args={sideArgs(T, winH)} />
          <meshStandardMaterial color={SHADING_COLOUR} roughness={0.85} metalness={0.05} />
        </mesh>
      )
      // Right fin
      frames.push(
        <mesh
          key={`${f}-${w}-right`}
          castShadow receiveShadow
          position={p(along + halfW + T / 2, cy, perpCentre)}
        >
          <boxGeometry args={sideArgs(T, winH)} />
          <meshStandardMaterial color={SHADING_COLOUR} roughness={0.85} metalness={0.05} />
        </mesh>
      )
    }
  }
  return <>{frames}</>
}

// Shading slabs deepened from '#9CA3AF' (very pale steel) to a slightly
// darker mid-grey so reveals and overhangs read clearly even at small
// depths. Still architectural-neutral; not so dark that 1m brise soleil
// looks like a concrete canopy.
const SHADING_COLOUR = '#7C8694'

/* ── Facade labels — billboard sprites at face centroids ─────────────────────
   Position is in the building's LOCAL coordinate system (rendered inside the
   rotated <group>), so each label tracks its face as the building turns.
   Billboard wrapper keeps text upright and readable from any camera angle.

   Label content per facade:
     Line 1:  "F1 — NE"            (large, bold-feel via outline)
     Line 2:  "60m × 12.8m · 768 m²"
     Line 3:  "WWR 0% · az 42°"    (the facade's true azimuth, not building orient)
*/
function FacadeLabels({ length, width, num_floors, floor_height, wwr, orientation, halfL, halfW }) {
  const totalHeight = num_floors * floor_height
  const midH = totalHeight / 2
  const labelOffset = 1.0  // metres from wall surface outward (keeps text off the face)

  const baseAngles = { 1: 0, 2: 90, 3: 180, 4: 270 }
  const directions = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW']

  // Axis convention: X = length, Z = width, -Z = north (see Building's
  // top-of-component comment for why).
  //   N face (-Z) is at z = -halfW, perpendicular to Z, spans X = length → LONG
  //   E face (+X) is at x = +halfL, perpendicular to X, spans Z = width  → SHORT
  const facades = [
    { num: 1, key: 'north', pos: [0, midH, -(halfW + labelOffset)], faceW: length, faceH: totalHeight, area: length * totalHeight },
    { num: 2, key: 'east',  pos: [ halfL + labelOffset, midH, 0],   faceW: width,  faceH: totalHeight, area: width  * totalHeight },
    { num: 3, key: 'south', pos: [0, midH,  halfW + labelOffset],   faceW: length, faceH: totalHeight, area: length * totalHeight },
    { num: 4, key: 'west',  pos: [-(halfL + labelOffset), midH, 0], faceW: width,  faceH: totalHeight, area: width  * totalHeight },
  ]

  // Font size scales with the smaller of halfL/halfW so labels stay readable
  // on small projects and don't dominate large ones.
  const fontSize = Math.max(0.6, Math.min(halfL, halfW) * 0.18)
  const lineGap  = fontSize * 1.1

  return (
    <group>
      {facades.map(fac => {
        const trueAngle = (baseAngles[fac.num] + (orientation ?? 0)) % 360
        const compass = directions[Math.round(trueAngle / 45) % 8]
        const wwrPct = Math.round((wwr[fac.key] ?? 0) * 100)
        const azimuth = Math.round(trueAngle)
        return (
          <Billboard key={fac.num} position={fac.pos}>
            {/* Line 1 — F# and compass, larger */}
            <Text
              fontSize={fontSize * 1.4}
              color="#0b1640"
              outlineColor="#ffffff"
              outlineWidth={fontSize * 0.06}
              anchorX="center"
              anchorY="middle"
              position={[0, lineGap, 0]}
            >
              {`F${fac.num} — ${compass}`}
            </Text>
            {/* Line 2 — dimensions and area */}
            <Text
              fontSize={fontSize * 0.85}
              color="#2a3550"
              outlineColor="#ffffff"
              outlineWidth={fontSize * 0.04}
              anchorX="center"
              anchorY="middle"
              position={[0, 0, 0]}
            >
              {`${fac.faceW.toFixed(0)}m × ${fac.faceH.toFixed(1)}m · ${Math.round(fac.area)} m²`}
            </Text>
            {/* Line 3 — WWR and azimuth */}
            <Text
              fontSize={fontSize * 0.75}
              color="#4a5570"
              outlineColor="#ffffff"
              outlineWidth={fontSize * 0.04}
              anchorX="center"
              anchorY="middle"
              position={[0, -lineGap * 0.9, 0]}
            >
              {`WWR ${wwrPct}% · az ${azimuth}°`}
            </Text>
          </Billboard>
        )
      })}
    </group>
  )
}

/* ── Orientation indicator — thin compass needle on ground ─────────────────── */
function OrientationIndicator({ orientation }) {
  const rad = (orientation * Math.PI) / 180
  const len = 8
  const nx = Math.sin(rad) * len
  const nz = -Math.cos(rad) * len

  const pts = [new THREE.Vector3(0, 0.05, 0), new THREE.Vector3(nx, 0.05, nz)]
  const geom = useMemo(() => new THREE.BufferGeometry().setFromPoints(pts), [nx, nz])

  return (
    <group>
      <line geometry={geom}>
        <lineBasicMaterial color="#00AEEF" />
      </line>
      {/* N label sphere */}
      <mesh position={[nx, 0.3, nz]}>
        <sphereGeometry args={[0.25, 8, 8]} />
        <meshStandardMaterial color="#00AEEF" />
      </mesh>
    </group>
  )
}

/* ── Camera rig — auto-fit, idle auto-rotate, preset views, polar limits ─────── */
function CameraRig({ params, resetSignal, autoRotateEnabled, cameraPreset, onPresetDone }) {
  const { length, width, num_floors, floor_height, orientation } = params
  const maxDim    = Math.max(length, width, num_floors * floor_height)
  const dist      = maxDim * 2.2
  const midH      = (num_floors * floor_height) / 2
  const controlsRef    = useRef()
  const lastInteract   = useRef(Date.now())
  const listenerAdded  = useRef(false)
  const prevReset      = useRef(resetSignal)
  const prevPreset     = useRef(null)
  const lerpTarget     = useRef(null)   // { pos: THREE.Vector3, lookAt: THREE.Vector3 }

  // ISO camera position (default 3/4 view)
  const isoPos = new THREE.Vector3(dist * 0.5, dist * 0.32, dist * 0.7)

  // Preset camera positions per facade.
  //
  // The building group is rotated by [0, -oriRad, 0] (see <group rotation={...}>
  // in the scene). To keep the F1-F4 buttons showing each face dead-on,
  // we apply the same rotation to the local face-normal positions so the
  // camera lands at the world-space normal of the rotated face. Compass rose
  // stays fixed.
  function presetPos(preset) {
    const oriRad = ((orientation ?? 0) * Math.PI) / 180
    const c = Math.cos(-oriRad)
    const s = Math.sin(-oriRad)
    // 2-D rotation around Y matching the building-group rotation [0, -oriRad, 0].
    const rot = (lx, lz) => new THREE.Vector3(lx * c + lz * s, midH, -lx * s + lz * c)
    switch (preset) {
      case 'f1':   return rot(0,    -dist)    // local -Z → rotated north face
      case 'f2':   return rot(dist,  0)       // local +X → rotated east face
      case 'f3':   return rot(0,     dist)    // local +Z → rotated south face
      case 'f4':   return rot(-dist, 0)       // local -X → rotated west face
      // Plan view: camera slightly south of straight-down so screen-up
      // becomes world -Z (north). With -Z = north, this gives the
      // conventional N-up + E-right map orientation naturally.
      case 'plan': return new THREE.Vector3(0, dist * 1.4, 0.001)
      case 'iso':  return isoPos.clone()
      default:     return isoPos.clone()
    }
  }

  useFrame(({ camera }) => {
    const ctrl = controlsRef.current
    if (!ctrl) return

    if (!listenerAdded.current) {
      ctrl.addEventListener('start', () => {
        lastInteract.current = Date.now()
        ctrl.autoRotate = false
        lerpTarget.current = null    // cancel any in-progress lerp on manual interact
      })
      listenerAdded.current = true
    }

    // Camera reset (Iso button)
    if (resetSignal !== prevReset.current) {
      prevReset.current = resetSignal
      lerpTarget.current = { pos: isoPos.clone(), lookAt: new THREE.Vector3(0, midH, 0) }
      lastInteract.current = Date.now()
    }

    // Preset view — start lerp on new preset
    if (cameraPreset !== prevPreset.current) {
      prevPreset.current = cameraPreset
      if (cameraPreset) {
        lerpTarget.current = {
          pos:    presetPos(cameraPreset),
          lookAt: new THREE.Vector3(0, midH, 0),
        }
        lastInteract.current = Date.now()
      }
    }

    // Smooth lerp toward target
    if (lerpTarget.current) {
      camera.position.lerp(lerpTarget.current.pos, 0.12)
      ctrl.target.lerp(lerpTarget.current.lookAt, 0.12)
      ctrl.update()
      // Done when close enough
      if (camera.position.distanceTo(lerpTarget.current.pos) < 0.5) {
        camera.position.copy(lerpTarget.current.pos)
        ctrl.target.copy(lerpTarget.current.lookAt)
        ctrl.update()
        lerpTarget.current = null
        onPresetDone?.()
      }
    }

    // Auto-rotate after 5s idle
    if (autoRotateEnabled) {
      const idle = Date.now() - lastInteract.current > 5000
      if (idle !== ctrl.autoRotate) ctrl.autoRotate = idle
    } else if (ctrl.autoRotate) {
      ctrl.autoRotate = false
    }
  })

  return (
    <OrbitControls
      ref={controlsRef}
      makeDefault
      target={[0, midH, 0]}
      minDistance={5}
      maxDistance={dist * 3}
      enablePan={true}
      enableDamping={true}
      dampingFactor={0.08}
      autoRotateSpeed={0.6}
      minPolarAngle={0}
      maxPolarAngle={Math.PI / 2 - 0.04}
    />
  )
}

/* ── Map tile ground plane ─────────────────────────────────────────────────── */
function latLonToTile(lat, lon, zoom) {
  const x = Math.floor(((lon + 180) / 360) * (1 << zoom))
  const latRad = (lat * Math.PI) / 180
  const y = Math.floor(
    ((1 - Math.log(Math.tan(latRad) + 1 / Math.cos(latRad)) / Math.PI) / 2) * (1 << zoom)
  )
  return { x, y, z: zoom }
}

function MapTileMesh({ location }) {
  const zoom = 16
  const { x, y, z } = latLonToTile(location.latitude, location.longitude, zoom)
  // Use a proxy-friendly URL or direct OSM
  const url = `https://tile.openstreetmap.org/${z}/${x}/${y}.png`
  const texture = useLoader(THREE.TextureLoader, url)
  // At zoom 16, 51° lat, one tile ≈ 384m wide
  return (
    <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.02, 0]} receiveShadow>
      <planeGeometry args={[384, 384]} />
      <meshStandardMaterial map={texture} roughness={0.9} metalness={0} />
    </mesh>
  )
}

function GreyGroundPlane() {
  return (
    <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.01, 0]} receiveShadow>
      <planeGeometry args={[300, 300]} />
      <meshStandardMaterial color={COLORS.groundPlane} roughness={0.95} metalness={0} />
    </mesh>
  )
}

// Error boundary for map tile loading failures
class MapErrorBoundary extends Component {
  constructor(props) { super(props); this.state = { failed: false } }
  static getDerivedStateFromError() { return { failed: true } }
  componentDidCatch(err) { console.warn('[MapTile] Load failed, using grey ground:', err.message) }
  render() {
    if (this.state.failed) return <GreyGroundPlane />
    return this.props.children
  }
}

/* ── Main viewer component ─────────────────────────────────────────────────── */
export default function BuildingViewer3D({ params }) {
  const { length, width, num_floors, floor_height, orientation, location } = params
  const maxDim  = Math.max(length, width, num_floors * floor_height)
  const camDist = maxDim * 2.2

  const [solarOverlay, setSolarOverlay]       = useState(true)
  const [mapVisible, setMapVisible]           = useState(false)
  const [resetSignal, setResetSignal]         = useState(0)
  const [hoverInfo, setHoverInfo]             = useState(null)
  const [autoRotateEnabled, setAutoRotate]    = useState(false)
  const [cameraPreset, setCameraPreset]       = useState(null)

  // Legend: map compass directions to solar values for current orientation
  const legendStops = [
    { label: `${SOLAR_MAX} kWh/m²/yr`, color: '#' + BASE_COLOR.clone().lerp(WARM_COLOR, 0.45).getHexString() },
    { label: `${Math.round((SOLAR_MIN + SOLAR_MAX) / 2)}`, color: COLORS.wall },
    { label: `${SOLAR_MIN}`, color: '#' + BASE_COLOR.clone().lerp(COOL_COLOR, 0.45).getHexString() },
  ]

  const hasLocation = location?.latitude != null && location?.longitude != null

  return (
    <div className="w-full h-full relative" style={{ background: '#D8E8F0' }}>
      <Canvas
        shadows
        camera={{
          position: [camDist * 0.5, camDist * 0.32, camDist * 0.7],
          fov: 42,
          near: 0.1,
          far: 2000,
        }}
        gl={{ antialias: true }}
      >
        {/* Sky — subtle blue-white gradient. Under the new -Z=north convention,
            +Z is south, so sun position [-1, 0.5, +1] = SW (west + south). */}
        <Sky sunPosition={[-1, 0.5, 1]} inclination={0.6} azimuth={0.25} turbidity={4} rayleigh={0.5} />

        {/* Lighting — soft ambient fill + directional sun from SW at ~45°.
            Sun at -X (west) + +Z (south, under new convention) = SW quadrant. */}
        <ambientLight intensity={0.45} color="#EEF2FF" />
        <directionalLight
          position={[-40, 55, 40]}
          intensity={1.4}
          color="#FFF8F0"
          castShadow
          shadow-mapSize={[2048, 2048]}
          shadow-camera-near={1}
          shadow-camera-far={300}
          shadow-camera-left={-80}
          shadow-camera-right={80}
          shadow-camera-top={80}
          shadow-camera-bottom={-80}
          shadow-bias={-0.0005}
        />
        {/* Bounce light from NE to fill shadow side — +X (east) + -Z (north). */}
        <directionalLight position={[30, 20, -30]} intensity={0.25} color="#D6E8F7" />

        {/* Environment — subtle city preset for glazing reflections */}
        <Environment preset="city" />

        {/* Rotate building group by orientation */}
        <group rotation={[0, (-orientation * Math.PI) / 180, 0]}>
          <Building params={params} solarOverlay={solarOverlay} onFacadeHover={setHoverInfo} />
          <OrientationIndicator orientation={0} />
          {/* Facade labels — billboard sprites sit just outside each face,
              rotate with the building, but stay readable (face camera). */}
          <FacadeLabels
            length={length}
            width={width}
            num_floors={num_floors}
            floor_height={floor_height}
            wwr={params.wwr ?? {}}
            orientation={orientation}
            halfL={length / 2}
            halfW={width / 2}
          />
        </group>

        {/* Soft contact shadow — positioned at y=0.02 to avoid z-fighting with ground plane at y=-0.01.
            Opacity 0.55 (was 0.30) + tighter blur (1.5 was 2.5) so the shadow reads
            as a clear contact shadow rather than a faint halo. */}
        <ContactShadows
          position={[0, 0.02, 0]}
          opacity={0.55}
          scale={Math.max(length, width) * 3}
          blur={1.5}
          far={Math.max(length, width) * 1.5}
          resolution={512}
          color="#1A1A1A"
        />

        {/* Ground plane — map tile if visible and location set, else solid grey */}
        {mapVisible && hasLocation ? (
          <MapErrorBoundary>
            <Suspense fallback={<GreyGroundPlane />}>
              <MapTileMesh location={location} />
            </Suspense>
          </MapErrorBoundary>
        ) : (
          <GreyGroundPlane />
        )}

        <CameraRig
          params={params}
          resetSignal={resetSignal}
          autoRotateEnabled={autoRotateEnabled}
          cameraPreset={cameraPreset}
          onPresetDone={() => setCameraPreset(null)}
        />
      </Canvas>

      {/* Overlay — building metrics */}
      <div className="absolute top-3 right-3 bg-white/90 backdrop-blur-sm rounded-lg border border-light-grey px-3 py-2 space-y-0.5 pointer-events-none">
        <p className="text-xxs uppercase tracking-wider text-mid-grey">Model</p>
        <p className="text-caption text-navy font-medium">
          {length}m × {width}m × {num_floors} fl
        </p>
        <p className="text-xxs text-mid-grey">
          {(length * width * num_floors).toLocaleString()} m² GIA
        </p>
      </div>

      {/* Toolbar — top-left */}
      <div className="absolute top-3 left-3 flex flex-col gap-1">
        {/* Row 1: Iso + Auto */}
        <div className="flex gap-1">
          <button
            onClick={() => setResetSignal(s => s + 1)}
            className="text-xxs px-2 py-1 rounded border bg-white/85 text-mid-grey border-light-grey backdrop-blur-sm hover:bg-white transition-colors"
            title="Isometric view"
          >
            ⌖ Iso
          </button>
          <button
            onClick={() => setAutoRotate(v => !v)}
            className={`text-xxs px-2 py-1 rounded border backdrop-blur-sm transition-colors ${
              autoRotateEnabled
                ? 'bg-teal/10 text-teal border-teal/40'
                : 'bg-white/85 text-mid-grey border-light-grey hover:bg-white'
            }`}
            title="Auto-rotate after 5s idle"
          >
            ↻ Auto
          </button>
        </div>
        {/* Row 2: Facade preset views + Plan */}
        <div className="flex gap-1">
          {[1, 2, 3, 4].map(n => {
            const key = `f${n}`
            const label = facadeLabel(n, orientation)
            const active = cameraPreset === key
            return (
              <button
                key={key}
                onClick={() => setCameraPreset(key)}
                className={`text-xxs px-1.5 py-1 rounded border backdrop-blur-sm transition-colors ${
                  active
                    ? 'bg-navy text-white border-navy'
                    : 'bg-white/85 text-mid-grey border-light-grey hover:bg-white'
                }`}
                title={`Face ${label}`}
              >
                F{n}
              </button>
            )
          })}
          <button
            onClick={() => setCameraPreset('plan')}
            className={`text-xxs px-1.5 py-1 rounded border backdrop-blur-sm transition-colors ${
              cameraPreset === 'plan'
                ? 'bg-navy text-white border-navy'
                : 'bg-white/85 text-mid-grey border-light-grey hover:bg-white'
            }`}
            title="Plan (top-down) view"
          >
            ◰ Plan
          </button>
        </div>
      </div>

      {/* Facade hover tooltip */}
      {hoverInfo && (
        <div className="absolute top-12 left-3 bg-white/92 backdrop-blur-sm rounded-lg border border-light-grey px-3 py-2 pointer-events-none space-y-0.5 shadow-sm">
          <p className="text-xxs uppercase tracking-wider text-mid-grey">{hoverInfo.label}</p>
          <p className="text-caption text-navy font-medium">{hoverInfo.solar} kWh/m²/yr solar</p>
          <div className="text-xxs text-dark-grey space-y-0.5 pt-0.5">
            <p>Wall area: <span className="text-navy font-medium">{hoverInfo.area} m²</span></p>
            <p>Glazing: <span className="text-navy font-medium">{hoverInfo.glazArea} m²</span> ({hoverInfo.wwr}% WWR)</p>
          </div>
        </div>
      )}

      {/* Compass rose — bottom-left corner */}
      <div className="absolute bottom-10 left-3 pointer-events-none select-none">
        <svg width="36" height="36" viewBox="-1 -1 2 2">
          <circle cx="0" cy="0" r="0.9" fill="rgba(255,255,255,0.7)" stroke="#D0D0D0" strokeWidth="0.08" />
          <polygon points="0,-0.65 0.1,-0.25 0,0 -0.1,-0.25" fill="#2B2A4C" opacity="0.85" />
          <polygon points="0,0.65 0.1,0.25 0,0 -0.1,0.25" fill="#C0C0C0" opacity="0.85" />
          <text x="0" y="-0.68" textAnchor="middle" fontSize="0.28" fill="#2B2A4C" dominantBaseline="auto" fontWeight="600">N</text>
        </svg>
      </div>

      {/* Solar overlay toggle + map toggle — bottom right */}
      <div className="absolute bottom-3 right-3 flex flex-col items-end gap-1.5">
        {/* Toggle buttons row */}
        <div className="flex gap-1.5">
          {/* Map toggle */}
          <button
            onClick={() => setMapVisible(v => !v)}
            className={`text-xxs px-2 py-1 rounded border backdrop-blur-sm transition-colors ${
              mapVisible && hasLocation
                ? 'bg-teal/10 text-teal border-teal/40'
                : 'bg-white/80 text-mid-grey border-light-grey'
            }`}
            title={hasLocation ? 'Toggle map ground plane' : 'Set location in Geometry tab to enable map'}
          >
            🗺 Map {mapVisible && hasLocation ? 'on' : 'off'}
          </button>

          {/* Solar overlay toggle */}
          <button
            onClick={() => setSolarOverlay(v => !v)}
            className={`text-xxs px-2 py-1 rounded border backdrop-blur-sm transition-colors ${
              solarOverlay
                ? 'bg-amber-50/90 text-amber-700 border-amber-300'
                : 'bg-white/80 text-mid-grey border-light-grey'
            }`}
          >
            ☀ Solar {solarOverlay ? 'on' : 'off'}
          </button>
        </div>

        {/* Solar legend */}
        {solarOverlay && (
          <div className="bg-white/85 backdrop-blur-sm rounded border border-light-grey px-2 py-1.5 space-y-0.5">
            <p className="text-xxs uppercase tracking-wider text-mid-grey mb-1">kWh/m²/yr</p>
            <div className="flex items-center gap-1.5">
              <div className="w-3 h-16 rounded" style={{
                background: `linear-gradient(to bottom, ${legendStops[0].color}, ${legendStops[1].color}, ${legendStops[2].color})`
              }} />
              <div className="flex flex-col justify-between h-16">
                {legendStops.map(s => (
                  <span key={s.label} className="text-xxs text-dark-grey leading-none">{s.label}</span>
                ))}
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Orbit hint */}
      <div className="absolute bottom-3 left-3 text-xxs text-mid-grey/60 pointer-events-none select-none">
        Drag to orbit · Scroll to zoom · Right-drag to pan
      </div>
    </div>
  )
}
