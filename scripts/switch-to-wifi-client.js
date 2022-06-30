const {spawn} = require('child_process');
const fs = require('fs');

const currentData = JSON.parse(
  fs.readFileSync(__dirname + '/openroboticsdata/data.json')
);

const wpaConfPath = "/etc/wpa_supplicant/wpa_supplicant.conf";

const createWPAConf = () => {
  return `country=US
ctrl_interface=/run/wpa_supplicant
update_config=1

network={
 ssid="The Internet"
 psk="alexjansen"
}`;
}

const writeWPAConf = () => {
  fs.writeFileSync(wpaConfPath, createWPAConf());
}

module.exports = {
  writeWPAConf, createWPAConf
}
