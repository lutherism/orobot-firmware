const test = require('tape');
const EventEmitter = require('events');
const os = require('os');
const { exec } = require('child_process');
const util = require('util');
const net = require('net');

// The class under test (assume it's in wpa-ctrl.js or copy-paste it here for testing)
const WpaCtrl = require('./wpa-ctrl'); // Replace with actual path if needed

test('constructor sets default options correctly', t => {
  const ctrl = new WpaCtrl();
  t.equal(ctrl.iface, 'wlan0', 'default interface is wlan0');
  t.equal(ctrl.ctrlPath, '/var/run/wpa_supplicant/', 'default control path');
  t.equal(ctrl.socketPath, '/var/run/wpa_supplicant/wlan0', 'socket path constructed correctly');
  t.equal(ctrl.connected, false, 'initially not connected');
  t.end();
});

test('constructor uses custom options', t => {
  const ctrl = new WpaCtrl({ iface: 'wlp3s0', ctrlPath: '/tmp/' });
  t.equal(ctrl.iface, 'wlp3s0', 'custom interface');
  t.equal(ctrl.ctrlPath, '/tmp/', 'custom control path');
  t.equal(ctrl.socketPath, '/tmp/wlp3s0', 'custom socket path');
  t.end();
});

test('getScanResults parses scan results correctly', async t => {
  const ctrl = new WpaCtrl();
  ctrl.request = async () => `bssid\tfrequency\tsignal level\tflags\tssid
00:11:22:33:44:55\t2412\t-50\t[WPA2-PSK-CCMP]\tTestNet
66:77:88:99:aa:bb\t2437\t-60\t[ESS]\tOpenNet`;
  const results = await ctrl.getScanResults();
  t.deepEqual(results, [
    {
      bssid: '00:11:22:33:44:55',
      frequency: '2412',
      signal_level: '-50',
      flags: '[WPA2-PSK-CCMP]',
      ssid: 'TestNet'
    },
    {
      bssid: '66:77:88:99:aa:bb',
      frequency: '2437',
      signal_level: '-60',
      flags: '[ESS]',
      ssid: 'OpenNet'
    }
  ], 'parses multiple networks correctly');
  t.end();
});

test('getStatus parses status output correctly', async t => {
  const ctrl = new WpaCtrl();
  ctrl.request = async () => `wpa_state=COMPLETED
ssid=TestNet
ip_address=192.168.1.100`;
  const status = await ctrl.getStatus();
  t.deepEqual(status, {
    wpa_state: 'COMPLETED',
    ssid: 'TestNet',
    ip_address: '192.168.1.100'
  }, 'parses key-value pairs');
  t.end();
});

test('listNetworks parses network list correctly', async t => {
  const ctrl = new WpaCtrl();
  ctrl.request = async () => `network id\tssid\tbssid\tflags
0\tTestNet\tany\t[current]
1\tOpenNet\tany\t[disabled]`;
  const networks = await ctrl.listNetworks();
  t.deepEqual(networks, [
    {
      network_id: '0',
      ssid: 'TestNet',
      bssid: 'any',
      flags: '[current]'
    },
    {
      network_id: '1',
      ssid: 'OpenNet',
      bssid: 'any',
      flags: '[disabled]'
    }
  ], 'parses network list');
  t.end();
});

test('addAndConfigureNetwork adds and configures WPA network', async t => {
  const ctrl = new WpaCtrl();
  let calls = [];
  ctrl.addNetwork = async () => { calls.push('add'); return '5'; };
  ctrl.setNetwork = async (id, key, value) => { calls.push(`set:${id}:${key}:${value}`); return 'OK'; };
  ctrl.enableNetwork = async (id) => { calls.push(`enable:${id}`); return 'OK'; };
  ctrl.saveConfig = async () => { calls.push('save'); return 'OK'; };
  ctrl.removeNetwork = async (id) => { calls.push(`remove:${id}`); };

  const id = await ctrl.addAndConfigureNetwork('SecureNet', 'password123');
  t.equal(id, '5', 'returns new ID');
  t.deepEqual(calls, [
    'add',
    'set:5:ssid:SecureNet',
    'set:5:psk:password123',
    'enable:5',
    'save'
  ], 'calls methods in order for WPA');
  t.end();
});

test('addAndConfigureNetwork adds and configures open network', async t => {
  const ctrl = new WpaCtrl();
  let calls = [];
  ctrl.addNetwork = async () => { calls.push('add'); return '6'; };
  ctrl.setNetwork = async (id, key, value) => { calls.push(`set:${id}:${key}:${value}`); return 'OK'; };
  ctrl.enableNetwork = async (id) => { calls.push(`enable:${id}`); return 'OK'; };
  ctrl.saveConfig = async () => { calls.push('save'); return 'OK'; };

  const id = await ctrl.addAndConfigureNetwork('OpenNet');
  t.equal(id, '6', 'returns new ID');
  t.deepEqual(calls, [
    'add',
    'set:6:ssid:OpenNet',
    'set:6:key_mgmt:NONE',
    'enable:6',
    'save'
  ], 'calls methods
