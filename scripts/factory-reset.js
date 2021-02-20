var fs = require('fs');
var uuid = require('uuid');
var request = require('request');
var childProcess = require('child_process');

const {exec} = childProcess;

const DEFAULT_DEVICE_UUID = '6be50aff-6f10-4643-bfda-7d5bf15319c9';

fs.readFile('./openroboticsdata/data_template.json', data => {
  const newDriverUuid = uuid();
  fs.unlinkSync(__dirname + '/openroboticsdata/data.json');
  fs.writeFileSync(__dirname + '/openroboticsdata/data.json', JSON.stringify({
    deviceUuid: newDriverUuid
  }));
  request.post('https://robots-gateway.uc.r.appspot.com/api/device', {
    json: true,
    body: {
      uuid: newDriverUuid,
      name: 'newborn'
    }
  }, (err, res) => {
    console.log(err, res);
    setupCronJob();
  });
});

function setupCronJob() {
  exec(`crontab ${__dirname}/reboot.cron`);
}
