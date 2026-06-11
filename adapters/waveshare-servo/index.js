'use strict';
/**
 * @orobot/adapter-waveshare-servo — reference stub adapter
 *
 * This is the integration-test target and authoring template for community
 * hardware adapters. A real adapter would open the serial port, implement the
 * WaveShare SMS/STS bus-servo protocol, and expose motor IDs as positions.
 *
 * Stub behaviour: ServoClient does not open a real port. All methods log to
 * console and resolve immediately. This lets `script.js` authors import and
 * call the adapter API during development without needing the physical hardware.
 *
 * ## Usage in script.js
 *
 *   const { ServoClient } = require('@orobot/adapter-waveshare-servo');
 *   const servo = new ServoClient({ port: '/dev/ttyUSB0', baudRate: 1000000 });
 *   servo.setPosition(1, 2048);   // servo id 1, position 0–4096
 *   servo.setPosition(2, 1024);
 *
 * ## Authoring your own adapter
 *
 * 1. Create an npm package named `@orobot/adapter-<your-hardware>`.
 * 2. Export a constructor (class or function) in `index.js`.
 * 3. Declare it in your orobot program's `hardwareAdapters` config field.
 *    The firmware will `npm install` it automatically on program deploy.
 * 4. Users can then `require('@orobot/adapter-<your-hardware>')` from script.js.
 */

/**
 * ServoClient — wraps a WaveShare SMS/STS serial bus-servo connection.
 *
 * @param {object} options
 * @param {string} [options.port='/dev/ttyUSB0']  Serial port path on the Pi.
 * @param {number} [options.baudRate=1000000]     Baud rate for the servo bus.
 */
class ServoClient {
  constructor(options = {}) {
    this.port = options.port ?? '/dev/ttyUSB0';
    this.baudRate = options.baudRate ?? 1_000_000;
    this._connected = false;
    console.log(`[waveshare-servo] ServoClient created (port=${this.port} baud=${this.baudRate})`);
  }

  /**
   * Open the serial connection.
   * @returns {Promise<void>}
   */
  async connect() {
    this._connected = true;
    console.log(`[waveshare-servo] connected to ${this.port}`);
  }

  /**
   * Close the serial connection and release the port.
   * @returns {Promise<void>}
   */
  async disconnect() {
    this._connected = false;
    console.log(`[waveshare-servo] disconnected from ${this.port}`);
  }

  /**
   * Set a servo position.
   *
   * @param {number} servoId  Servo ID on the bus (1-based, device-specific).
   * @param {number} position Position in raw counts (0–4096 for 12-bit servos).
   * @param {number} [speed=0]  Optional move speed (0 = max speed).
   * @returns {Promise<void>}
   */
  async setPosition(servoId, position, speed = 0) {
    console.log(`[waveshare-servo] setPosition(id=${servoId}, pos=${position}, speed=${speed})`);
  }

  /**
   * Read a servo's current position.
   *
   * @param {number} servoId
   * @returns {Promise<number>} Position in raw counts (stub always returns 0).
   */
  async getPosition(servoId) {
    console.log(`[waveshare-servo] getPosition(id=${servoId}) → 0 (stub)`);
    return 0;
  }

  /**
   * Enable or disable servo torque.
   *
   * @param {number} servoId
   * @param {boolean} enabled
   * @returns {Promise<void>}
   */
  async setTorque(servoId, enabled) {
    console.log(`[waveshare-servo] setTorque(id=${servoId}, enabled=${enabled})`);
  }
}

module.exports = { ServoClient };
