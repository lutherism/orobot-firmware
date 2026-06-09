/**
 * Damiao (DM) CAN-bus actuator driver — MIT control mode.
 *
 * Supported motors: DM-J4310(-2EC), DM-J4340, DM-J6006, DM-J8006,
 *                   DM-J8009, DM-J10010, DM-J10010L and variants.
 *
 * ## Protocol source
 * Frame layout and value ranges verified against:
 *  1. Seeed Studio wiki "Damiao Series Motors" (https://wiki.seeedstudio.com/damiao_series/)
 *  2. cmjang/DM_Motor_Control C++ header (MIT-licensed):
 *     https://github.com/cmjang/DM_Motor_Control/blob/main/damiao.h
 *  3. damiao-motor.jia-xie.com/concept/communication-protocol/
 *
 * ## MIT-mode frame layout (8 bytes, standard CAN ID = motor_id)
 *
 *   D[0]         pos_u[15:8]          — position MSB
 *   D[1]         pos_u[7:0]           — position LSB
 *   D[2]         vel_u[11:4]          — velocity upper 8 bits
 *   D[3] hi      vel_u[3:0]           — velocity lower 4 bits
 *   D[3] lo      kp_u[11:8]           — stiffness upper 4 bits
 *   D[4]         kp_u[7:0]            — stiffness lower 8 bits
 *   D[5]         kd_u[11:4]           — damping upper 8 bits
 *   D[6] hi      kd_u[3:0]            — damping lower 4 bits
 *   D[6] lo      torq_u[11:8]         — torque upper 4 bits
 *   D[7]         torq_u[7:0]          — torque lower 8 bits
 *
 * ## Feedback frame (standard CAN ID = master_id, 8 bytes)
 *
 *   D[0] hi      status[3:0]          — motor status nibble
 *   D[0] lo      motor_id[3:0]        — echoed motor ID nibble
 *   D[1]         pos_u[15:8]          — position MSB
 *   D[2]         pos_u[7:0]           — position LSB
 *   D[3]         vel_u[11:4]          — velocity upper 8 bits
 *   D[4] hi      vel_u[3:0]           — velocity lower 4 bits
 *   D[4] lo      torq_u[11:8]         — torque upper 4 bits
 *   D[5]         torq_u[7:0]          — torque lower 8 bits
 *   D[6]         T_mos                — MOSFET temperature (°C)
 *   D[7]         T_rotor              — Rotor temperature (°C)
 *
 * ## Special command frames (send to motor_id, all 8 bytes set to prefix + cmd)
 *
 *   Enable motor : [0xFF,0xFF,0xFF,0xFF,0xFF,0xFF,0xFF, 0xFC]
 *   Disable motor: [0xFF,0xFF,0xFF,0xFF,0xFF,0xFF,0xFF, 0xFD]
 *   Set zero pos : [0xFF,0xFF,0xFF,0xFF,0xFF,0xFF,0xFF, 0xFE]
 *
 * ## SocketCAN
 * Production path requires the `socketcan` npm package (optional dep, lazy-loaded
 * so non-Pi imports don't fail). Tests/sim inject a MockCanBus.
 */

// ── Parameter limits per motor model ────────────────────────────────────────

/** Per-model parameter limits (position rad, velocity rad/s, torque Nm). */
export interface DmMotorLimits {
  /** Maximum position in radians (motor operates in ±P_MAX). */
  P_MAX:   number;
  /** Maximum velocity in rad/s. */
  V_MAX:   number;
  /** Maximum torque in Nm. */
  T_MAX:   number;
}

/**
 * Factory limits for known Damiao motor models.
 * Source: cmjang/DM_Motor_Control damiao.h + Seeed Studio wiki.
 */
export const DM_MOTOR_LIMITS: Record<string, DmMotorLimits> = {
  DM4310:    { P_MAX: 12.5, V_MAX: 30,  T_MAX: 10  },
  DM4310_48V:{ P_MAX: 12.5, V_MAX: 50,  T_MAX: 10  },
  DM4340:    { P_MAX: 12.5, V_MAX: 8,   T_MAX: 28  },
  DM6006:    { P_MAX: 12.5, V_MAX: 45,  T_MAX: 20  },
  DM8006:    { P_MAX: 12.5, V_MAX: 45,  T_MAX: 40  },
  DM8009:    { P_MAX: 12.5, V_MAX: 45,  T_MAX: 54  },
  DM10010L:  { P_MAX: 12.5, V_MAX: 25,  T_MAX: 200 },
  DM10010:   { P_MAX: 12.5, V_MAX: 20,  T_MAX: 200 },
};

// ── Bit-encoding constants ───────────────────────────────────────────────────

const KP_MIN   = 0;
const KP_MAX   = 500;
const KD_MIN   = 0;
const KD_MAX   = 5;

const BITS_POS  = 16;
const BITS_VEL  = 12;
const BITS_KP   = 12;
const BITS_KD   = 12;
const BITS_TORQ = 12;

// ── Special command bytes ────────────────────────────────────────────────────

const CMD_ENABLE   = 0xFC;
const CMD_DISABLE  = 0xFD;
const CMD_ZERO_POS = 0xFE;

function makeSpecialFrame(cmd: number): Buffer {
  return Buffer.from([0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF, cmd]);
}

// ── Linear quantisation helpers ─────────────────────────────────────────────

/**
 * Maps a float value x ∈ [xMin, xMax] to an unsigned integer in [0, 2^bits-1].
 * Values outside the range are clamped.
 */
export function floatToUint(x: number, xMin: number, xMax: number, bits: number): number {
  const clamped = Math.max(xMin, Math.min(xMax, x));
  const span    = xMax - xMin;
  const norm    = (clamped - xMin) / span;
  return Math.round(norm * ((1 << bits) - 1));
}

/**
 * Maps an unsigned integer u ∈ [0, 2^bits-1] back to a float in [xMin, xMax].
 */
export function uintToFloat(u: number, xMin: number, xMax: number, bits: number): number {
  const span = xMax - xMin;
  const norm = u / ((1 << bits) - 1);
  return norm * span + xMin;
}

// ── MIT-mode frame packing ───────────────────────────────────────────────────

/**
 * Packs an MIT-mode CAN command into an 8-byte Buffer.
 *
 * @param pos    Target position in radians, clamped to ±limits.P_MAX.
 * @param vel    Target velocity in rad/s, clamped to ±limits.V_MAX.
 * @param kp     Stiffness gain [0, 500].
 * @param kd     Damping gain [0, 5].
 * @param torque Feed-forward torque in Nm, clamped to ±limits.T_MAX.
 */
export function packMitFrame(
  pos: number, vel: number, kp: number, kd: number, torque: number,
  limits: DmMotorLimits,
): Buffer {
  const posU  = floatToUint(pos,    -limits.P_MAX, limits.P_MAX, BITS_POS);
  const velU  = floatToUint(vel,    -limits.V_MAX, limits.V_MAX, BITS_VEL);
  const kpU   = floatToUint(kp,     KP_MIN,        KP_MAX,       BITS_KP);
  const kdU   = floatToUint(kd,     KD_MIN,        KD_MAX,       BITS_KD);
  const torqU = floatToUint(torque, -limits.T_MAX, limits.T_MAX, BITS_TORQ);

  const buf = Buffer.alloc(8);
  buf[0] = (posU  >> 8) & 0xFF;
  buf[1] =  posU        & 0xFF;
  buf[2] = (velU  >> 4) & 0xFF;
  buf[3] = ((velU & 0x0F) << 4) | ((kpU >> 8) & 0x0F);
  buf[4] =  kpU         & 0xFF;
  buf[5] = (kdU   >> 4) & 0xFF;
  buf[6] = ((kdU  & 0x0F) << 4) | ((torqU >> 8) & 0x0F);
  buf[7] =  torqU       & 0xFF;
  return buf;
}

// ── Feedback frame parsing ───────────────────────────────────────────────────

export interface DmFeedback {
  /** Motor ID echoed in the feedback frame (lower 4 bits of D[0]). */
  motorId:    number;
  /** Status nibble (upper 4 bits of D[0]). */
  status:     number;
  /** Decoded position in radians. */
  position:   number;
  /** Decoded velocity in rad/s. */
  velocity:   number;
  /** Decoded torque in Nm. */
  torque:     number;
  /** MOSFET temperature in °C. */
  tempMos:    number;
  /** Rotor temperature in °C. */
  tempRotor:  number;
}

/**
 * Parses an 8-byte feedback frame from a Damiao actuator.
 * Throws if the buffer is shorter than 8 bytes.
 */
export function parseFeedbackFrame(data: Buffer, limits: DmMotorLimits): DmFeedback {
  if (data.length < 8) {
    throw new RangeError(`DamiaoCAN: feedback frame must be ≥8 bytes, got ${data.length}`);
  }

  const motorId  = data[0] & 0x0F;
  const status   = (data[0] >> 4) & 0x0F;

  const posU     = (data[1] << 8) | data[2];
  const velU     = (data[3] << 4) | ((data[4] >> 4) & 0x0F);
  const torqU    = ((data[4] & 0x0F) << 8) | data[5];
  const tempMos  = data[6];
  const tempRotor= data[7];

  return {
    motorId,
    status,
    position: uintToFloat(posU,  -limits.P_MAX, limits.P_MAX, BITS_POS),
    velocity: uintToFloat(velU,  -limits.V_MAX, limits.V_MAX, BITS_VEL),
    torque:   uintToFloat(torqU, -limits.T_MAX, limits.T_MAX, BITS_TORQ),
    tempMos,
    tempRotor,
  };
}

// ── SocketCAN abstraction ────────────────────────────────────────────────────

/** Minimal abstraction over a CAN channel. Inject MockCanBus in tests. */
export interface CanBusLike {
  send(id: number, data: Buffer): void;
  on(event: 'message', listener: (id: number, data: Buffer) => void): void;
  stop(): void;
}

/**
 * Mock CAN bus for unit tests — records every transmitted frame and lets tests
 * inject synthetic feedback frames via `simulateReceive`.
 */
export class MockCanBus implements CanBusLike {
  readonly sent: Array<{ id: number; data: Buffer }> = [];
  private listeners: Array<(id: number, data: Buffer) => void> = [];

  send(id: number, data: Buffer): void {
    this.sent.push({ id, data: Buffer.from(data) });
  }

  on(_event: 'message', listener: (id: number, data: Buffer) => void): void {
    this.listeners.push(listener);
  }

  /** Simulate a CAN frame arriving from the bus (e.g. motor feedback). */
  simulateReceive(id: number, data: Buffer): void {
    for (const l of this.listeners) l(id, data);
  }

  stop(): void { /* no-op */ }

  /** Clear the sent-frame log. */
  flush(): void {
    this.sent.length = 0;
  }
}

// ── DamiaoCanDriver ───────────────────────────────────────────────────────────

export interface DamiaoCanOptions {
  /**
   * SocketCAN interface name, e.g. `'can0'`.
   * Ignored when `mockBus` is provided.
   */
  iface?: string;
  /**
   * CAN ID programmed into the motor (set via manufacturer tool).
   * The command frame is sent with this ID as the arbitration ID.
   */
  motorId: number;
  /**
   * Master/host CAN ID — the motor sends feedback frames using this ID.
   * Damiao convention: masterID = motorId + 0x10.
   */
  masterId?: number;
  /** Motor model name (key into DM_MOTOR_LIMITS) or explicit limits object. */
  model: string | DmMotorLimits;
  /** Inject a mock bus for testing. When provided, `iface` is ignored. */
  mockBus?: CanBusLike;
}

export class DamiaoCanDriver {
  private bus: CanBusLike | null = null;
  private readonly motorId:  number;
  private readonly masterId: number;
  private readonly limits:   DmMotorLimits;
  private readonly iface:    string;
  private readonly mockBus?: CanBusLike;

  /** Most-recent feedback received from the motor, or null if none yet. */
  latestFeedback: DmFeedback | null = null;

  constructor(opts: DamiaoCanOptions) {
    this.motorId  = opts.motorId;
    this.masterId = opts.masterId ?? opts.motorId + 0x10;
    this.iface    = opts.iface ?? 'can0';
    this.mockBus  = opts.mockBus;

    if (typeof opts.model === 'string') {
      const limits = DM_MOTOR_LIMITS[opts.model];
      if (!limits) {
        throw new Error(
          `DamiaoCAN: unknown model "${opts.model}". ` +
          `Known: ${Object.keys(DM_MOTOR_LIMITS).join(', ')}`
        );
      }
      this.limits = limits;
    } else {
      this.limits = opts.model;
    }
  }

  /**
   * Opens the CAN socket and registers the feedback listener.
   *
   * On non-Pi environments without `socketcan` installed, inject a `mockBus`
   * via the constructor option instead of calling `init()`.
   */
  async init(): Promise<void> {
    if (this.mockBus) {
      this.bus = this.mockBus;
    } else if (process.env['NODE_ENV'] === 'sim') {
      this.bus = new MockCanBus();
    } else {
      // Lazy-require socketcan so non-Pi imports never fail on missing native module.
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const socketcan = require('socketcan') as {
        createRawChannel(iface: string, timestamps?: boolean): CanBusLike;
      };
      const ch = socketcan.createRawChannel(this.iface, false);
      this.bus = ch;
      (ch as unknown as { start(): void }).start();
    }

    this.bus.on('message', (id: number, data: Buffer) => {
      if (id === this.masterId) {
        try {
          this.latestFeedback = parseFeedbackFrame(data, this.limits);
        } catch (e) {
          console.warn('[DamiaoCAN] malformed feedback frame:', e);
        }
      }
    });
  }

  /** Closes the CAN channel. */
  close(): void {
    this.bus?.stop();
    this.bus = null;
  }

  // ── Motor lifecycle ───────────────────────────────────────────────────────

  /** Sends the enable frame — motor enters closed-loop control. */
  enable(): void {
    this._send(makeSpecialFrame(CMD_ENABLE));
  }

  /** Sends the disable frame — motor enters open-loop (free-wheel). */
  disable(): void {
    this._send(makeSpecialFrame(CMD_DISABLE));
  }

  /**
   * Sends the "set zero position" frame — saves the current mechanical
   * position as the new software zero.  Use sparingly; the value is
   * persisted in motor EEPROM.
   */
  setZeroPosition(): void {
    this._send(makeSpecialFrame(CMD_ZERO_POS));
  }

  // ── MIT-mode control ──────────────────────────────────────────────────────

  /**
   * Sends a full MIT-mode torque+impedance command.
   *
   * @param pos    Target position (rad), clamped to ±P_MAX.
   * @param vel    Target velocity (rad/s), clamped to ±V_MAX.
   * @param kp     Position stiffness gain [0, 500].
   * @param kd     Velocity damping gain [0, 5].
   * @param torque Feed-forward torque (Nm), clamped to ±T_MAX.
   */
  setMotorPosition(
    pos: number, vel: number,
    kp: number, kd: number, torque: number,
  ): void {
    const frame = packMitFrame(pos, vel, kp, kd, torque, this.limits);
    this._send(frame);
  }

  // ── Private ───────────────────────────────────────────────────────────────

  private _send(data: Buffer): void {
    if (!this.bus) throw new Error('DamiaoCAN: call init() before sending commands');
    this.bus.send(this.motorId, data);
  }
}
