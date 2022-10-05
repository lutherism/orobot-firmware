const express = require('express')
const app = express()
const { spawn, exec } = require('child_process');
const fs = require('fs');
const bodyParser = require('body-parser');
const process = require('process');

const {
  singleton,
  upsertDeviceData
} = require('./device-data.js');
const logger = require('koa-logger');
const EventEmitter = require('events');
const apServerEvents = new EventEmitter();
var morgan = require('morgan');
app.use(morgan('combined'));
app.use(express.static(__dirname + '/../public'));
app.use(bodyParser.json());


app.post('/api/goto-client', (req, res) => {
  res.send('ok');
  exec('sudo /home/pi/orobot-firmware/switch-to-wifi-client.sh', () => {
    exec('sudo /home/pi/orobot-firmware/kill-keep-alive.sh', () => {
      exec('sudo /home/pi/orobot-firmware/reboot.sh');
    });
  });
});

app.get('/api/known-wifi', (req, res) => {
  res.send({
    knownNetworks: singleton.DeviceData.knownNetworks || []
  });
});

app.get('/api/wifi', (req, res) => {
  if (process.platform === 'darwin') {
    exec('/System/Library/PrivateFrameworks/Apple80211.framework/Versions/Current/Resources/airport --scan', (e, o, err) => {
      res.send({macWifi: o.split('\n')});
    });
  } else {
    const results = exec("sudo iwlist wlan0 scan", (e, o, err) => {
      res.send({
        wifi: o.split('      Cell')
      });
    });
  }
});

app.post('/api/wifi', (req, res) => {
  const uniqueKnownMacs = {};
  upsertDeviceData({
    wifiSettings: {
      ssid: req.body.ssid,
      password: req.body.password
    },
    knownNetworks: [
      ...(singleton.DeviceData.knownNetworks || []),
      {
        ssid: req.body.ssid,
        mac: req.body.mac,
        password: req.body.password
      }
    ].filter(n => {
      if (!uniqueKnownMacs[n.mac]) {
        uniqueKnownMacs[n.mac] = true;
        return true;
      }
      return false;
    }),
    networkMode: 'client'
  });
  res.send('ok');
  exec('sudo /home/pi/orobot-firmware/switch-to-wifi-client.sh');
  setTimeout(() => {
    apServerEvents.emit('switch-to-client');
  }, 1000);
});

module.exports = {
  apServerEvents,
  apServerListen: () => {
    app.listen(3006);
  }
}
