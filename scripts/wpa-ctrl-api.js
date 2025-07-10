const net = require('net');
const os = require('os');
const { exec } = require('child_process');
const EventEmitter = require('events');
const util = require('util');

const execPromise = util.promisify(exec);

class WpaCtrl extends EventEmitter {
  /**
   * Creates an instance of WpaCtrl.
   * @param {Object} [options={}] - Configuration options.
   * @param {string} [options.iface='wlan0'] - The network interface name.
   * @param {string} [options.ctrlPath='/var/run/wpa_supplicant/'] - Path to the wpa_supplicant control socket.
   */
  constructor(options = {}) {
    super();
    this.iface = options.iface || 'wlan0';
    this.ctrlPath = options.ctrlPath || '/var/run/wpa_supplicant/';
    this.socketPath = `${this.ctrlPath}${this.iface}`;
    this.socket = null;
    this.connected = false;
    this.pendingRequests = new Map(); // Map of request ID to { resolve, reject }
    this.requestId = 0;
    this.buffer = '';
    this.retryAttempts = 3;
    this.pingInterval = null;
    this.reconnectTimeout = null;
  }

  /**
   * Connects to the wpa_supplicant Unix socket.
   * @returns {Promise<void>} Resolves when connected, rejects on error.
   */
  async connect() {
    if (this.connected) return;
    return new Promise((resolve, reject) => {
      this.socket = net.createConnection(this.socketPath)
        .on('connect', () => {
          this.connected = true;
          this.emit('connected');
          this.startPing();
          resolve();
        })
        .on('data', (data) => this.handleData(data))
        .on('error', (err) => {
          this.connected = false;
          this.emit('error', err);
          reject(err);
          this.scheduleReconnect();
        })
        .on('close', () => {
          this.connected = false;
          this.emit('disconnected');
          this.stopPing();
          this.scheduleReconnect();
        });
    });
  }

  /**
   * Schedules an automatic reconnection attempt after a delay.
   */
  scheduleReconnect() {
    if (this.reconnectTimeout) return;
    this.reconnectTimeout = setTimeout(async () => {
      this.reconnectTimeout = null;
      try {
        await this.connect();
      } catch {
        this.scheduleReconnect(); // Retry indefinitely
      }
    }, 1000);
  }

  /**
   * Starts periodic PING requests to detect connection issues.
   */
  startPing() {
    this.pingInterval = setInterval(async () => {
      try {
        await this.request('PING');
      } catch (err) {
        this.emit('error', new Error('PING failed: ' + err.message));
        this.socket?.destroy();
      }
    }, 5000);
  }

  /**
   * Stops the periodic PING interval.
   */
  stopPing() {
    if (this.pingInterval) clearInterval(this.pingInterval);
  }

  /**
   * Sends a command to wpa_supplicant with retry logic.
   * @param {string} command - The command to send.
   * @param {number} [retries=3] - Number of retry attempts.
   * @returns {Promise<string>} Resolves with the response, rejects on failure.
   */
  async request(command, retries = this.retryAttempts) {
    if (!this.connected) await this.connect();
    const id = this.requestId++;
    return new Promise((resolve, reject) => {
      this.pendingRequests.set(id, { resolve, reject });
      this.socket.write(command + '\n');
      setTimeout(() => {
        if (this.pendingRequests.has(id)) {
          this.pendingRequests.delete(id);
          if (retries > 0) {
            setTimeout(() => this.request(command, retries - 1).then(resolve).catch(reject), 100 * Math.pow(2, this.retryAttempts - retries));
          } else {
            reject(new Error(`Timeout for command: ${command}`));
          }
        }
      }, 5000);
    });
  }

  /**
   * Handles incoming data from the socket, parsing responses and events.
   * @param {Buffer} data - The raw data received from the socket.
   */
  handleData(data) {
    this.buffer += data.toString();
    const lines = this.buffer.split('\n');
    this.buffer = lines.pop(); // Keep incomplete line
    lines.forEach(line => {
      if (line.startsWith('<')) {
        // Unsolicited event, e.g., <3>CTRL-EVENT-CONNECTED
        const event = line.replace(/^<\d+>/, '').trim();
        this.emit('event', event);
        const parts = event.split(' ');
        const eventType = parts[0];
        this.emit(eventType, ...parts.slice(1));
      } else if (line.trim()) {
        // Response to request
        const [id, ...rest] = Array.from(this.pendingRequests.keys()); // Assume one pending for simplicity; extend to queue if needed
        if (this.pendingRequests.has(id)) {
          const { resolve, reject } = this.pendingRequests.get(id);
          this.pendingRequests.delete(id);
          if (line.startsWith('FAIL')) {
            reject(new Error(`Command failed: ${line}`));
          } else {
            resolve(line);
          }
        }
      }
    });
  }

  /**
   * Attaches to receive unsolicited events from wpa_supplicant.
   * @returns {Promise<string>} Resolves with the response.
   */
  async attach() {
    return this.request('ATTACH');
  }

  /**
   * Detaches from receiving unsolicited events.
   * @returns {Promise<string>} Resolves with the response.
   */
  async detach() {
    return this.request('DETACH');
  }

  /**
   * Triggers a WiFi scan.
   * @returns {Promise<string>} Resolves with the response.
   */
  async scan() {
    return this.request('SCAN');
  }

  /**
   * Retrieves and parses the results of the last WiFi scan.
   * @returns {Promise<Array<Object>>} Array of network objects with properties like bssid, frequency, signal_level, flags, ssid.
   */
  async getScanResults() {
    const res = await this.request('SCAN_RESULTS');
    const lines = res.split('\n').filter(Boolean);
    const headers = lines.shift().split(/\t+/); // bssid / frequency / signal level / flags / ssid
    return lines.map(line => {
      const values = line.split(/\t+/);
      return headers.reduce((obj, header, i) => {
        obj[header.replace(/ /g, '_').toLowerCase()] = values[i] || '';
        return obj;
      }, {});
    });
  }

  /**
   * Retrieves and parses the current status of wpa_supplicant.
   * @returns {Promise<Object>} Object with status key-value pairs.
   */
  async getStatus() {
    const res = await this.request('STATUS');
    return res.split('\n').reduce((obj, line) => {
      const [key, value] = line.split('=');
      if (key) obj[key.trim()] = value?.trim() || '';
      return obj;
    }, {});
  }

  /**
   * Lists and parses configured networks.
   * @returns {Promise<Array<Object>>} Array of network objects with properties like network_id, ssid, bssid, flags.
   */
  async listNetworks() {
    const res = await this.request('LIST_NETWORKS');
    const lines = res.split('\n').filter(Boolean);
    const headers = lines.shift().split(/\t+/); // network id / ssid / bssid / flags
    return lines.map(line => {
      const values = line.split(/\t+/);
      return headers.reduce((obj, header, i) => {
        obj[header.replace(/ /g, '_').toLowerCase()] = values[i] || '';
        return obj;
      }, {});
    });
  }

  /**
   * Adds a new network configuration.
   * @returns {Promise<string>} Resolves with the new network ID.
   */
  async addNetwork() {
    return await this.request('ADD_NETWORK');
  }

  /**
   * Sets a property for a specific network.
   * @param {string} id - Network ID.
   * @param {string} key - Property key (e.g., 'ssid', 'psk').
   * @param {string} value - Property value.
   * @returns {Promise<string>} Resolves with the response.
   */
  async setNetwork(id, key, value) {
    const escapedValue = (key === 'ssid' || key === 'psk') ? `"${value}"` : value;
    return this.request(`SET_NETWORK ${id} ${key} ${escapedValue}`);
  }

  /**
   * Enables a network.
   * @param {string} id - Network ID.
   * @returns {Promise<string>} Resolves with the response.
   */
  async enableNetwork(id) {
    return this.request(`ENABLE_NETWORK ${id}`);
  }

  /**
   * Disables a network.
   * @param {string} id - Network ID.
   * @returns {Promise<string>} Resolves with the response.
   */
  async disableNetwork(id) {
    return this.request(`DISABLE_NETWORK ${id}`);
  }

  /**
   * Selects a network (disables others).
   * @param {string} id - Network ID.
   * @returns {Promise<string>} Resolves with the response.
   */
  async selectNetwork(id) {
    return this.request(`SELECT_NETWORK ${id}`);
  }

  /**
   * Removes a network configuration.
   * @param {string} id - Network ID.
   * @returns {Promise<string>} Resolves with the response.
   */
  async removeNetwork(id) {
    return this.request(`REMOVE_NETWORK ${id}`);
  }

  /**
   * Saves the current configuration to file.
   * @returns {Promise<string>} Resolves with the response.
   */
  async saveConfig() {
    return this.request('SAVE_CONFIG');
  }

  /**
   * Reloads the configuration file.
   * @returns {Promise<string>} Resolves with the response.
   */
  async reconfigure() {
    return this.request('RECONFIGURE');
  }

  /**
   * Adds and configures a new network (WPA-PSK or open).
   * @param {string} ssid - Network SSID.
   * @param {string|null} [password=null] - Network password (null for open networks).
   * @returns {Promise<string>} Resolves with the new network ID.
   */
  async addAndConfigureNetwork(ssid, password = null) {
    let id;
    try {
      id = await this.addNetwork();
      await this.setNetwork(id, 'ssid', ssid);
      if (password) {
        await this.setNetwork(id, 'psk', password);
      } else {
        await this.setNetwork(id, 'key_mgmt', 'NONE');
      }
      await this.enableNetwork(id);
      await this.saveConfig();
      return id;
    } catch (err) {
      if (id) await this.removeNetwork(id); // Cleanup on fail
      throw err;
    }
  }

  /**
   * Connects to a network and waits for completion.
   * @param {string} id - Network ID.
   * @param {number} [timeout=30000] - Connection timeout in milliseconds.
   * @returns {Promise<Object>} Resolves with the status object on success.
   */
  async connectToNetwork(id, timeout = 30000) {
    await this.selectNetwork(id);
    const start = Date.now();
    while (Date.now() - start < timeout) {
      const status = await this.getStatus();
      if (status.wpa_state === 'COMPLETED') {
        // Ensure IP (if not auto, invoke dhclient)
        const ifaceStatus = this.getInterfaceStatus();
        if (!ifaceStatus.ipv4) {
          await this.invokeDhclient();
        }
        return status;
      }
      await new Promise(r => setTimeout(r, 1000));
    }
    throw new Error('Connection timeout');
  }

  /**
   * Disconnects from the current network.
   * @returns {Promise<string>} Resolves with the response.
   */
  async disconnect() {
    return this.request('DISCONNECT');
  }

  /**
   * Gets the current status of the network interface (IP, MAC).
   * @returns {Object} Interface status with ipv4, ipv6, mac.
   */
  getInterfaceStatus() {
    const interfaces = os.networkInterfaces();
    const wlan = interfaces[this.iface] || [];
    return {
      ipv4: wlan.find(i => i.family === 'IPv4')?.address,
      ipv6: wlan.find(i => i.family === 'IPv6')?.address,
      mac: wlan[0]?.mac,
    };
  }

  /**
   * Brings the network interface up if it's down.
   * @returns {Promise<void>} Resolves on success, rejects on failure.
   */
  async bringInterfaceUp() {
    try {
      await execPromise(`sudo ip link set ${this.iface} up`);
    } catch (err) {
      this.emit('error', new Error(`Failed to bring up ${this.iface}: ${err.message}`));
      throw err;
    }
  }

  /**
   * Invokes dhclient to obtain an IP address.
   * @returns {Promise<void>} Resolves on success, rejects on failure.
   */
  async invokeDhclient() {
    try {
      await execPromise(`sudo dhclient ${this.iface}`);
    } catch (err) {
      this.emit('error', new Error(`dhclient failed: ${err.message}`));
      throw err;
    }
  }

  /**
   * Closes the connection and cleans up resources.
   */
  close() {
    if (this.socket) this.socket.destroy();
    this.stopPing();
    if (this.reconnectTimeout) clearTimeout(this.reconnectTimeout);
  }
}

module.exports = WpaCtrl;
