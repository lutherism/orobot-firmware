var WiFiControl = require('wifi-control');

//  Initialize wifi-control package with verbose output
WiFiControl.init({
  debug: true
});

export default (req, res) => {
  if (req.method === 'POST') {
    WiFiControl.connectToAP(req.body, function(err, response) {
      if (err) console.log(err);
      res.status(200).json(response);
    });
  } else {
    WiFiControl.scanForWiFi(function(err, response) {
      if (err) console.log(err);
      res.status(200).json(response);
    });
  }
}
