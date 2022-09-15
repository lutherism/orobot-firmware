var WiFiControl = require('wifi-control');
const {singleton,
  upsertDeviceData,
  refreshDeviceData} = require('./device-data.js');
const {exec} = require('child_process');

//  Initialize wifi-control package with verbose output
WiFiControl.init({
  debug: true
});

export default (req, res) => {
  if (req.method === 'POST') {
    upsertDeviceData({
      wifiSettings: {
        ssid: req.body.ssid,
        password: req.body.password
      }
    });
    exec(`sudo ${__dirname}/../../reboot.sh`, () => {
      process.exit(0);
    });
    /*WiFiControl.connectToAP(req.body, function(err, response) {
      if (err) console.log(err);
      res.status(200).json(response);
    });*/
  } else {
    WiFiControl.scanForWiFi(function(err, response) {
      if (err) console.log(err);
      res.status(200).json(response);
    });
  }
}
