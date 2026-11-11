const step = (delta: number) => Number.isFinite(delta) ? Math.min(0.1, Math.max(0, delta)) : 0;
const smooth = (t: number) => t * t * t * (t * (t * 6 - 15) + 10);

/** Small occasional gestures laid over skinview3d's existing arm/cape breathing. */
export class SkinIdleMotion {
  private preset: number;
  private elapsed = 0;
  private wait = 1;
  private duration: number;
  private dragging = false;
  private pose = { yaw: 0, pitch: 0, x: 0, y: 0, roll: 0 };

  constructor(private random = Math.random) {
    this.preset = Math.floor(this.unit() * 3);
    this.duration = 4 + this.unit() * 2;
  }

  private unit() { return Math.max(0, Math.min(1 - Number.EPSILON, this.random())); }

  setDragging(dragging: boolean) {
    this.dragging = dragging;
    this.elapsed = 0;
    this.wait = 3;
  }

  reset() {
    this.dragging = false;
    this.elapsed = 0;
    this.wait = 1;
    this.pose.yaw = this.pose.pitch = this.pose.x = this.pose.y = this.pose.roll = 0;
  }

  /** Called only by the existing visible animation loop; no timers or per-frame allocations. */
  tick(delta: number) {
    const dt = step(delta);
    if (!this.dragging) {
      if (this.wait > 0) this.wait = Math.max(0, this.wait - dt);
      else {
        this.elapsed += dt;
        if (this.elapsed >= this.duration) {
          // Choose a different gesture, with a quiet interval between gestures.
          this.preset = (this.preset + 1 + Math.floor(this.unit() * 2)) % 3;
          this.duration = 4 + this.unit() * 2;
          this.elapsed = 0;
          this.wait = 4 + this.unit() * 4;
        }
      }
    }
    const phase = this.elapsed / this.duration;
    const envelope = !this.dragging && this.wait === 0 ? Math.sin(Math.PI * phase) ** 2 : 0;
    const sway = Math.sin(phase * Math.PI * 2) * envelope;
    const blend = 1 - Math.exp(-dt * 8);
    // Breathing, looking around, and shifting weight. Always converge to the same resting pose.
    this.pose.yaw += ((this.preset === 1 ? sway * 0.28 : 0) - this.pose.yaw) * blend;
    this.pose.pitch += ((this.preset === 1 ? -envelope * 0.04 : 0) - this.pose.pitch) * blend;
    this.pose.x += ((this.preset === 2 ? sway * 0.16 : 0) - this.pose.x) * blend;
    this.pose.y += ((this.preset === 0 ? sway * 0.22 : 0) - this.pose.y) * blend;
    this.pose.roll += ((this.preset === 2 ? sway * 0.035 : 0) - this.pose.roll) * blend;
    return this.pose;
  }
}

interface Point { x: number; y: number; z: number }
interface Position extends Point { set(x: number, y: number, z: number): unknown }
const spherical = (position: Point, target: Point) => {
  const x = position.x - target.x, y = position.y - target.y, z = position.z - target.z;
  const radius = Math.max(0.0001, Math.hypot(x, y, z));
  return { radius, yaw: Math.atan2(x, z), polar: Math.acos(Math.max(-1, Math.min(1, y / radius))) };
};
const shortAngle = (angle: number) => Math.atan2(Math.sin(angle), Math.cos(angle));

/** Return along the orbit, rather than through the character, after the user lets go. */
export class SkinOrbitReturn {
  private home: ReturnType<typeof spherical>;
  private from?: ReturnType<typeof spherical>;
  private elapsed = 0;

  constructor(private position: Position, private target: Point) {
    this.home = spherical(position, target);
  }

  cancel() { this.from = undefined; }
  release() {
    this.from = spherical(this.position, this.target);
    this.elapsed = 0;
  }

  tick(delta: number) {
    const from = this.from;
    if (!from) return;
    this.elapsed += step(delta);
    // Leave a short inspection pause, then ease home over 1.2 seconds.
    const t = Math.max(0, Math.min(1, (this.elapsed - 1.2) / 1.2));
    if (!t) return;
    const blend = smooth(t);
    const yaw = from.yaw + shortAngle(this.home.yaw - from.yaw) * blend;
    const polar = from.polar + (this.home.polar - from.polar) * blend;
    const radius = from.radius + (this.home.radius - from.radius) * blend;
    const sin = Math.sin(polar);
    this.position.set(
      this.target.x + radius * sin * Math.sin(yaw),
      this.target.y + radius * Math.cos(polar),
      this.target.z + radius * sin * Math.cos(yaw),
    );
    if (t === 1) this.cancel();
  }
}
