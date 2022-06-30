const express = require('express')
const app = express()
const { spawn, syncSpawn } = require('child_process');

app.use(express.static('public'))

app.post('/api/goto-client', () => {
  spawn('/home/pi/orobot-firmware/switch-to-wifi-client.sh');
  res.send('ok');
});

app.post('/api/wifi', (req, res) => {
  const results = syncSpawn('sudo iwlist wlan0 scan | grep ESSID');
  res.send(JSON.stringify(results.output));
});

app.listen(3006)
