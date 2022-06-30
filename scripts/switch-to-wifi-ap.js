const {spawn} = require('child_process');
const fs = require('fs');

const currentData = JSON.parse(
  fs.readFileSync(__dirname + '/openroboticsdata/data.json')
);

const wpaConfPath = "/etc/wpa_supplicant/wpa_supplicant.conf";

const createWPAConf = () => {
  return `country=US
ctrl_interface=DIR=/var/run/wpa_supplicant GROUP=netdev
update_config=1

network={
    ssid="OROBOT-Setup-${currentData.deviceUuid.slice(0, 5)}"
    mode=2
    key_mgmt=WPA-PSK
    psk="wifisetup"
    frequency=2412
}`;
}

const upWifiAP = () => {
  fs.writeFileSync(wpaConfPath, createWPAConf());
}

module.exports = {
  upWifiAP
}
