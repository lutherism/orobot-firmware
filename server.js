const express = require('express')
const app = express()
const { spawn, exec } = require('child_process');

app.use(express.static('public'))

app.post('/api/goto-client', () => {
  spawn('/home/pi/orobot-firmware/switch-to-wifi-client.sh');
  res.send('ok');
});

app.post('/api/wifi', (req, res) => {
  const results = exec('sudo iwlist wlan0 scan | grep ESSID', (e, o, err) => {
    res.send(o);
  });
});

app.listen(3006)
