const express = require('express')
const app = express()
const { spawn, exec } = require('child_process');
const fs = require('fs');
const bodyParser = require('body-parser');
const {
  singleton,
  upsertDeviceData
} = require('./scripts/device-data.js');
const logger = require('koa-logger');
const EventEmitter = require('events');
const apServerEvents = new EventEmitter();
var morgan = require('morgan');

app.use(express.static('public'));
app.use(bodyParser.json());
app.use(morgan('combined'));

app.post('/api/goto-client', (req, res) => {
  res.send('ok');
  exec('sudo /home/pi/orobot-firmware/switch-to-wifi-client.sh', () => {
    exec('sudo /home/pi/orobot-firmware/kill-keep-alive.sh', () => {
      exec('sudo /home/pi/orobot-firmware/reboot.sh');
    });
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
    apServerEvents.emit('switch-to-client');
  });
});

module.exports = {
  apServerEvents,
  apServerListen: () => {
    app.listen(3006);
  }
}
