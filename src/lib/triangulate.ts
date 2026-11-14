// Geometry for the 3D locator. World frame (metres): x = East, y = North, z = up. Posts stand on the ground.
// Bearings are compass style: 0 = North, clockwise positive (90 = East).

export type Vec3 = { x: number; y: number; z: number };
export type Posts = { a: [number, number]; b: [number, number] };
export type Mode = "simulation" | "live";

export interface DroneFix {
  thetaDeg: number;      // bearing from post A, compass degrees
  elevationDeg: number;  // up from level, seen from post A
  distanceM: number;     // straight-line distance from post A
  groundRangeM: number;  // horizontal distance from post A
  altitudeM: number;
  x: number; y: number; z: number;
}

export interface Readings {
  directionPost: { azimuthDeg: number };                       // post A
  elevationPost: { azimuthDeg: number; elevationDeg: number }; // post B
}

export const DEFAULT_POSTS: Posts = { a: [30, 0], b: [-30, 0] };
export const DEFAULT_DRONE: Vec3 = { x: 20, y: 120, z: 60 };

const rad = (d: number) => (d * Math.PI) / 180;
const deg = (r: number) => (r * 180) / Math.PI;
const wrap360 = (d: number) => ((d % 360) + 360) % 360;

export function bearingDeg(fromX: number, fromY: number, toX: number, toY: number) {
  return wrap360(deg(Math.atan2(toX - fromX, toY - fromY)));
}

// What the two posts would measure for a drone at `d`.
export function readingsFor(d: Vec3, p: Posts): Readings {
  const [bx, by] = p.b;
  const groundB = Math.hypot(d.x - bx, d.y - by);
  return {
    directionPost: { azimuthDeg: bearingDeg(p.a[0], p.a[1], d.x, d.y) },
    elevationPost: { azimuthDeg: bearingDeg(bx, by, d.x, d.y), elevationDeg: deg(Math.atan2(d.z, groundB)) },
  };
}

// Cross the two ground bearings, then use post B's elevation for the height.
export function solveFix(r: Readings | null, p: Posts): DroneFix | null {
  if (!r) return null;
  const ta = rad(r.directionPost.azimuthDeg), tb = rad(r.elevationPost.azimuthDeg);
  const ua = [Math.sin(ta), Math.cos(ta)], ub = [Math.sin(tb), Math.cos(tb)];
  const den = ua[0] * ub[1] - ua[1] * ub[0];
  if (Math.abs(den) < 1e-6) return null;                  // parallel bearings
  const dx = p.b[0] - p.a[0], dy = p.b[1] - p.a[1];
  const s = (dx * ub[1] - dy * ub[0]) / den;              // along A's ray
  const t = (dx * ua[1] - dy * ua[0]) / den;              // along B's ray
  if (s <= 0 || t <= 0) return null;                      // they cross behind a post
  const x = p.a[0] + s * ua[0], y = p.a[1] + s * ua[1];
  const z = Math.max(0, t * Math.tan(rad(r.elevationPost.elevationDeg)));
  const ground = s;
  return {
    thetaDeg: wrap360(r.directionPost.azimuthDeg),
    elevationDeg: deg(Math.atan2(z, ground)),
    distanceM: Math.hypot(ground, z),
    groundRangeM: ground,
    altitudeM: z,
    x, y, z,
  };
}

// A gentle figure-of-eight in front of the posts, for AUTO FLIGHT.
export function flight(t: number, p: Posts): Vec3 {
  const cx = (p.a[0] + p.b[0]) / 2, cy = (p.a[1] + p.b[1]) / 2;
  return {
    x: cx + 110 * Math.sin(t * 0.25),
    y: cy + 130 + 50 * Math.sin(t * 0.5),
    z: 55 + 25 * Math.sin(t * 0.35),
  };
}
