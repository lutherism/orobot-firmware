const {spawn} = require('child_process');

const upWifiAP = () => {
  spawn(__dirname + '/../switch-to-wifi-ap.sh');
}

module.exports = {
  upWifiAP
}
