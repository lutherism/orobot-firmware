const {spawn} = require('child_process');
const fs = require('fs');

const currentData = JSON.parse(
  fs.readFileSync(__dirname + '/openroboticsdata/data.json')
);

const wpaConfPath = "/etc/wpa_supplicant/wpa_supplicant.conf";
const dnsConfPath = "/etc/dnsmasq.conf";

const createWPAConf = () => {
  return `country=US
ctrl_interface=DIR=/var/run/wpa_supplicant GROUP=netdev
update_config=1
proto=wpa

network={
    ssid="OROBOT-Setup-${currentData.deviceUuid.slice(0, 5)}"
    mode=2
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

const upWifiAP = () => {
  fs.writeFileSync(wpaConfPath, createWPAConf());
  fs.writeFileSync(dnsConfPath, createDNSConf());
}

module.exports = {
  upWifiAP
}
