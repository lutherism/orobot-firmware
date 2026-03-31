// Production WiFi adapter. Only runs correctly on Raspberry Pi OS.
// In development and tests, use MockWifiShellAdapter instead.
import { execFile as execFileCb } from 'child_process';
import { promisify } from 'util';
import fs from 'fs/promises';
import type { WifiShellAdapter } from './types';
import type { ScanResult, WifiCredentials } from '../core/types';

const execFile = promisify(execFileCb);

const WPA_CONF   = '/etc/wpa_supplicant/wpa_supplicant.conf';
const PEER_IP    = '192.168.0.172';
const PEER_DELAY = 3000; // ms to wait for wlan0 to associate with peer AP

function parseIwlistOutput(raw: string): ScanResult[] {
  const cells  = raw.split('      Cell').slice(1);
  const seen:  Record<string, boolean> = {};
  const out:   ScanResult[] = [];
  for (const cell of cells) {
    let ssid = '', mac = '', security = '';
    for (const line of cell.split('\n')) {
      const t = line.trim();
      if (t.startsWith('ESSID:'))   ssid     = t.slice(7, -1);
      if (t.startsWith('Address:')) mac      = t.split('Address: ')[1] ?? '';
      if (t.startsWith('IE: IEEE')) security = t.slice(15);
    }
    if (ssid && !seen[ssid]) {
      seen[ssid] = true;
      out.push({ ssid, mac, security });
    }
  }
  return out;
}

export class RpiWifiShellAdapter implements WifiShellAdapter {
  async scanNetworks(): Promise<ScanResult[]> {
    const { stdout } = await execFile('sudo', ['iwlist', 'wlan0', 'scan']);
    return parseIwlistOutput(stdout);
  }

  async connectToNetwork(creds: WifiCredentials): Promise<void> {
    const conf = [
      'ctrl_interface=DIR=/var/run/wpa_supplicant GROUP=netdev',
      'update_config=1',
      'country=US',
      '',
      'network={',
      `  ssid="${creds.ssid}"`,
      `  psk="${creds.password}"`,
      '}',
    ].join('\n');
    await fs.writeFile(WPA_CONF, conf);
    await execFile('sudo', ['wpa_cli', '-i', 'wlan0', 'reconfigure']);
  }

  async startAP(): Promise<void> {
    await execFile('sudo', ['iptables', '-t', 'nat', '-F']);
    await execFile('sudo', ['iptables', '-t', 'nat', '-A', 'PREROUTING',
      '-p', 'tcp', '--dport', '80', '-j', 'REDIRECT', '--to-port', '3006']);
    await execFile('sudo', ['iptables', '-t', 'nat', '-A', 'PREROUTING',
      '-p', 'tcp', '--dport', '443', '-j', 'REDIRECT', '--to-port', '3006']);
    await execFile('sudo', ['iptables', '-A', 'INPUT',
      '-p', 'tcp', '--dport', '3006', '-j', 'ACCEPT']);
    await execFile('sudo', ['systemctl', 'start', 'hostapd']);
    await execFile('sudo', ['systemctl', 'start', 'dnsmasq']);
  }

  async stopAP(): Promise<void> {
    await execFile('sudo', ['systemctl', 'stop', 'hostapd']);
    await execFile('sudo', ['systemctl', 'stop', 'dnsmasq']);
    await execFile('sudo', ['iptables', '-t', 'nat', '-F']);
  }

  async pushCredentials(targetSsid: string, creds: WifiCredentials): Promise<void> {
    // Join peer AP temporarily
    await execFile('sudo', ['wpa_cli', '-i', 'wlan0', 'add_network']);
    await execFile('sudo', ['wpa_cli', '-i', 'wlan0', 'set_network', '1', 'ssid', `"${targetSsid}"`]);
    await execFile('sudo', ['wpa_cli', '-i', 'wlan0', 'set_network', '1', 'key_mgmt', 'NONE']);
    await execFile('sudo', ['wpa_cli', '-i', 'wlan0', 'select_network', '1']);
    await new Promise<void>((resolve) => setTimeout(resolve, PEER_DELAY));
    // POST credentials to peer captive portal
    await fetch(`http://${PEER_IP}/api/wifi`, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify(creds),
    });
    // Restore original configuration
    await execFile('sudo', ['wpa_cli', '-i', 'wlan0', 'remove_network', '1']);
    await execFile('sudo', ['wpa_cli', '-i', 'wlan0', 'reconfigure']);
  }
}
