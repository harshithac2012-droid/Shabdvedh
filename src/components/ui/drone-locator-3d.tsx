import { useEffect, useRef, useState } from "react";
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { RotateCcw } from "lucide-react";
import type { DroneFix, Posts, Vec3 } from "@/lib/triangulate";

const K = 0.1; // 1 scene unit = 10 m. Scene: x = East, y = Up, -z = North.
const rad = (d: number) => (d * Math.PI) / 180;
const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v));
const S = (x: number, y: number, z: number) => new THREE.Vector3(x * K, z * K, -y * K); // metres -> scene
const V = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);
const SPEED_OF_SOUND = 343; // m/s at 20°C

export interface MicTiming {
  name: string;
  role: string;
  distanceM: number;
  timeSec: number;
  deltaMs: number;
  deltaUs: number;
  deltaCm: number;
  sampleLag: number;
  rank: number; // 1 to 4
  rankLabel: string; // "1st", "2nd", "3rd", "4th"
}

export interface MicHoverData {
  post: "a" | "b";
  postLabel: string;
  micName: string;
  micRole: string;
  color: string;
  rank: number;
  rankLabel: string;
  isFirst: boolean;
  deltaMs: number;
  deltaUs: number;
  distanceM: number;
  deltaCm: number;
  sampleLag: number;
  allRanks: {
    micName: string;
    micRole: string;
    rank: number;
    rankLabel: string;
    deltaMs: number;
    isHovered: boolean;
  }[];
  containerW: number;
  containerH: number;
  x: number;
  y: number;
}

/**
 * Computes exact Time Difference of Arrival (TDoA) and arrival sequence
 * for the 4 INMP441 planar array microphones given the drone's 3D position.
 */
function getMicTimings(postKind: "a" | "b", target: Vec3 | null, posts: Posts): MicTiming[] {
  const p = postKind === "a" ? posts.a : posts.b;
  const tx = target ? target.x : 25;
  const ty = target ? target.y : 60;
  const tz = target ? target.z : 25;

  // Post array center in world coordinates (metres)
  const postWorld = { x: p[0], y: p[1], z: 1.5 };

  // Mic offsets from array center (metres) per reference planar drawing:
  // mic0: front (top)   X = 0,     Y = -0.04 (riser), Z = +0.1155
  // mic1: back-right    X = +0.10, Y = -0.04 (riser), Z = -0.0577
  // mic2: back-left     X = -0.10, Y = -0.04 (riser), Z = -0.0577
  // mic3: centre        X = 0,     Y = -0.04 (riser), Z = 0
  const defs = [
    { name: "mic0", role: "FRONT (FWD)", dx: 0.0000, dy: -0.04, dz: 0.1155 },
    { name: "mic1", role: "BACK-RIGHT",  dx: 0.1000, dy: -0.04, dz: -0.0577 },
    { name: "mic2", role: "BACK-LEFT",   dx: -0.1000, dy: -0.04, dz: -0.0577 },
    { name: "mic3", role: "CENTRE",      dx: 0.0000, dy: -0.04, dz: 0.0000 },
  ];

  const withDist = defs.map((d) => {
    const mx = postWorld.x + d.dx;
    const my = postWorld.y + d.dy;
    const mz = postWorld.z + d.dz;
    const dist = Math.hypot(tx - mx, ty - my, tz - mz);
    const timeSec = dist / SPEED_OF_SOUND;
    return { ...d, distanceM: dist, timeSec };
  });

  // Sort ascending by arrival time: closest mic arrives 1st
  withDist.sort((a, b) => a.timeSec - b.timeSec);

  const minTime = withDist[0].timeSec;
  const minDist = withDist[0].distanceM;
  const rankLabels = ["1st", "2nd", "3rd", "4th"];

  return withDist.map((item, idx) => {
    const deltaSec = item.timeSec - minTime;
    const deltaMs = deltaSec * 1000;
    const deltaUs = Math.round(deltaSec * 1_000_000);
    const deltaCm = (item.distanceM - minDist) * 100;
    const sampleLag = Math.round(deltaSec * 48000); // 48 kHz I2S sampling
    return {
      name: item.name,
      role: item.role,
      distanceM: item.distanceM,
      timeSec: item.timeSec,
      deltaMs,
      deltaUs,
      deltaCm,
      sampleLag,
      rank: idx + 1,
      rankLabel: rankLabels[idx],
    };
  });
}

interface Props {
  target: Vec3 | null;           // where the drone is drawn (metres)
  fix: DroneFix | null;          // solved angles, for the arcs
  posts: Posts;
  simulated?: boolean;
  editable?: boolean;            // lets the user drag posts and the drone
  onMovePost?: (which: "a" | "b", x: number, y: number) => void;
  onMoveTarget?: (v: Vec3) => void;
  className?: string;
}

function label(text: string, color: string, w = 2.6) {
  const c = document.createElement("canvas");
  c.width = 320; c.height = 64;
  const g = c.getContext("2d")!;
  g.font = "600 26px monospace"; g.fillStyle = color; g.textAlign = "center";
  g.fillText(text, 160, 40);
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: new THREE.CanvasTexture(c), transparent: true, depthWrite: false }));
  s.scale.set(w, w / 5, 1);
  return s;
}

function makePost(color: number, kind: "a" | "b", tip: string) {
  const g = new THREE.Group();
  const metal = new THREE.MeshStandardMaterial({ color: 0x1b2a3a, metalness: 0.8, roughness: 0.35 });
  const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.04, 1.2, 16), metal);
  pole.position.y = 0.6; g.add(pole);

  // 30 cm × 30 cm planar array mounting board with Ø 23.1 cm circumscribed circle
  // Scaled: 30 cm = 0.66 units (~0.022 per cm). R = 11.55 cm * 0.022 = 0.25 units
  const boardW = 0.66;
  const boardH = 0.66;
  const boardD = 0.035;
  const boardGeo = new THREE.BoxGeometry(boardW, boardH, boardD);
  const boardMat = new THREE.MeshStandardMaterial({ color: 0x0e2b20, roughness: 0.5, metalness: 0.2 });
  const board = new THREE.Mesh(boardGeo, boardMat);
  board.position.y = 1.5;
  g.add(board);

  // Corner mounting screws / rivets (4 corners of the 30 × 30 cm plate)
  const screwMat = new THREE.MeshStandardMaterial({ color: 0x8b99ab, metalness: 0.9, roughness: 0.2 });
  const screwGeo = new THREE.CylinderGeometry(0.01, 0.01, 0.005, 8);
  screwGeo.rotateX(Math.PI / 2);
  const cornerOff = 0.28;
  [
    [-cornerOff, cornerOff],
    [cornerOff, cornerOff],
    [-cornerOff, -cornerOff],
    [cornerOff, -cornerOff],
  ].forEach(([sx, sy]) => {
    const s = new THREE.Mesh(screwGeo, screwMat);
    s.position.set(sx, 1.5 + sy, boardD / 2 + 0.002);
    g.add(s);
  });

  // Reference circle (Ø 23.1 cm in real array -> radius R = 0.25 units)
  const R = 0.25;
  const ringGeo = new THREE.RingGeometry(R - 0.002, R + 0.002, 48);
  const ringMat = new THREE.MeshBasicMaterial({ color: 0x224a3a, transparent: true, opacity: 0.6, side: THREE.DoubleSide });
  const circleGuide = new THREE.Mesh(ringGeo, ringMat);
  circleGuide.position.set(0, 1.5, boardD / 2 + 0.002);
  g.add(circleGuide);

  // Exact planar array coordinates per reference diagram (cm -> scene units):
  // mic0 (front):      X =   0.00 cm, Y = +11.55 cm  (top vertex, pointing FWD)
  // mic1 (back-right): X = +10.00 cm, Y =  -5.77 cm  (bottom-right vertex)
  // mic2 (back-left):  X = -10.00 cm, Y =  -5.77 cm  (bottom-left vertex)
  // mic3 (centre):     X =   0.00 cm, Y =   0.00 cm  (centroid / origin)
  // Distances: outer edges = 20.0 cm, mic3 to each outer mic = 11.55 cm
  const micPositions: { name: string; x: number; y: number }[] = [
    { name: "mic0", x: 0, y: R },
    { name: "mic1", x: R * Math.cos(Math.PI / 6), y: -R * Math.sin(Math.PI / 6) },
    { name: "mic2", x: -R * Math.cos(Math.PI / 6), y: -R * Math.sin(Math.PI / 6) },
    { name: "mic3", x: 0, y: 0 },
  ];

  // Equilateral triangle frame connecting outer mics (mic0, mic1, mic2)
  const triPts = [
    new THREE.Vector3(micPositions[0].x, 1.5 + micPositions[0].y, boardD / 2 + 0.003),
    new THREE.Vector3(micPositions[1].x, 1.5 + micPositions[1].y, boardD / 2 + 0.003),
    new THREE.Vector3(micPositions[2].x, 1.5 + micPositions[2].y, boardD / 2 + 0.003),
    new THREE.Vector3(micPositions[0].x, 1.5 + micPositions[0].y, boardD / 2 + 0.003),
  ];
  const triLine = new THREE.Line(
    new THREE.BufferGeometry().setFromPoints(triPts),
    new THREE.LineBasicMaterial({ color: 0x224a3a, transparent: true, opacity: 0.7 })
  );
  g.add(triLine);

  // Spokes connecting center mic3 to outer mics
  const spokePts = [
    new THREE.Vector3(micPositions[3].x, 1.5 + micPositions[3].y, boardD / 2 + 0.003),
    new THREE.Vector3(micPositions[0].x, 1.5 + micPositions[0].y, boardD / 2 + 0.003),
    new THREE.Vector3(micPositions[3].x, 1.5 + micPositions[3].y, boardD / 2 + 0.003),
    new THREE.Vector3(micPositions[1].x, 1.5 + micPositions[1].y, boardD / 2 + 0.003),
    new THREE.Vector3(micPositions[3].x, 1.5 + micPositions[3].y, boardD / 2 + 0.003),
    new THREE.Vector3(micPositions[2].x, 1.5 + micPositions[2].y, boardD / 2 + 0.003),
  ];
  const spokeLine = new THREE.LineSegments(
    new THREE.BufferGeometry().setFromPoints(spokePts),
    new THREE.LineDashedMaterial({ color: 0x224a3a, dashSize: 0.02, gapSize: 0.02, transparent: true, opacity: 0.4 })
  );
  spokeLine.computeLineDistances();
  g.add(spokeLine);

  // Forward indicator arrow (FWD az 0°) at top of board above mic0
  const fwdGeo = new THREE.ConeGeometry(0.016, 0.045, 8);
  const fwdMat = new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.8 });
  const fwdArrow = new THREE.Mesh(fwdGeo, fwdMat);
  fwdArrow.position.set(0, 1.5 + boardH / 2 - 0.035, boardD / 2 + 0.005);
  g.add(fwdArrow);

  // 4 cm Risers and Mics (Z = 0 is a flat plane on 4 cm risers above the board)
  const riserLen = 0.035;
  const riserGeo = new THREE.CylinderGeometry(0.01, 0.01, riserLen, 12);
  riserGeo.rotateX(Math.PI / 2);
  const riserMat = new THREE.MeshStandardMaterial({ color: 0x64748b, metalness: 0.8, roughness: 0.3 });

  const micMat = new THREE.MeshBasicMaterial({ color });
  const portMat = new THREE.MeshBasicMaterial({ color: 0x050a10 });
  const micTargets: THREE.Mesh[] = [];

  micPositions.forEach(({ name, x, y }) => {
    // 4 cm riser standoff
    const riser = new THREE.Mesh(riserGeo, riserMat);
    riser.position.set(x, 1.5 + y, boardD / 2 + riserLen / 2);
    g.add(riser);

    // INMP441 MEMS mic capsule (glowing dot)
    const m = new THREE.Mesh(new THREE.SphereGeometry(0.045, 16, 16), micMat.clone());
    m.position.set(x, 1.5 + y, boardD / 2 + riserLen);
    g.add(m);

    // Acoustic port dot at center of mic face
    const port = new THREE.Mesh(new THREE.CircleGeometry(0.014, 12), portMat);
    port.position.set(x, 1.5 + y, boardD / 2 + riserLen + 0.046);
    g.add(port);

    // Invisible hit sphere for mic hover detection
    const role = name === "mic0" ? "FRONT (FWD)" : name === "mic1" ? "BACK-RIGHT" : name === "mic2" ? "BACK-LEFT" : "CENTRE";
    const hitTarget = new THREE.Mesh(
      new THREE.SphereGeometry(0.085, 10, 10),
      new THREE.MeshBasicMaterial({ visible: false })
    );
    hitTarget.position.set(x, 1.5 + y, boardD / 2 + riserLen);
    hitTarget.userData = {
      isMic: true,
      kind,
      name,
      role,
      mesh: m,
    };
    g.add(hitTarget);
    micTargets.push(hitTarget);
  });

  g.userData.micTargets = micTargets;

  // ESP32-S3 microcontroller module under board (rear side)
  const espBoard = new THREE.Mesh(
    new THREE.BoxGeometry(0.18, 0.12, 0.01),
    new THREE.MeshStandardMaterial({ color: 0x142238, roughness: 0.6 })
  );
  espBoard.position.set(0, 1.5, -boardD / 2 - 0.005);
  g.add(espBoard);
  const espShield = new THREE.Mesh(
    new THREE.BoxGeometry(0.1, 0.08, 0.012),
    new THREE.MeshStandardMaterial({ color: 0x94a3b8, metalness: 0.9, roughness: 0.2 })
  );
  espShield.position.set(0, 1.5, -boardD / 2 - 0.01);
  g.add(espShield);

  // Ground base ring and hit sphere
  const ring = new THREE.Mesh(new THREE.RingGeometry(0.5, 0.55, 48), new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.6, side: THREE.DoubleSide }));
  ring.rotation.x = -Math.PI / 2; ring.position.y = 0.02; g.add(ring);
  const hit = new THREE.Mesh(new THREE.SphereGeometry(0.9, 8, 8), new THREE.MeshBasicMaterial({ visible: false })); // easy-to-grab area
  hit.position.y = 1.3; g.add(hit);
  g.userData.tip = tip; g.userData.kind = kind;
  return g;
}

// fixed-size polyline whose points are updated in place (no per-update GPU allocations)
function poly(n: number, mat: THREE.Material) {
  const geo = new THREE.BufferGeometry();
  const attr = new THREE.BufferAttribute(new Float32Array(n * 3), 3);
  geo.setAttribute("position", attr);
  const line = new THREE.Line(geo, mat);
  line.frustumCulled = false;
  return {
    line,
    set(pts: THREE.Vector3[]) {
      pts.forEach((p, i) => attr.setXYZ(i, p.x, p.y, p.z));
      attr.needsUpdate = true;
      if (mat instanceof THREE.LineDashedMaterial) line.computeLineDistances();
    },
  };
}

export function DroneLocator3D({ target, fix, posts, simulated = true, editable = false, onMovePost, onMoveTarget, className = "" }: Props) {
  const host = useRef<HTMLDivElement>(null);
  const rig = useRef<{ update: (t: Vec3 | null, f: DroneFix | null, p: Posts) => void; reset: () => void } | null>(null);
  const controlsRef = useRef<OrbitControls | null>(null);
  const cameraRef = useRef<THREE.PerspectiveCamera | null>(null);
  const gridRef = useRef<THREE.GridHelper | null>(null);
  const latest = useRef({ target, fix, posts, simulated, editable, onMovePost, onMoveTarget });
  latest.current = { target, fix, posts, simulated, editable, onMovePost, onMoveTarget };
  const [tip, setTip] = useState<{ t: string; x: number; y: number } | null>(null);
  const [micTip, setMicTip] = useState<MicHoverData | null>(null);

  useEffect(() => {
    const el = host.current!;
    let renderer: THREE.WebGLRenderer;
    try {
      renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    } catch {
      el.textContent = "WebGL is unavailable on this device.";
      return;
    }
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.setClearColor(0x000000, 0); // transparent: the particle wave shows through
    el.appendChild(renderer.domElement);
    const dom = renderer.domElement;

    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(50, 1, 0.1, 400);
    const isSim = latest.current.simulated;
    if (isSim) {
      camera.position.set(9, 7, 8);
    } else {
      camera.position.set(-1.2, 3.2, 4.2);
    }
    cameraRef.current = camera;
    scene.add(new THREE.AmbientLight(0x6a8aaa, 0.9));
    const sun = new THREE.DirectionalLight(0xbfe4ff, 1); sun.position.set(-6, 12, 6); scene.add(sun);

    const controls = new OrbitControls(camera, dom);
    if (isSim) {
      controls.target.set(2.5, 1.8, -4.5);
    } else {
      controls.target.set(-1.2, 1.2, -4.0);
    }
    controls.enableDamping = true;
    controls.maxPolarAngle = Math.PI / 2.05;
    controls.minDistance = isSim ? 4 : 1; controls.maxDistance = 70;
    controls.update(); controls.saveState();
    controlsRef.current = controls;

    const grid = new THREE.GridHelper(isSim ? 80 : 30, isSim ? 40 : 30, 0x2dd4e6, 0x1e3a8a);
    grid.position.set(isSim ? 0 : -1.2, 0, isSim ? -10 : -4);
    (grid.material as THREE.Material).transparent = true;
    (grid.material as THREE.Material).opacity = 0.4;
    scene.add(grid);
    gridRef.current = grid;

    const postA = makePost(0x2dd4e6, "a", "POST A · DIRECTION — azimuth θ from the 4-mic planar array");
    const postB = makePost(0xffb02e, "b", "POST B · ELEVATION — elevation φ and its own bearing");
    scene.add(postA, postB);
    const lA = label("POST A · DIRECTION", "#2dd4e6", 3.2); scene.add(lA);
    const lB = label("POST B · ELEVATION", "#ffb02e", 3.2); scene.add(lB);
    const lN = label("N", "#8b99ab", 1), lE = label("E", "#8b99ab", 1); scene.add(lN, lE);
    const thL = label("θ", "#2dd4e6", 1), elL = label("ELEV", "#7fa07a", 1.4), hL = label("ALT", "#9fb3c8", 1.2);
    scene.add(thL, elL, hL);

    // Collect all microphone hit targets for precision raycasting
    const micHitTargets = [
      ...((postA.userData.micTargets as THREE.Mesh[]) || []),
      ...((postB.userData.micTargets as THREE.Mesh[]) || []),
    ];

    const droneObj = new THREE.Group();
    droneObj.add(new THREE.Mesh(new THREE.SphereGeometry(0.14, 16, 16), new THREE.MeshBasicMaterial({ color: 0xff5a4f })));
    droneObj.add(new THREE.Mesh(new THREE.OctahedronGeometry(0.28), new THREE.MeshBasicMaterial({ color: 0xff5a4f, wireframe: true })));
    const dHit = new THREE.Mesh(new THREE.SphereGeometry(0.6, 8, 8), new THREE.MeshBasicMaterial({ visible: false })); droneObj.add(dHit);
    droneObj.userData.tip = "DRONE — position computed from the two posts"; droneObj.userData.kind = "drone";
    const dl = label("DRONE", "#ff5a4f", 1.6); dl.position.y = 0.5; droneObj.add(dl);
    scene.add(droneObj);
    const shadow = new THREE.Mesh(new THREE.RingGeometry(0.18, 0.26, 32), new THREE.MeshBasicMaterial({ color: 0xff5a4f, transparent: true, opacity: 0.7, side: THREE.DoubleSide }));
    shadow.rotation.x = -Math.PI / 2; scene.add(shadow);

    const rayA = poly(2, new THREE.LineBasicMaterial({ color: 0x2dd4e6 }));
    const rayB = poly(2, new THREE.LineBasicMaterial({ color: 0xffb02e }));
    const gA = poly(2, new THREE.LineDashedMaterial({ color: 0x2dd4e6, dashSize: 0.15, gapSize: 0.1, transparent: true, opacity: 0.5 }));
    const gB = poly(2, new THREE.LineDashedMaterial({ color: 0xffb02e, dashSize: 0.15, gapSize: 0.1, transparent: true, opacity: 0.5 }));
    const alt = poly(2, new THREE.LineDashedMaterial({ color: 0x9fb3c8, dashSize: 0.1, gapSize: 0.08 }));
    const azArc = poly(33, new THREE.LineBasicMaterial({ color: 0x2dd4e6 }));
    const elArc = poly(33, new THREE.LineBasicMaterial({ color: 0x7fa07a }));
    const north = poly(2, new THREE.LineBasicMaterial({ color: 0x8b99ab, transparent: true, opacity: 0.6 }));
    const base = poly(2, new THREE.LineDashedMaterial({ color: 0x8b99ab, dashSize: 0.2, gapSize: 0.15, transparent: true, opacity: 0.6 }));

    // Interactive acoustic ray line connecting drone to hovered mic
    const acousticRay = poly(2, new THREE.LineDashedMaterial({ color: 0x2dd4e6, dashSize: 0.12, gapSize: 0.08, transparent: true, opacity: 0.9 }));
    acousticRay.line.visible = false;

    [rayA, rayB, gA, gB, alt, azArc, elArc, north, base, acousticRay].forEach((p) => scene.add(p.line));
    const showT = [rayA.line, rayB.line, gA.line, gB.line, alt.line, droneObj, shadow, hL];
    const showF = [azArc.line, elArc.line, thL, elL];

    let hoveredMicMesh: THREE.Mesh | null = null;
    const highlightMic = (m: THREE.Mesh | null) => {
      if (hoveredMicMesh === m) return;
      if (hoveredMicMesh) hoveredMicMesh.scale.set(1, 1, 1);
      hoveredMicMesh = m;
      if (hoveredMicMesh) hoveredMicMesh.scale.set(1.4, 1.4, 1.4);
    };
    const unhighlightMic = () => {
      if (hoveredMicMesh) {
        hoveredMicMesh.scale.set(1, 1, 1);
        hoveredMicMesh = null;
      }
    };

    rig.current = {
      reset: () => controls.reset(),
      update(t, f, p) {
        const isSim = latest.current.simulated;
        const currentScale = isSim ? 0.1 : 3.0;
        const S_dyn = (x: number, y: number, z: number) => new THREE.Vector3(x * currentScale, z * currentScale, -y * currentScale);
        const A = S_dyn(p.a[0], p.a[1], 0), B = S_dyn(p.b[0], p.b[1], 0);
        postA.position.copy(A); postB.position.copy(B);
        lA.position.set(A.x, 2.6, A.z); lB.position.set(B.x, 2.6, B.z);
        lN.position.set(A.x, 0.2, A.z - 3.4); lE.position.set(A.x + 2.4, 0.2, A.z);
        north.set([A.clone().setY(0.03), A.clone().add(V(0, 0.03, -3))]);
        base.set([A.clone().setY(0.03), B.clone().setY(0.03)]);
        showT.forEach((o) => (o.visible = !!t));
        showF.forEach((o) => (o.visible = !!t && !!f));
        if (!t) return;
        const P = S_dyn(t.x, t.y, t.z), G = V(P.x, 0, P.z);
        droneObj.position.copy(P); shadow.position.set(G.x, 0.03, G.z);
        rayA.set([A.clone().setY(1.5), P]); rayB.set([B.clone().setY(1.5), P]);
        gA.set([A.clone().setY(0.03), G]); gB.set([B.clone().setY(0.03), G]); alt.set([G, P]);
        hL.position.set(P.x + 0.7, P.y / 2, P.z);
        if (!f) return;
        const th = rad(f.thetaDeg), el = rad(f.elevationDeg), r = 1.6, h = V(Math.sin(th), 0, -Math.cos(th));
        azArc.set(Array.from({ length: 33 }, (_, i) => { const a = (th * i) / 32; return V(A.x + Math.sin(a) * r, 0.04, A.z - Math.cos(a) * r); }));
        elArc.set(Array.from({ length: 33 }, (_, i) => { const e = (el * i) / 32; return V(A.x + h.x * Math.cos(e) * r * 1.5, Math.sin(e) * r * 1.5, A.z + h.z * Math.cos(e) * r * 1.5); }));
        thL.position.set(A.x + Math.sin(th / 2) * (r + 0.5), 0.2, A.z - Math.cos(th / 2) * (r + 0.5));
        elL.position.set(A.x + h.x * r * 1.9, Math.sin(el / 2) * r * 1.6 + 0.3, A.z + h.z * r * 1.9);
      },
    };

    // ---- picking, hover and dragging ----
    const ray = new THREE.Raycaster(), m = new THREE.Vector2(), hit = new THREE.Vector3(), plane = new THREE.Plane();
    let dragging: "a" | "b" | "drone" | null = null;
    const setRay = (e: PointerEvent) => {
      const r = dom.getBoundingClientRect();
      m.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
      ray.setFromCamera(m, camera);
    };
    const pick = () => {
      const h = ray.intersectObjects([postA, postB, droneObj], true)[0];
      let o: THREE.Object3D | null = h?.object ?? null;
      while (o && !o.userData.kind) o = o.parent;
      return o;
    };
    const onDown = (e: PointerEvent) => {
      unhighlightMic();
      acousticRay.line.visible = false;
      setMicTip(null);
      if (!latest.current.editable) return;
      setRay(e);
      const o = pick();
      if (!o) return;
      dragging = o.userData.kind;
      controls.enabled = false; // stop the camera from rotating while we drag an object
      dom.setPointerCapture(e.pointerId);
      dom.style.cursor = "grabbing";
      e.stopImmediatePropagation();
    };
    const planeFor = (shift: boolean) => {
      if (dragging === "drone" && shift) { // vertical plane facing the camera: moves altitude
        const n = new THREE.Vector3(); camera.getWorldDirection(n); n.y = 0; n.normalize();
        plane.setFromNormalAndCoplanarPoint(n, droneObj.position);
      } else {
        plane.setFromNormalAndCoplanarPoint(V(0, 1, 0), dragging === "drone" ? droneObj.position : V(0, 0, 0));
      }
    };
    const onMove = (e: PointerEvent) => {
      setRay(e);
      const rc = dom.getBoundingClientRect();
      if (dragging) {
        unhighlightMic();
        acousticRay.line.visible = false;
        setMicTip(null);
        planeFor(e.shiftKey);
        if (ray.ray.intersectPlane(plane, hit)) {
          const currentScale = latest.current.simulated ? 0.1 : 3.0;
          const x = hit.x / currentScale, y = -hit.z / currentScale, z = hit.y / currentScale, L = latest.current;
          if (dragging === "drone" && L.target) {
            L.onMoveTarget?.(e.shiftKey
              ? { ...L.target, z: clamp(z, 0, 150) }
              : { x: clamp(x, -250, 250), y: clamp(y, -100, 300), z: L.target.z });
          } else if (dragging === "a" || dragging === "b") {
            L.onMovePost?.(dragging, clamp(x, -150, 150), clamp(y, -150, 150));
          }
        }
        return;
      }

      // Check microphone hover first
      const micIntersects = ray.intersectObjects(micHitTargets, false);
      if (micIntersects.length > 0) {
        const hitTarget = micIntersects[0].object;
        const d = hitTarget.userData;
        dom.style.cursor = "pointer";

        const timings = getMicTimings(d.kind, latest.current.target, latest.current.posts);
        const thisTiming = timings.find((t) => t.name === d.name) || timings[0];

        setMicTip({
          post: d.kind,
          postLabel: d.kind === "a" ? "POST A · DIRECTION" : "POST B · ELEVATION",
          micName: d.name,
          micRole: d.role,
          color: d.kind === "a" ? "#2dd4e6" : "#ffb02e",
          rank: thisTiming.rank,
          rankLabel: thisTiming.rankLabel,
          isFirst: thisTiming.rank === 1,
          deltaMs: thisTiming.deltaMs,
          deltaUs: thisTiming.deltaUs,
          distanceM: thisTiming.distanceM,
          deltaCm: thisTiming.deltaCm,
          sampleLag: thisTiming.sampleLag,
          allRanks: timings.map((t) => ({
            micName: t.name,
            micRole: t.role,
            rank: t.rank,
            rankLabel: t.rankLabel,
            deltaMs: t.deltaMs,
            isHovered: t.name === d.name,
          })),
          containerW: rc.width,
          containerH: rc.height,
          x: e.clientX - rc.left,
          y: e.clientY - rc.top,
        });
        setTip(null);
        highlightMic(d.mesh);

        // Draw direct acoustic ray from drone to this microphone
        const micWorld = new THREE.Vector3();
        hitTarget.getWorldPosition(micWorld);
        const currentScale = latest.current.simulated ? 0.1 : 3.0;
        const S_dyn = (x: number, y: number, z: number) => new THREE.Vector3(x * currentScale, z * currentScale, -y * currentScale);
        const dronePos = latest.current.target
          ? S_dyn(latest.current.target.x, latest.current.target.y, latest.current.target.z)
          : null;
        if (dronePos && latest.current.target) {
          (acousticRay.line.material as THREE.LineDashedMaterial).color.setHex(d.kind === "a" ? 0x2dd4e6 : 0xffb02e);
          acousticRay.set([dronePos, micWorld]);
          acousticRay.line.visible = true;
        } else {
          acousticRay.line.visible = false;
        }
        return;
      }

      // No mic hovered
      unhighlightMic();
      acousticRay.line.visible = false;
      setMicTip(null);

      const o = pick();
      dom.style.cursor = o && latest.current.editable ? "move" : "";
      setTip(o ? { t: o.userData.tip + (latest.current.editable ? " · drag to move" : ""), x: e.clientX - rc.left, y: e.clientY - rc.top } : null);
    };
    const onUp = (e: PointerEvent) => {
      if (!dragging) return;
      dragging = null; controls.enabled = true; dom.style.cursor = "";
      if (dom.hasPointerCapture(e.pointerId)) dom.releasePointerCapture(e.pointerId);
    };
    const onLeave = () => {
      setTip(null);
      setMicTip(null);
      unhighlightMic();
      acousticRay.line.visible = false;
    };
    dom.addEventListener("pointerdown", onDown, { capture: true }); // runs before OrbitControls
    dom.addEventListener("pointermove", onMove);
    dom.addEventListener("pointerup", onUp);
    dom.addEventListener("pointerleave", onLeave);

    const resize = () => {
      const w = el.clientWidth, h = el.clientHeight;
      renderer.setSize(w, h); camera.aspect = w / h; camera.updateProjectionMatrix();
    };
    const ro = new ResizeObserver(resize); ro.observe(el); resize();
    rig.current.update(latest.current.target, latest.current.fix, latest.current.posts);

    let id = 0;
    const clock = new THREE.Clock();
    const loop = () => {
      id = requestAnimationFrame(loop);
      const t = clock.getElapsedTime();
      shadow.scale.setScalar(1 + 0.2 * Math.sin(t * 4));
      droneObj.children[1].rotation.y = t;
      controls.update();
      renderer.render(scene, camera);
    };
    loop();

    return () => {
      cancelAnimationFrame(id); ro.disconnect();
      dom.removeEventListener("pointerdown", onDown, { capture: true });
      dom.removeEventListener("pointermove", onMove);
      dom.removeEventListener("pointerup", onUp);
      dom.removeEventListener("pointerleave", onLeave);
      controls.dispose();
      scene.traverse((o) => {
        const mesh = o as THREE.Mesh;
        mesh.geometry?.dispose();
        const mat = mesh.material as THREE.Material | THREE.Material[] | undefined;
        (Array.isArray(mat) ? mat : mat ? [mat] : []).forEach((x) => { (x as THREE.SpriteMaterial).map?.dispose(); x.dispose(); });
      });
      renderer.dispose(); dom.remove(); rig.current = null;
    };
  }, []);

  useEffect(() => {
    rig.current?.update(target, fix, posts);
  }, [target, fix, posts, simulated]);

  useEffect(() => {
    if (controlsRef.current && cameraRef.current) {
      if (simulated) {
        controlsRef.current.target.set(2.5, 1.8, -4.5);
        cameraRef.current.position.set(9, 7, 8);
        if (gridRef.current) gridRef.current.position.set(0, 0, -10);
      } else {
        controlsRef.current.target.set(-1.2, 1.2, -4.0);
        cameraRef.current.position.set(-1.2, 3.2, 4.2);
        if (gridRef.current) gridRef.current.position.set(-1.2, 0, -4);
      }
      controlsRef.current.update();
      controlsRef.current.saveState();
    }
  }, [simulated]);

  return (
    <div className={`relative ${className}`}>
      {/* 3D WebGL Canvas: only the canvas gets the radial edge fade so overlay UI stays 100% visible */}
      <div
        ref={host}
        className="absolute inset-0 cursor-grab active:cursor-grabbing"
        style={{
          WebkitMaskImage: "radial-gradient(ellipse at center, #000 55%, transparent 100%)",
          maskImage: "radial-gradient(ellipse at center, #000 55%, transparent 100%)",
        }}
      />
      <div className="pointer-events-none absolute left-3 top-3 border border-amber-400/70 bg-[#050b1f]/80 px-2 py-0.5 font-mono text-[11px] text-amber-300">
        {simulated ? "SIMULATION · NOT MEASURED DATA" : "LIVE READINGS"}
      </div>
      <button onClick={() => rig.current?.reset()} className="absolute bottom-3 right-3 z-10 flex items-center gap-1 border border-[#2dd4e6]/60 bg-[#050b1f]/80 px-3 py-1.5 font-mono text-xs text-[#2dd4e6] hover:bg-[#2dd4e6] hover:text-black">
        <RotateCcw size={12} /> RESET VIEW
      </button>
      <p className="pointer-events-none absolute bottom-3 left-3 font-mono text-[11px] leading-relaxed text-[#8b99ab]">
        Drag empty space to rotate · scroll to zoom
        {editable && <><br />Drag posts or drone to move · Shift+drag drone = altitude</>}
      </p>
      {tip && <div className="pointer-events-none absolute z-10 max-w-[240px] border border-[#2dd4e6]/50 bg-[#050b1f]/95 px-2 py-1 font-mono text-[11px] text-[#2dd4e6]" style={{ left: tip.x + 14, top: tip.y + 14 }}>{tip.t}</div>}

      {micTip && (() => {
        const cardW = 310;
        const cardH = 325;
        const cw = micTip.containerW || 800;
        const ch = micTip.containerH || 600;

        // Flip to left if placing on right would overflow the container
        let left = micTip.x + 16;
        if (left + cardW > cw - 16) {
          left = micTip.x - cardW - 16;
        }
        left = Math.max(16, Math.min(cw - cardW - 16, left));

        // Clamp vertically so the bottom (array sequence) is always fully visible
        let top = micTip.y - 70;
        if (top + cardH > ch - 16) {
          top = ch - cardH - 16;
        }
        top = Math.max(16, top);

        return (
          <div
            className="pointer-events-none absolute z-50 w-[310px] rounded-sm border border-[#2dd4e6]/70 bg-[#040814]/95 p-3.5 font-mono shadow-2xl backdrop-blur-md"
            style={{ left, top }}
          >
            {/* Header */}
            <div className="flex items-center justify-between border-b border-[#2dd4e6]/30 pb-2">
              <div className="flex items-center gap-2">
                <span
                  className="inline-block h-2.5 w-2.5 rounded-full"
                  style={{ backgroundColor: micTip.color, boxShadow: `0 0 10px ${micTip.color}` }}
                />
                <span className="font-bold text-sm text-white tracking-wide">
                  {micTip.micName.toUpperCase()} · {micTip.micRole}
                </span>
              </div>
              <span className="text-[10px] font-semibold text-[#8b99ab]">{micTip.postLabel}</span>
            </div>

            {/* Primary Announcement Box */}
            <div
              className={`mt-2.5 rounded border p-2.5 ${
                micTip.isFirst
                  ? "border-emerald-500/60 bg-emerald-950/40 text-emerald-300"
                  : "border-[#2dd4e6]/40 bg-[#09152b]/70 text-[#c3cedb]"
              }`}
            >
              <div className="flex items-center justify-between">
                <span className="text-[10px] font-bold tracking-wider text-[#8b99ab]">
                  ACOUSTIC ARRIVAL:
                </span>
                <span
                  className={`px-2 py-0.5 text-[11px] font-black rounded ${
                    micTip.isFirst
                      ? "bg-emerald-500 text-black shadow-sm"
                      : "bg-[#2dd4e6]/25 text-[#2dd4e6]"
                  }`}
                >
                  {micTip.rankLabel.toUpperCase()} TO RECEIVE READING
                </span>
              </div>
              <p className="mt-1.5 text-xs font-semibold leading-relaxed">
                {micTip.isFirst ? (
                  <>Sound wave reaches <span className="text-white font-bold">{micTip.micName}</span> <span className="text-emerald-400 font-bold underline">first</span> (earliest reading recorded).</>
                ) : (
                  <>Received reading <span className="text-[#2dd4e6] font-bold">{micTip.rankLabel}</span> (delayed by <span className="text-white font-bold">+{micTip.deltaMs.toFixed(3)} ms</span> behind {micTip.allRanks[0]?.micName}).</>
                )}
              </p>
            </div>

            {/* Telemetry Metrics Grid */}
            <div className="mt-2.5 grid grid-cols-2 gap-2 text-[11px]">
              <div className="border border-[#22408f]/40 bg-[#071021]/80 p-2 rounded-sm">
                <span className="text-[10px] text-[#8b99ab] block">TIME DELAY (TDoA)</span>
                <span className="font-bold text-white text-xs">
                  {micTip.isFirst ? "0.00 ms (0 µs)" : `+${micTip.deltaMs.toFixed(3)} ms`}
                </span>
                {!micTip.isFirst && (
                  <span className="block text-[9px] text-[#8b99ab] mt-0.5">+{micTip.deltaUs} µs</span>
                )}
              </div>

              <div className="border border-[#22408f]/40 bg-[#071021]/80 p-2 rounded-sm">
                <span className="text-[10px] text-[#8b99ab] block">DISTANCE TO DRONE</span>
                <span className="font-bold text-[#2dd4e6] text-xs">
                  {micTip.distanceM.toFixed(2)} m
                </span>
                <span className="block text-[9px] text-[#8b99ab] mt-0.5">
                  {micTip.isFirst ? "Closest mic (lead)" : `+${micTip.deltaCm.toFixed(1)} cm path lag`}
                </span>
              </div>

              <div className="border border-[#22408f]/40 bg-[#071021]/80 p-2 rounded-sm">
                <span className="text-[10px] text-[#8b99ab] block">SAMPLE LAG @ 48kHz</span>
                <span className="font-bold text-white text-xs">
                  {micTip.isFirst ? "0 samples (ref)" : `+${micTip.sampleLag} samples`}
                </span>
              </div>

              <div className="border border-[#22408f]/40 bg-[#071021]/80 p-2 rounded-sm">
                <span className="text-[10px] text-[#8b99ab] block">SOUND TRAVEL TIME</span>
                <span className="font-bold text-amber-300 text-xs">
                  {((micTip.distanceM / SPEED_OF_SOUND) * 1000).toFixed(1)} ms
                </span>
              </div>
            </div>

            {/* All Mics Arrival Timeline */}
            <div className="mt-3 border-t border-[#22408f]/30 pt-2">
              <span className="text-[10px] tracking-wider text-[#8b99ab] block mb-1.5 font-semibold">
                ARRAY SEQUENCE (1ST → 4TH):
              </span>
              <div className="grid grid-cols-4 gap-1 text-[10px] text-center">
                {micTip.allRanks.map((m) => (
                  <div
                    key={m.micName}
                    className={`p-1 rounded border transition-colors ${
                      m.isHovered
                        ? "border-[#2dd4e6] bg-[#2dd4e6]/30 font-bold text-white ring-1 ring-[#2dd4e6]"
                        : m.rank === 1
                        ? "border-emerald-500/40 bg-emerald-950/30 text-emerald-400"
                        : "border-[#22408f]/20 bg-[#050b1a]/40 text-[#8b99ab]"
                    }`}
                  >
                    <div className="text-[9px] font-bold">{m.rankLabel}</div>
                    <div className="truncate font-semibold">{m.micName}</div>
                    <div className="text-[8px] opacity-80">
                      {m.rank === 1 ? "0.00 ms" : `+${m.deltaMs.toFixed(2)}`}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        );
      })()}
    </div>
  );
}