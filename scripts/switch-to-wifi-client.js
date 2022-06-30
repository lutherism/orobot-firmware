const {spawn} = require('child_process');
const fs = require('fs');

const currentData = JSON.parse(
  fs.readFileSync(__dirname + '/openroboticsdata/data.json')
);

const wpaConfPath = "/etc/wpa_supplicant/wpa_supplicant.conf";

const createWPAConf = ({
  ssid, psk
}) => {
  return `ctrl_interface=/run/wpa_supplicant
update_config=1

network={
 ssid="${currentData.wifiSettings.ssid}"
 psk="${currentData.wifiSettings.psk}"
}`;
}

const writeWPAConf = () => {
  fs.writeFileSync(wpaConfPath, createWPAConf());
}

module.exports = {
  writeWPAConf, createWPAConf
}
