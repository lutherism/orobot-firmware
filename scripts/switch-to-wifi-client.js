const {spawn} = require('child_process');
const fs = require('fs');
const {singleton,
  upsertDeviceData,
  refreshDeviceData} = require('./device-data.js');


const wpaConfPath = "/etc/wpa_supplicant/wpa_supplicant.conf";
const dnsConfPath = "/etc/dnsmasq.conf";
const hostsPath = "/etc/hosts";
const hostAPDPath = "/etc/hostapd/hostapd.conf";
const dhcpPath = "/etc/dhcpcd.conf";
const networkingPath = "/etc/network/interfaces";

const createWPAConf = () => {
  if (singleton.DeviceData.wifiSettings.username) {
    return `country=US
ctrl_interface=/run/wpa_supplicant
update_config=1
ap_scan=1
freq_list=2412 2417 2422 2427 2432 2437 2442 2447 2452 2457 2462 2467 2472

network={
  proto=RSN
	key_mgmt=WPA-EAP
	pairwise=CCMP
	auth_alg=OPEN
	eap=PEAP
	phase2="auth=MSCHAPV2"
  ssid="${singleton.DeviceData.wifiSettings.ssid}"
  password=hash:${singleton.DeviceData.wifiSettings.password}
  identity="${singleton.DeviceData.wifiSettings.username}"
  priority=100
}
  `;
  }
  return `country=US
ctrl_interface=/var/run/wpa_supplicant
update_config=1
ap_scan=1
freq_list=2412 2417 2422 2427 2432 2437 2442 2447 2452 2457 2462 2467 2472

network={
 ssid="${singleton.DeviceData.wifiSettings.ssid}"
 psk="${singleton.DeviceData.wifiSettings.password}"
 priority=100
 mode=1
}
`;
}

const createDHCPConf = () => {
  return ``
}

const createNetworkingConf = () => {
  return `
source-directory /etc/network/interfaces.d
auto wlan0
iface wlan0 inet manual
wpa_conf /etc/wpa_supplicant/wpa_supplicant.conf
wpa_cli log_level debug
pre-up wpa_supplicant -B -iwlan0 -c/etc/wpa_supplicant/wpa_supplicant.conf -f /var/log/wpa_supplicant.log
post-down wpa_cli -i wlan0 terminate
`
}

const createDNSConf = () => {
  return '#empty';
}

const hostAPDConf = () => {
  return ``;
}

const createHosts = () => {
  return `127.0.0.1	localhost
::1		localhost ip6-localhost ip6-loopback
ff02::1		ip6-allnodes
ff02::2		ip6-allrouters

127.0.1.1		raspberrypi`;
}

const writeWPAConf = () => {
  fs.writeFileSync(wpaConfPath, createWPAConf());
  fs.writeFileSync(dnsConfPath, createDNSConf());
  fs.writeFileSync(hostsPath, createHosts());
  fs.writeFileSync(hostAPDPath, hostAPDConf());
  fs.writeFileSync(dhcpPath, createDHCPConf());
  fs.writeFileSync(networkingPath, createNetworkingConf())
}

module.exports = {
  writeWPAConf, createWPAConf
}
