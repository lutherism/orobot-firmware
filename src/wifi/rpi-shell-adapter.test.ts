import { describe, it, expect } from 'vitest';
import { parseIwlistOutput } from './rpi-shell-adapter.js';

// Canned iwlist scan output matching the Cell split format used by parseIwlistOutput.
// parseIwlistOutput splits on '      Cell' and then trims each sub-line.
// The Address appears on its own line after the Cell header line.
const IWLIST_SAMPLE = `wlan0     Scan completed :
      Cell 01 - Address: dummy
                Address: AA:BB:CC:DD:EE:01
                ESSID:"HomeNetwork"
                Protocol:IEEE 802.11bgn
                Mode:Master
                Frequency:2.412 GHz (Channel 1)
                IE: IEEE 802.11i/WPA2 Version 1
                Encryption key:on
                Bit Rates:300 Mb/s
                Extra:rssi=-55
                Extra: Last beacon: 30ms ago
      Cell 02 - Address: dummy
                Address: AA:BB:CC:DD:EE:02
                ESSID:"OpenWifi"
                Protocol:IEEE 802.11bgn
                Mode:Master
                Frequency:2.437 GHz (Channel 6)
                Encryption key:off
                Bit Rates:54 Mb/s
                Extra:rssi=-70
                Extra: Last beacon: 50ms ago
      Cell 03 - Address: dummy
                Address: AA:BB:CC:DD:EE:03
                ESSID:"HomeNetwork"
                Protocol:IEEE 802.11bgn
                Mode:Master
                Frequency:5.180 GHz (Channel 36)
                IE: IEEE 802.11i/WPA2 Version 1
                Encryption key:on
                Bit Rates:300 Mb/s
                Extra:rssi=-60
                Extra: Last beacon: 20ms ago
`;

describe('parseIwlistOutput', () => {
  it('parses SSID from each cell', () => {
    const results = parseIwlistOutput(IWLIST_SAMPLE);
    const ssids = results.map(r => r.ssid);
    expect(ssids).toContain('HomeNetwork');
    expect(ssids).toContain('OpenWifi');
  });

  it('parses MAC address from each cell', () => {
    const results = parseIwlistOutput(IWLIST_SAMPLE);
    const home = results.find(r => r.ssid === 'HomeNetwork');
    expect(home).toBeDefined();
    expect(home!.mac).toBe('AA:BB:CC:DD:EE:01');
  });

  it('parses security from IE line (slice(15) of "IE: IEEE 802.11X…")', () => {
    // parseIwlistOutput does t.slice(15) on the "IE: IEEE …" line.
    // "IE: IEEE 802.11i/WPA2 Version 1"[15] === 'i', so security = 'i/WPA2 Version 1'
    const results = parseIwlistOutput(IWLIST_SAMPLE);
    const home = results.find(r => r.ssid === 'HomeNetwork');
    expect(home).toBeDefined();
    expect(home!.security).toBe('i/WPA2 Version 1');
  });

  it('deduplicates SSIDs — keeps first occurrence only', () => {
    const results = parseIwlistOutput(IWLIST_SAMPLE);
    const homeEntries = results.filter(r => r.ssid === 'HomeNetwork');
    expect(homeEntries).toHaveLength(1);
    // First Cell wins
    expect(homeEntries[0].mac).toBe('AA:BB:CC:DD:EE:01');
  });

  it('returns unique results count', () => {
    const results = parseIwlistOutput(IWLIST_SAMPLE);
    // 3 cells but HomeNetwork is duplicated — expect 2 unique
    expect(results).toHaveLength(2);
  });

  it('returns empty array for empty input', () => {
    expect(parseIwlistOutput('')).toEqual([]);
  });

  it('returns empty array for header-only input (no cells)', () => {
    expect(parseIwlistOutput('wlan0     Scan completed :\n')).toEqual([]);
  });

  it('handles missing security field gracefully', () => {
    const results = parseIwlistOutput(IWLIST_SAMPLE);
    const open = results.find(r => r.ssid === 'OpenWifi');
    expect(open).toBeDefined();
    expect(open!.security).toBe('');
  });
});
