const express = require('express')
const app = express()
const { spawn, exec } = require('child_process');
const fs = require('fs');
const bodyParser = require('body-parser');

app.use(express.static('public'));
app.use(bodyParser.json());

app.post('/api/goto-client', (req, res) => {
  res.send('ok');
  exec('sudo /home/pi/orobot-firmware/switch-to-wifi-client.sh', () => {
    exec('sudo /home/pi/orobot-firmware/reboot.sh');
  });
});

app.get('/api/wifi', (req, res) => {
  const results = exec("sudo iwlist wlan0 scan", (e, o, err) => {
    res.send({
      wifi: o.split('      Cell')
    });
  });
});

app.post('/api/wifi', (req, res) => {
  const currentData = JSON.parse(
    fs.readFileSync(__dirname + '/scripts/openroboticsdata/data.json')
  );
  if (!currentData.wifiSettings) {
    currentData.wifiSettings = {};
  }
  currentData.wifiSettings.ssid = req.body.ssid;
  currentData.wifiSettings.password = req.body.password;
  fs.writeFileSync(__dirname + '/scripts/openroboticsdata/data.json',
    JSON.stringify(currentData));
  res.send('ok');
  exec('sudo /home/pi/orobot-firmware/switch-to-wifi-client.sh', () => {
    exec('sudo /home/pi/orobot-firmware/reboot.sh');
  });
});

app.listen(3006);
