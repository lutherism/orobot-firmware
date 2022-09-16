const express = require('express')
const app = express()
const { spawn, exec } = require('child_process');
const fs = require('fs');
const bodyParser = require('body-parser');
const {
  singleton,
  upsertDeviceData
} = require('./scripts/device-data.js');

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
  upsertDeviceData({
    wifiSettings: {
      ssid: req.body.ssid,
      password: req.body.password
    },
    networkMode: 'client'
  });
  res.send('ok');
  exec('sudo /home/pi/orobot-firmware/switch-to-wifi-client.sh', () => {
    exec('sudo /home/pi/orobot-firmware/reboot.sh');
  });
});

app.listen(3006);
