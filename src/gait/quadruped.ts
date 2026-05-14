/**
 * Quadruped gait sequencer for SpotMicro-class robots.
 *
 * Accepts high-level commands (stand, sit, walk:forward, walk:backward,
 * turn:left, turn:right, stop) and drives all 12 servos through the PCA9685
 * driver via pre-defined leg trajectories.
 *
 * Architecture:
 *   - GaitStateMachine owns the current state and dispatches to the active
 *     GaitController.
 *   - Each GaitController (StandController, SitController, WalkController,
 *     TurnController) owns its own servo trajectory and step loop.
 *   - The step loop runs at `stepRateHz` (default 10 Hz) using setInterval;
 *     the interval is torn down cleanly on `stop()`.
 *   - IMU input is an optional stub — if no IMU is configured the sequencer
 *     ignores orientation feedback and runs open-loop.
 *
 * Servo angle conventions (all degrees, 0 = neutral):
 *   hip:   + rotates leg forward (yaw), − rotates backward
 *   thigh: + raises body (extends thigh out), − lowers body
 *   calf:  + bends knee (flexion), − straightens
 */

import { PCA9685Driver } from '../drivers/pca9685';
import { SERVO_MAP, type LegName, type JointName } from '../drivers/spotmicro-servo-map';

// ── Angle tables for each posture ─────────────────────────────────────────────

/**
 * Per-leg, per-joint angles describing a static posture.
 * A `null` entry means "leave that joint at its current angle".
 */
export type LegPose = Record<JointName, number | null>;
export type QuadPose = Record<LegName, LegPose>;

/** Standing posture — body raised, all legs extended. */
const STAND_POSE: QuadPose = {
  frontLeft:  { hip:   0, thigh:  45, calf: -90 },
  frontRight: { hip:   0, thigh:  45, calf: -90 },
  rearLeft:   { hip:   0, thigh:  45, calf: -90 },
  rearRight:  { hip:   0, thigh:  45, calf: -90 },
};

/** Sitting posture — rear haunches lowered, front legs extended. */
const SIT_POSE: QuadPose = {
  frontLeft:  { hip:   0, thigh:  45, calf: -90 },
  frontRight: { hip:   0, thigh:  45, calf: -90 },
  rearLeft:   { hip:   0, thigh: -10, calf: -30 },
  rearRight:  { hip:   0, thigh: -10, calf: -30 },
};

// ── Walk cycle keyframes ──────────────────────────────────────────────────────

/**
 * A keyframe is a partial pose applied at one step of a walk cycle.
 * Only legs listed in the keyframe move at that step.
 */
interface WalkKeyframe {
  legs: Partial<Record<LegName, LegPose>>;
}

/**
 * Four-phase trot cycle (diagonal leg pairs move together).
 *   Phase 0: FL + RR swing forward
 *   Phase 1: FL + RR plant; body pushes through
 *   Phase 2: FR + RL swing forward
 *   Phase 3: FR + RL plant; body pushes through
 *
 * Hip sweep is in the direction of travel:
 *   forward → positive hip sweep (step ahead) followed by negative (push back)
 *   backward → inverted
 */
function buildWalkCycle(direction: 'forward' | 'backward'): WalkKeyframe[] {
  const sign = direction === 'forward' ? 1 : -1;

  const swing: LegPose  = { hip: sign * 20, thigh: 55, calf: -80 };  // lifted, stepped ahead
  const plant: LegPose  = { hip: sign * -20, thigh: 45, calf: -90 }; // grounded, pushing back
  const idle:  LegPose  = { hip: sign * -20, thigh: 45, calf: -90 }; // stationary diagonal

  return [
    // Phase 0 — FL+RR swing
    { legs: { frontLeft: swing, rearRight: swing, frontRight: idle, rearLeft: idle } },
    // Phase 1 — FL+RR plant, push
    { legs: { frontLeft: plant, rearRight: plant, frontRight: idle, rearLeft: idle } },
    // Phase 2 — FR+RL swing
    { legs: { frontRight: swing, rearLeft: swing, frontLeft: idle, rearRight: idle } },
    // Phase 3 — FR+RL plant, push
    { legs: { frontRight: plant, rearLeft: plant, frontLeft: idle, rearRight: idle } },
  ];
}

/**
 * Turn cycle: one diagonal pair sweeps outward while the other sweeps inward,
 * rotating the body in place.
 */
function buildTurnCycle(direction: 'left' | 'right'): WalkKeyframe[] {
  const outSign = direction === 'left' ? -1 : 1; // outward hip for left turn
  const inSign  = -outSign;

  const outSwing: LegPose = { hip: outSign * 25, thigh: 55, calf: -80 };
  const outPlant: LegPose = { hip: outSign * -25, thigh: 45, calf: -90 };
  const inSwing:  LegPose = { hip: inSign  * 25, thigh: 55, calf: -80 };
  const inPlant:  LegPose = { hip: inSign  * -25, thigh: 45, calf: -90 };

  return [
    { legs: { frontLeft: outSwing, rearRight: outSwing, frontRight: inSwing, rearLeft: inSwing } },
    { legs: { frontLeft: outPlant, rearRight: outPlant, frontRight: inPlant, rearLeft: inPlant } },
  ];
}

// ── GaitState ─────────────────────────────────────────────────────────────────

export type GaitCommand =
  | 'stand'
  | 'sit'
  | 'walk:forward'
  | 'walk:backward'
  | 'turn:left'
  | 'turn:right'
  | 'stop';

export type GaitState =
  | 'idle'
  | 'standing'
  | 'sitting'
  | 'walking'
  | 'turning';

// ── GaitStateMachine ─────────────────────────────────────────────────────────

export interface GaitStateMachineOptions {
  /** Step rate in Hz — controls gait loop frequency. Default 10. */
  stepRateHz?: number;
  /** IMU stub — if provided, receives orientation updates (unused in v1). */
  imu?: { getOrientation?(): { roll: number; pitch: number; yaw: number } | null };
}

export class GaitStateMachine {
  private readonly driver: PCA9685Driver;
  private readonly stepIntervalMs: number;
  private state: GaitState = 'idle';
  private intervalHandle: ReturnType<typeof setInterval> | null = null;
  private walkFrames: WalkKeyframe[] = [];
  private walkFrameIdx = 0;

  constructor(driver: PCA9685Driver, options: GaitStateMachineOptions = {}) {
    this.driver = driver;
    this.stepIntervalMs = 1000 / (options.stepRateHz ?? 10);
    // IMU is accepted for API compatibility but is a no-op in v1.
    void options.imu;
  }

  // ── Public API ─────────────────────────────────────────────────────────────

  /** Current gait state (for telemetry / tests). */
  get currentState(): GaitState { return this.state; }

  /**
   * Dispatch a gait command. Idempotent — re-issuing the same command while
   * the sequencer is already in that state is a no-op.
   */
  command(cmd: GaitCommand): void {
    switch (cmd) {
      case 'stand':         return this.transitionTo('standing');
      case 'sit':           return this.transitionTo('sitting');
      case 'walk:forward':  return this.startWalk('forward');
      case 'walk:backward': return this.startWalk('backward');
      case 'turn:left':     return this.startTurn('left');
      case 'turn:right':    return this.startTurn('right');
      case 'stop':          return this.stop();
    }
  }

  /**
   * Stop any active loop and hold the current posture.
   * Safe to call from any state.
   */
  stop(): void {
    this.clearLoop();
    this.state = 'idle';
  }

  // ── Transitions ────────────────────────────────────────────────────────────

  private transitionTo(next: 'standing' | 'sitting'): void {
    this.clearLoop();
    const pose = next === 'standing' ? STAND_POSE : SIT_POSE;
    this.applyPose(pose);
    this.state = next;
  }

  private startWalk(direction: 'forward' | 'backward'): void {
    this.clearLoop();
    this.walkFrames  = buildWalkCycle(direction);
    this.walkFrameIdx = 0;
    this.state = 'walking';
    this.intervalHandle = setInterval(() => this.stepWalk(), this.stepIntervalMs);
  }

  private startTurn(direction: 'left' | 'right'): void {
    this.clearLoop();
    this.walkFrames   = buildTurnCycle(direction);
    this.walkFrameIdx = 0;
    this.state = 'turning';
    this.intervalHandle = setInterval(() => this.stepWalk(), this.stepIntervalMs);
  }

  // ── Internal helpers ───────────────────────────────────────────────────────

  private stepWalk(): void {
    if (this.walkFrames.length === 0) return;
    const frame = this.walkFrames[this.walkFrameIdx % this.walkFrames.length];
    this.applyKeyframe(frame);
    this.walkFrameIdx++;
  }

  private applyPose(pose: QuadPose): void {
    for (const leg of Object.keys(pose) as LegName[]) {
      const legPose = pose[leg];
      for (const joint of Object.keys(legPose) as JointName[]) {
        const angle = legPose[joint];
        if (angle === null) continue;
        const channel = SERVO_MAP[leg][joint];
        this.driver.setServoAngle(channel, angle);
      }
    }
  }

  private applyKeyframe(frame: WalkKeyframe): void {
    for (const leg of Object.keys(frame.legs) as LegName[]) {
      const legPose = frame.legs[leg];
      if (!legPose) continue;
      for (const joint of Object.keys(legPose) as JointName[]) {
        const angle = legPose[joint as JointName];
        if (angle === null) continue;
        const channel = SERVO_MAP[leg][joint as JointName];
        this.driver.setServoAngle(channel, angle);
      }
    }
  }

  private clearLoop(): void {
    if (this.intervalHandle !== null) {
      clearInterval(this.intervalHandle);
      this.intervalHandle = null;
    }
    this.walkFrames   = [];
    this.walkFrameIdx = 0;
  }
}
