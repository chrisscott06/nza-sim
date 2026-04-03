import { useRef, useMemo, useState, Suspense, Component } from 'react'
import { Canvas, useFrame, useLoader } from '@react-three/fiber'
import { OrbitControls, Environment, Sky, useTexture, Edges, ContactShadows } from '@react-three/drei'
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

/* ── Architectural material palette — clean white massing model ────────────── */
const COLORS = {
  wall:        '#F5F3F0',  // near-white matte wall
  roof:        '#E8E5E0',  // slightly darker than walls
  glazing:     '#D8E8F0',  // subtle blue-tinted glass
  floorLine:   '#CCCCCC',  // soft floor band line on white wall
  groundPlane: '#EBEBEB',  // off-white ground
  frame:       '#C0C0C0',  // medium grey window reveal frame (contrast on white wall)
  basePlate:   '#F0EFEC',  // base platform — slightly darker than wall
  edges:       '#909090',  // soft edge lines
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
function Building({ params, solarOverlay, onFacadeHover }) {
  const { length, width, num_floors, floor_height, wwr, window_count, orientation } = params

  const totalHeight = num_floors * floor_height

  // Derived
  const hw = length / 2
  const hd = width / 2

  // Window height as proportion of floor height (leaving sill + head clearance)
  const winHeightFraction = 0.6
  const winSill = floor_height * 0.2

  // Individual window panels per facade — with recessed reveal frames
  const GlassFace = useMemo(() => {
    return function GlassFaceInner({ axis, sign, wwr: wwrFace, faceW, count }) {
      if (!wwrFace || wwrFace < 0.01) return null

      const n     = Math.max(1, Math.round(count ?? 4))
      const winH  = floor_height * winHeightFraction
      const winY0 = winSill

      const totalGlaz = faceW * wwrFace
      const winW  = totalGlaz / n
      const gap   = (faceW - totalGlaz) / (n + 1)

      // Reveal frame constants
      const FW = Math.max(0.04, Math.min(0.08, winW * 0.12))  // frame strip width 40–80mm
      const FD = 0.08  // reveal depth — frame protrudes 80mm outward from wall surface

      // Wall face distance from origin along the perpendicular axis
      const wallFace  = axis === 'z' ? hw : hd
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
              {/* Glass panel — sits at wall surface level, inside the reveal frame */}
              <mesh
                castShadow receiveShadow
                position={p(along, cy, glassFace)}
                rotation={axis === 'z' ? [0, 0, 0] : [0, Math.PI / 2, 0]}
              >
                <planeGeometry args={[gw, winH]} />
                <meshPhysicalMaterial
                  color={COLORS.glazing}
                  roughness={0.05}
                  metalness={0.15}
                  transparent
                  opacity={0.30}
                  reflectivity={0.8}
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

  // Facade metadata for hover tooltip (BoxGeometry materialIndex order: +X,-X,+Y,-Y,+Z,-Z)
  // Face area: East/West = length × totalHeight; North/South = width × totalHeight
  // F1=north, F2=east, F3=south, F4=west
  const facadeMap = [
    { label: facadeLabel(2, orientation), key: 'east',  faceW: length, area: length * totalHeight, wwrVal: wwr.east  },  // +X
    { label: facadeLabel(4, orientation), key: 'west',  faceW: length, area: length * totalHeight, wwrVal: wwr.west  },  // -X
    null,  // +Y top — not a facade
    null,  // -Y bottom
    { label: facadeLabel(1, orientation), key: 'north', faceW: width,  area: width  * totalHeight, wwrVal: wwr.north },  // +Z
    { label: facadeLabel(3, orientation), key: 'south', faceW: width,  area: width  * totalHeight, wwrVal: wwr.south },  // -Z
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
        <boxGeometry args={[width, totalHeight, length]} />
        {/* +X = East */}
        <meshStandardMaterial attach="material-0" color={solarFaceColor('east',  orientation, solarOverlay)} roughness={0.9} metalness={0} />
        {/* -X = West */}
        <meshStandardMaterial attach="material-1" color={solarFaceColor('west',  orientation, solarOverlay)} roughness={0.9} metalness={0} />
        {/* +Y = Top (roof) */}
        <meshStandardMaterial attach="material-2" color={COLORS.roof} roughness={0.85} metalness={0} />
        {/* -Y = Bottom */}
        <meshStandardMaterial attach="material-3" color={COLORS.wall} roughness={0.9} metalness={0} />
        {/* +Z = North */}
        <meshStandardMaterial attach="material-4" color={solarFaceColor('north', orientation, solarOverlay)} roughness={0.9} metalness={0} />
        {/* -Z = South */}
        <meshStandardMaterial attach="material-5" color={solarFaceColor('south', orientation, solarOverlay)} roughness={0.9} metalness={0} />
        <Edges color={COLORS.edges} threshold={15} />
      </mesh>

      {/* Roof cap — slightly wider for overhang effect */}
      <mesh position={[0, totalHeight + 0.05, 0]} castShadow receiveShadow>
        <boxGeometry args={[width + 0.4, 0.2, length + 0.4]} />
        <meshStandardMaterial color={COLORS.roof} roughness={0.85} metalness={0} />
        <Edges color={COLORS.edges} threshold={15} />
      </mesh>

      {/* Base plate — raised platform extending 2m beyond footprint on all sides */}
      <mesh position={[0, -0.15, 0]} receiveShadow>
        <boxGeometry args={[width + 4, 0.3, length + 4]} />
        <meshStandardMaterial color={COLORS.basePlate} roughness={0.95} metalness={0} />
        <Edges color={COLORS.edges} threshold={15} />
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

/* ── Camera rig — auto-fit, idle auto-rotate, polar limits ─────────────────── */
function CameraRig({ params, resetSignal, autoRotateEnabled }) {
  const { length, width, num_floors, floor_height } = params
  const maxDim = Math.max(length, width, num_floors * floor_height)
  const dist = maxDim * 2.2
  const controlsRef = useRef()
  const lastInteract = useRef(Date.now())
  const listenerAdded = useRef(false)

  // Reset camera + manage auto-rotate in frame loop
  // Attach OrbitControls 'start' listener on first frame (avoids useEffect inside R3F)
  const prevReset = useRef(resetSignal)
  useFrame(({ camera }) => {
    const ctrl = controlsRef.current
    if (!ctrl) return

    // One-time setup: attach interaction listener to track idle time
    if (!listenerAdded.current) {
      ctrl.addEventListener('start', () => {
        lastInteract.current = Date.now()
        ctrl.autoRotate = false
      })
      listenerAdded.current = true
    }

    // Camera reset
    if (resetSignal !== prevReset.current) {
      prevReset.current = resetSignal
      ctrl.target.copy(new THREE.Vector3(0, (num_floors * floor_height) / 2, 0))
      camera.position.set(dist * 0.5, dist * 0.32, dist * 0.7)
      ctrl.update()
      lastInteract.current = Date.now()
    }

    // Enable auto-rotate after 5s idle (if toggle is on)
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
      target={[0, (num_floors * floor_height) / 2, 0]}
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
  const [autoRotateEnabled, setAutoRotate]    = useState(true)

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
          <Building params={params} solarOverlay={solarOverlay} onFacadeHover={setHoverInfo} />
          <OrientationIndicator orientation={0} />
        </group>

        {/* Soft contact shadow where building meets base plate */}
        <ContactShadows
          position={[0, -0.01, 0]}
          opacity={0.35}
          scale={Math.max(length, width) * 3}
          blur={2.5}
          far={Math.max(length, width) * 1.5}
          resolution={256}
          color="#000000"
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

        <CameraRig params={params} resetSignal={resetSignal} autoRotateEnabled={autoRotateEnabled} />
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
        {/* Reset view */}
        <button
          onClick={() => setResetSignal(s => s + 1)}
          className="text-xxs px-2 py-1 rounded border bg-white/85 text-mid-grey border-light-grey backdrop-blur-sm hover:bg-white transition-colors"
          title="Reset view"
        >
          ⌖ Reset
        </button>
        {/* Auto-rotate toggle */}
        <button
          onClick={() => setAutoRotate(v => !v)}
          className={`text-xxs px-2 py-1 rounded border backdrop-blur-sm transition-colors ${
            autoRotateEnabled
              ? 'bg-teal/10 text-teal border-teal/40'
              : 'bg-white/85 text-mid-grey border-light-grey'
          }`}
          title="Auto-rotate after 5s idle"
        >
          ↻ Auto
        </button>
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
