import { useRef, useMemo, useState } from 'react'
import { Canvas, useFrame } from '@react-three/fiber'
import { OrbitControls, Environment, Sky } from '@react-three/drei'
import * as THREE from 'three'
import { getSolarRadiation, SOLAR_BY_COMPASS } from '../../../utils/instantCalc.js'

/* ── Architectural material palette ───────────────────────────────────────── */
const COLORS = {
  wall:        '#D4C5B8',  // warm light stone
  roof:        '#8A8A8A',  // medium grey
  glazing:     '#88C8E8',  // subtle blue glass
  floorLine:   '#B8A898',  // subtle floor band line
  groundPlane: '#EBEBEB',  // off-white ground
}

/* ── Solar tint helper ─────────────────────────────────────────────────────── */
const SOLAR_MIN = 350  // N
const SOLAR_MAX = 750  // S
const COOL_COLOR = new THREE.Color('#A8C4D0')  // cool grey-blue for low-solar faces
const WARM_COLOR = new THREE.Color('#D4883A')  // warm amber for high-solar faces
const BASE_COLOR = new THREE.Color(COLORS.wall)

function solarFaceColor(facadeLabel, orientationDeg, enabled) {
  if (!enabled) return COLORS.wall
  const solar = getSolarRadiation(facadeLabel, orientationDeg)
  const t = Math.max(0, Math.min(1, (solar - SOLAR_MIN) / (SOLAR_MAX - SOLAR_MIN)))
  const tint = COOL_COLOR.clone().lerp(WARM_COLOR, t)
  // Blend 55% base wall, 45% tint — subtle effect
  return '#' + BASE_COLOR.clone().lerp(tint, 0.45).getHexString()
}

/* ── Building geometry from params ────────────────────────────────────────── */
function Building({ params, solarOverlay }) {
  const { length, width, num_floors, floor_height, wwr, window_count, orientation } = params

  const totalHeight = num_floors * floor_height

  // Derived
  const hw = length / 2
  const hd = width / 2

  // Window height as proportion of floor height (leaving sill + head clearance)
  const winHeightFraction = 0.6
  const winSill = floor_height * 0.2

  // Individual window panels per facade
  const GlassFace = useMemo(() => {
    return function GlassFaceInner({ axis, sign, wwr: wwrFace, faceW, count }) {
      if (!wwrFace || wwrFace < 0.01) return null

      const n     = Math.max(1, Math.round(count ?? 4))
      const winH  = floor_height * winHeightFraction
      const winY0 = winSill

      // Each individual window width
      const totalGlaz = faceW * wwrFace
      const winW  = totalGlaz / n
      // Gap on each side of each window (equal spacing)
      const gap   = (faceW - totalGlaz) / (n + 1)

      const panels = []

      for (let f = 0; f < num_floors; f++) {
        const cy = f * floor_height + winY0 + winH / 2

        for (let w = 0; w < n; w++) {
          // Position along facade axis (centred at 0)
          const along = -faceW / 2 + gap + w * (winW + gap) + winW / 2

          const px = axis === 'x' ? sign * (hd + 0.005) : along
          const pz = axis === 'z' ? sign * (hw + 0.005) : along

          panels.push(
            <mesh key={`${f}-${w}`} castShadow position={[
              axis === 'z' ? along : px,
              cy,
              axis === 'x' ? along : pz,
            ]} rotation={axis === 'z' ? [0, 0, 0] : [0, Math.PI / 2, 0]}>
              <planeGeometry args={[winW * 0.95, winH]} />
              <meshPhysicalMaterial
                color={COLORS.glazing}
                roughness={0.05}
                metalness={0.1}
                transparent
                opacity={0.55}
                reflectivity={0.6}
                side={THREE.DoubleSide}
              />
            </mesh>
          )
        }
      }
      return <>{panels}</>
    }
  }, [num_floors, floor_height, winHeightFraction, winSill, hd, hw])

  // Floor-line edges for depth
  const floorLines = useMemo(() => {
    const lines = []
    for (let f = 1; f < num_floors; f++) {
      const y = f * floor_height
      const pts = [
        new THREE.Vector3(-hd, y, -hw),
        new THREE.Vector3( hd, y, -hw),
        new THREE.Vector3( hd, y,  hw),
        new THREE.Vector3(-hd, y,  hw),
        new THREE.Vector3(-hd, y, -hw),
      ]
      const geom = new THREE.BufferGeometry().setFromPoints(pts)
      lines.push(<line key={f} geometry={geom}>
        <lineBasicMaterial color={COLORS.floorLine} opacity={0.5} transparent />
      </line>)
    }
    return lines
  }, [num_floors, floor_height, hd, hw])

  return (
    <group position={[0, 0, 0]}>
      {/* Main building box — per-face solar tint (BoxGeometry face order: +X,-X,+Y,-Y,+Z,-Z) */}
      <mesh position={[0, totalHeight / 2, 0]} castShadow receiveShadow>
        <boxGeometry args={[width, totalHeight, length]} />
        {/* +X = East */}
        <meshStandardMaterial attach="material-0" color={solarFaceColor('east',  orientation, solarOverlay)} roughness={0.85} metalness={0} />
        {/* -X = West */}
        <meshStandardMaterial attach="material-1" color={solarFaceColor('west',  orientation, solarOverlay)} roughness={0.85} metalness={0} />
        {/* +Y = Top (use roof color) */}
        <meshStandardMaterial attach="material-2" color={COLORS.roof} roughness={0.7} metalness={0} />
        {/* -Y = Bottom (underground, doesn't matter) */}
        <meshStandardMaterial attach="material-3" color={COLORS.wall} roughness={1} metalness={0} />
        {/* +Z = North */}
        <meshStandardMaterial attach="material-4" color={solarFaceColor('north', orientation, solarOverlay)} roughness={0.85} metalness={0} />
        {/* -Z = South */}
        <meshStandardMaterial attach="material-5" color={solarFaceColor('south', orientation, solarOverlay)} roughness={0.85} metalness={0} />
      </mesh>

      {/* Roof cap — slightly wider for overhang effect */}
      <mesh position={[0, totalHeight + 0.05, 0]} castShadow receiveShadow>
        <boxGeometry args={[width + 0.4, 0.15, length + 0.4]} />
        <meshStandardMaterial color={COLORS.roof} roughness={0.7} metalness={0.0} />
      </mesh>

      {/* Floor lines */}
      {floorLines}

      {/* Glazing — North face (positive Z) */}
      <GlassFace axis="z" sign={1}  wwr={wwr.north} faceW={width}  count={window_count?.north ?? 4} />
      {/* Glazing — South face (negative Z) */}
      <GlassFace axis="z" sign={-1} wwr={wwr.south} faceW={width}  count={window_count?.south ?? 4} />
      {/* Glazing — East face (positive X) */}
      <GlassFace axis="x" sign={1}  wwr={wwr.east}  faceW={length} count={window_count?.east  ?? 8} />
      {/* Glazing — West face (negative X) */}
      <GlassFace axis="x" sign={-1} wwr={wwr.west}  faceW={length} count={window_count?.west  ?? 8} />
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

/* ── Camera auto-fit based on building size ────────────────────────────────── */
function CameraRig({ params }) {
  const { length, width, num_floors, floor_height } = params
  const maxDim = Math.max(length, width, num_floors * floor_height)
  // Camera starts at a nice 3/4 angle
  const dist = maxDim * 2.2

  return (
    <OrbitControls
      makeDefault
      target={[0, (num_floors * floor_height) / 2, 0]}
      minDistance={5}
      maxDistance={dist * 3}
      enablePan={true}
      enableDamping={true}
      dampingFactor={0.08}
    />
  )
}

/* ── Main viewer component ─────────────────────────────────────────────────── */
export default function BuildingViewer3D({ params }) {
  const { length, width, num_floors, floor_height, orientation } = params
  const maxDim  = Math.max(length, width, num_floors * floor_height)
  const camDist = maxDim * 2.2

  const [solarOverlay, setSolarOverlay] = useState(true)

  // Legend: map compass directions to solar values for current orientation
  const legendStops = [
    { label: `${SOLAR_MAX} kWh/m²/yr`, color: '#' + BASE_COLOR.clone().lerp(WARM_COLOR, 0.45).getHexString() },
    { label: `${Math.round((SOLAR_MIN + SOLAR_MAX) / 2)}`, color: COLORS.wall },
    { label: `${SOLAR_MIN}`, color: '#' + BASE_COLOR.clone().lerp(COOL_COLOR, 0.45).getHexString() },
  ]

  return (
    <div className="w-full h-full relative" style={{ background: '#D8E8F0' }}>
      <Canvas
        shadows
        camera={{
          position: [camDist * 0.6, camDist * 0.5, camDist * 0.8],
          fov: 45,
          near: 0.1,
          far: 2000,
        }}
        gl={{ antialias: true }}
      >
        {/* Sky — subtle blue-white gradient */}
        <Sky sunPosition={[-1, 0.5, -1]} inclination={0.6} azimuth={0.25} turbidity={4} rayleigh={0.5} />

        {/* Lighting — soft ambient fill + directional sun from SW at ~45° */}
        <ambientLight intensity={0.45} color="#EEF2FF" />
        <directionalLight
          position={[-40, 55, -40]}
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
        {/* Bounce light from NE to fill shadow side */}
        <directionalLight position={[30, 20, 30]} intensity={0.25} color="#D6E8F7" />

        {/* Environment — subtle city preset for glazing reflections */}
        <Environment preset="city" />

        {/* Rotate building group by orientation */}
        <group rotation={[0, (-orientation * Math.PI) / 180, 0]}>
          <Building params={params} solarOverlay={solarOverlay} />
          <OrientationIndicator orientation={0} />
        </group>

        {/* Ground plane — large solid, receives building shadow */}
        <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.01, 0]} receiveShadow>
          <planeGeometry args={[300, 300]} />
          <meshStandardMaterial color={COLORS.groundPlane} roughness={0.95} metalness={0} />
        </mesh>

        <CameraRig params={params} />
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

      {/* Solar overlay toggle */}
      <div className="absolute bottom-3 right-3 flex flex-col items-end gap-1.5">
        <button
          onClick={() => setSolarOverlay(v => !v)}
          className={`text-xxs px-2 py-1 rounded border backdrop-blur-sm transition-colors ${
            solarOverlay
              ? 'bg-amber-50/90 text-amber-700 border-amber-300'
              : 'bg-white/80 text-mid-grey border-light-grey'
          }`}
        >
          ☀ Solar overlay {solarOverlay ? 'on' : 'off'}
        </button>

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
