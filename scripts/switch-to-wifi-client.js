const {spawn} = require('child_process');
const fs = require('fs');

const currentData = JSON.parse(
  fs.readFileSync(__dirname + '/openroboticsdata/data.json')
);

const wpaConfPath = "/etc/wpa_supplicant/wpa_supplicant.conf";
const dnsConfPath = "/etc/dnsmasq.conf";
const hostsPath = "/etc/hosts";
const hostAPDPath = "/etc/hostapd/hostapd.conf";
const dhcpPath = "/etc/dhcpcd.conf";

const createWPAConf = () => {
  return `country=US
ctrl_interface=/run/wpa_supplicant
update_config=1

network={
 ssid="The Internet"
 psk=alexjansen
}`;
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
