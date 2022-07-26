var fs = require('fs');
var uuid = require('uuid');
var request = require('request');
var childProcess = require('child_process');
const {singleton,
  upsertDeviceData,
  refreshDeviceData,
  initDataFile} = require('./device-data.js');

const {exec} = childProcess;

const DEFAULT_DEVICE_UUID = '6be50aff-6f10-4643-bfda-7d5bf15319c9';

fs.readFile(__dirname + '/datatemplates/data_template.json', (err, data) => {
  const newDriverUuid = uuid.v4();
  initDataFile();
  upsertDeviceData({
    ...JSON.parse(data),
    deviceUuid: newDriverUuid
  });
  request.post('https://robots-gateway.uc.r.appspot.com/api/device', {
    json: true,
    body: {
      uuid: newDriverUuid,
      name: 'newborn'
    }
  }, (err, res) => {
    console.log(err, res);
  });
});
