const express = require('express')
const app = express()
const { spawn, exec } = require('child_process');

app.use(express.static('public'))

app.post('/api/goto-client', (req, res) => {
  exec('sudo /home/pi/orobot-firmware/switch-to-wifi-client.sh', () => {
    exec('sudo /home/pi/orobot-firmware/reboot.sh');
    res.send('ok');
  });
});

app.get('/api/wifi', (req, res) => {
  const results = exec("sudo iwlist wlan0 scan", (e, o, err) => {
    res.send({
      wifi: o.split('      Cell')
    });
  });
});

app.listen(3006);
