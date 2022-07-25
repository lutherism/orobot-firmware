var fs = require('fs');
const singleton = {};

function refreshDeviceData() {
  singleton.DeviceData = JSON.parse(fs.readFileSync(__dirname + '/openroboticsdata/data.json'));
}

function upsertDeviceData(data) {
  refreshDeviceData();
  fs.writeFileSync(__dirname + '/openroboticsdata/data.json', JSON.stringiy({
    ...singleton.DeviceData,
    ...data
  }));
  refreshDeviceData();
}

refreshDeviceData();

const exp = {singleton,
  upsertDeviceData, refreshDeviceData};

module.exports = exp;
