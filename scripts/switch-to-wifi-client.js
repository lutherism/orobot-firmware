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

const createWPAConf = () => {
  if (singleton.DeviceData.wifiSettings.username) {
    return `country=US
  ctrl_interface=/run/wpa_supplicant
  update_config=1
  freq_list=2412 2417 2422 2427 2432 2437 2442 2447 2452 2457 2462 2467 2472

  network={
    proto=RSN
	key_mgmt=WPA-EAP
	pairwise=CCMP
	auth_alg=OPEN
	eap=PEAP
	phase2="auth=MSCHAPV2"
	identity="$USERNAME"
	password=hash:$PASSWORD
   ssid="${singleton.DeviceData.wifiSettings.ssid}"
   password="${singleton.DeviceData.wifiSettings.password}"
   identity="${singleton.DeviceData.wifiSettings.username}"
   priority=100
  }
  `;
  }
  return `country=US
ctrl_interface=/run/wpa_supplicant
update_config=1
freq_list=2412 2417 2422 2427 2432 2437 2442 2447 2452 2457 2462 2467 2472

network={
 ssid="${singleton.DeviceData.wifiSettings.ssid}"
 psk="${singleton.DeviceData.wifiSettings.password}"
 priority=100
}
`;
}

const createDHCPConf = () => {
  return ``
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
}

module.exports = {
  writeWPAConf, createWPAConf
}
