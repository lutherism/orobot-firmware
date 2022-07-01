const {spawn} = require('child_process');
const fs = require('fs');

const currentData = JSON.parse(
  fs.readFileSync(__dirname + '/openroboticsdata/data.json')
);

const wpaConfPath = "/etc/wpa_supplicant/wpa_supplicant.conf";
const dnsConfPath = "/etc/dnsmasq.conf";
const hostsPath = "/etc/hosts";
const hostAPDPath = "/etc/hostapd/hostapd.conf";

const createWPAConf = () => {
  return `country=US
ctrl_interface=DIR=/var/run/wpa_supplicant GROUP=netdev
update_config=1

network={
    ssid=OROBOT-Setup-${currentData.deviceUuid.slice(0, 5)}
    mode=2
    proto=wpa
    key_mgmt=WPA-PSK
    psk="wifisetup"
    frequency=2412
}`;
}

const createDNSConf = () => {
  return `interface=wlan0 # Listening interface
dhcp-range=192.168.4.2,192.168.4.20,255.255.255.0,24h
                # Pool of IP addresses served via DHCP
domain=wlan     # Local wireless DNS domain
address=/gw.wlan/192.168.4.1
                # Alias for this router`;
}

const hostAPDConf = () => {
  return `interface=wlan0
#If this fails, try rt1871xdrv a
driver=nl80211
# Name of the new network: best use the hostname
ssid=OROBOT-Setup-${currentData.deviceUuid.slice(0, 5)}

# Pick a channel not already in use
channel=6
# Change to b for older devices?
hw_mode=g
macaddr_acl=0
auth_algs=3
# Disable this to insure the AP is visible:
ignore_broadcast_ssid=0
wpa=2
wpa_passphrase=wifisetup
wpa_key_mgmt=WPA-PSK
wpa_pairwise=TKIP
rsn_pairwise=CCMP`;
}

const createHosts = () => {
  return `127.0.0.1	localhost
::1		localhost ip6-localhost ip6-loopback
ff02::1		ip6-allnodes
ff02::2		ip6-allrouters

127.0.1.1		raspberrypi
127.0.1.1:3006 orobot.io`;
}

const upWifiAP = () => {
  fs.writeFileSync(wpaConfPath, createWPAConf());
  fs.writeFileSync(dnsConfPath, createDNSConf());
  fs.writeFileSync(hostsPath, createHosts());
  fs.writeFileSync(hostAPDPath, hostAPDConf());
}

module.exports = {
  upWifiAP
}
