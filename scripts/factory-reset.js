var fs = require('fs');
var path = require('path');
var uuid = require('uuid');
var request = require('request');
var childProcess = require('child_process');

const { exec } = childProcess;

const newDriverUuid = uuid.v4();
const template = JSON.parse(
  fs.readFileSync(path.join(__dirname, 'datatemplates/data_template.json'), 'utf8')
);
const dataDir  = path.join(__dirname, 'openroboticsdata');
if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });
fs.writeFileSync(path.join(dataDir, 'data.json'), JSON.stringify({
  ...template,
  hardware:   childProcess.execSync('uname -a').toString().includes('raspberrypi') ? 'raspi' : 'banana',
  deviceUuid: newDriverUuid,
}));

console.log('sending POST /device');
request.post('https://robots-gateway-v2.wl.r.appspot.com/api/device', {
  json: true,
  body: {
    uuid: newDriverUuid,
    name: 'newborn',
  },
}, (err, res) => {
  console.log('POST /device returned: ', err, res && res.statusCode);
});
