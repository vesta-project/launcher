import { describe, expect, test } from 'bun:test';
import { SkinIdleMotion, SkinOrbitReturn } from '../src/components/skin-viewer-motion';

const advance = (motion, seconds) => {
  for (let elapsed = 0; elapsed < seconds; elapsed += 1 / 60) motion.tick(1 / 60);
};
const point = (x, y, z) => ({ x, y, z, set(x, y, z) { Object.assign(this, { x, y, z }); } });

describe('quiet skin gestures', () => {
  test('all three presets stay within small pose bounds and use distinct motions', () => {
    for (const [seed, field] of [[0, 'y'], [0.4, 'yaw'], [0.8, 'roll']]) {
      const motion = new SkinIdleMotion(() => seed);
      const peaks = { yaw: 0, pitch: 0, x: 0, y: 0, roll: 0 };
      for (let i = 0; i < 360; i++) {
        const pose = motion.tick(1 / 60);
        for (const key of Object.keys(peaks)) peaks[key] = Math.max(peaks[key], Math.abs(pose[key]));
      }
      expect(peaks.yaw).toBeLessThanOrEqual(0.28);
      expect(peaks.pitch).toBeLessThanOrEqual(0.04);
      expect(peaks.x).toBeLessThanOrEqual(0.16);
      expect(peaks.y).toBeLessThanOrEqual(0.22);
      expect(peaks.roll).toBeLessThanOrEqual(0.035);
      expect(peaks[field]).toBeGreaterThan(0.01);
    }
  });

  test('random selection stays out of the frame hot path and gestures do not immediately repeat', () => {
    let choices = 0;
    const motion = new SkinIdleMotion(() => { choices++; return 0; });
    const gestures = [];
    let quietFor = 2;
    for (let i = 0; i < 60 * 40; i++) {
      const pose = motion.tick(1 / 60);
      const kind = Math.abs(pose.y) > 0.005 ? 0 : Math.abs(pose.yaw) > 0.005 ? 1 : Math.abs(pose.roll) > 0.005 ? 2 : undefined;
      if (kind !== undefined && quietFor > 1) gestures.push(kind);
      quietFor = kind === undefined ? quietFor + 1 / 60 : 0;
    }
    expect(new Set(gestures).size).toBe(3);
    for (let i = 1; i < gestures.length; i++) expect(gestures[i]).not.toBe(gestures[i - 1]);
    expect(choices).toBeLessThan(25);
  });

  test('dragging fades an active gesture into neutral rather than snapping it', () => {
    const motion = new SkinIdleMotion(() => 0.5);
    advance(motion, 2.5);
    const before = { ...motion.tick(1 / 60) };
    expect(Math.abs(before.yaw)).toBeGreaterThan(0.01);
    motion.setDragging(true);
    const first = { ...motion.tick(1 / 60) };
    expect(Math.abs(first.yaw)).toBeGreaterThan(0);
    expect(Math.abs(first.yaw)).toBeLessThan(Math.abs(before.yaw));
    advance(motion, 2);
    expect(motion.tick(1 / 60).yaw).toBeCloseTo(0, 5);
    motion.setDragging(false);
    advance(motion, 1);
    expect(motion.tick(1 / 60).yaw).toBeCloseTo(0, 5);
  });

  test('reset clears old gestures; invalid or suspended frame times cannot jump the pose', () => {
    const motion = new SkinIdleMotion(() => 0.5);
    advance(motion, 2.5);
    const before = { ...motion.tick(0) };
    expect(motion.tick(NaN)).toEqual(before);
    expect(motion.tick(-1)).toEqual(before);
    const after = motion.tick(1000);
    expect(Math.abs(after.yaw - before.yaw)).toBeLessThan(0.1);
    motion.reset();
    expect(motion.tick(0)).toEqual({ yaw: 0, pitch: 0, x: 0, y: 0, roll: 0 });
  });
});

describe('gentle camera recovery', () => {
  test('returns around the character at constant distance after an inspection pause', () => {
    const position = point(0, 0, 50);
    const motion = new SkinOrbitReturn(position, point(0, 0, 0));
    position.set(0, 0, -50);
    motion.release();
    advance(motion, 1);
    expect(position).toMatchObject({ x: 0, y: 0, z: -50 });
    advance(motion, 0.8);
    expect(Math.hypot(position.x, position.y, position.z)).toBeCloseTo(50, 6);
    expect(Math.abs(position.x)).toBeGreaterThan(40);
    advance(motion, 0.8);
    expect(position.x).toBeCloseTo(0, 6);
    expect(position.z).toBeCloseTo(50, 6);
  });

  test('takes the shortest path across the yaw boundary and cancels without snapping', () => {
    const angle = 170 * Math.PI / 180;
    const position = point(50 * Math.sin(angle), 0, 50 * Math.cos(angle));
    const motion = new SkinOrbitReturn(position, point(0, 0, 0));
    position.x *= -1;
    motion.release();
    advance(motion, 1.8);
    expect(position.z).toBeLessThan(-49);
    motion.cancel();
    const current = { x: position.x, y: position.y, z: position.z };
    advance(motion, 3);
    expect(position).toMatchObject(current);
  });
});

test('a hop rises and lands once, without feeding into the eased pose', () => {
  const motion = new SkinIdleMotion(() => 0);
  motion.reset();
  motion.hop();
  let peak = 0;
  for (let frame = 0; frame < 30; frame++) peak = Math.max(peak, motion.tick(1 / 60).y);
  expect(peak).toBeGreaterThan(1);
  expect(peak).toBeLessThan(2);
  for (let frame = 0; frame < 60; frame++) motion.tick(1 / 60);
  expect(Math.abs(motion.tick(1 / 60).y)).toBeLessThan(0.3);
});
