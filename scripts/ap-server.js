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
    const results = exec("sudo iwlist wlan0 scan", {encoding: "UTF-8"}, (e, o, err) => {
      res.send({
        wifi: o.split('      Cell')
      });
    });
  }
});

app.post('/api/wifi', (req, res) => {
  const uniqueKnownSSIDs = {};
  console.log('logging into wifi');
  console.log('SSID: ' + req.body.ssid);
  console.log('password: ' + req.body.password[0] + Array(req.body.password.length - 1)
    .fill(0).reduce((a) => a + "*", ""));
  upsertDeviceData({
    wifiSettings: {
      ssid: req.body.ssid,
      username: req.body.username,
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
      if (!uniqueKnownSSIDs[n.ssid] && !n.username) {
        uniqueKnownSSIDs[n.ssid] = true;
        return true;
      }
      return false;
    }),
    networkMode: 'client'
  });
  res.send({
    ok: true
  });
  exec('sudo /home/pi/orobot-firmware/switch-to-wifi-client.sh', () => {
    apServerEvents.emit('switch-to-client');
  });
});

let started = false;
module.exports = {
  apServerEvents,
  apServerListen: () => {
    exec('sudo iptables -t nat -F');

    // Redirect HTTP traffic to the local web server (port 80)
    exec('sudo iptables -t nat -A PREROUTING -p tcp --dport 80 -j REDIRECT --to-port 3128');
    exec('sudo iptables -t nat -A PREROUTING -p tcp --dport 443 -j REDIRECT --to-port 3128');
    // Allow traffic from the local web server (port 80)
    exec('sudo iptables -A INPUT -p tcp --dport 3128 -j ACCEPT');
    if (!started) {
      try {
        app.listen(3006);
        started = true;
        console.log('listening to 3006');
      } catch (e) {

      }
    }
  }
}
