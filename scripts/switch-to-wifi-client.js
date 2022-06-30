const {spawn} = require('child_process');
const fs = require('fs');

const currentData = JSON.parse(
  fs.readFileSync(__dirname + '/openroboticsdata/data.json')
);

const wpaConfPath = "/etc/wpa_supplicant/wpa_supplicant.conf";
const dnsConfPath = "/etc/dnsmasq.conf";

const createWPAConf = () => {
  return `country=US
ctrl_interface=/run/wpa_supplicant
update_config=1

network={
 ssid="The Internet"
 psk="alexjansen"
}`;
}

const createDNSConf = () => {
  return '#empty';
}

const writeWPAConf = () => {
  fs.writeFileSync(wpaConfPath, createWPAConf());
  fs.writeFileSync(dnsConfPath, createDNSConf());
}

module.exports = {
  writeWPAConf, createWPAConf
}
