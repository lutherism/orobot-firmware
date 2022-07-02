const express = require('express')
const app = express()
const { spawn, exec } = require('child_process');
const fs = require('fs');

app.use(express.static('public'))

app.post('/api/goto-client', (req, res) => {
  exec('sudo /home/pi/orobot-firmware/switch-to-wifi-client.sh', () => {
    res.send('ok');
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
    fs.readFileSync(__dirname + '/openroboticsdata/data.json')
  );
  if (!currentData.wifiSettings) {
    currentData.wifiSettings = {};
  }
  currentData.wifiSettings.ssid = req.body.ssid;
  currentData.wifiSettings.password = req.body.password;
  fs.writeFileSync(__dirname + '/openroboticsdata/data.json',
    JSON.stringify(currentData));
  res.send('ok');
  exec('sudo /home/pi/orobot-firmware/switch-to-wifi-client.sh', () => {
    exec('sudo /home/pi/orobot-firmware/reboot.sh');
  });
});

app.listen(3006);
