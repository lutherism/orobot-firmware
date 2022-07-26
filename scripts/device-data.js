var fs = require('fs');
const singleton = {};

function refreshDeviceData() {
  singleton.DeviceData = JSON.parse(fs.readFileSync(__dirname + '/openroboticsdata/data.json'));
}

function upsertDeviceData(data) {
  refreshDeviceData();
  fs.writeFileSync(__dirname + '/openroboticsdata/data.json', JSON.stringify({
    ...singleton.DeviceData,
    ...data
  }));
  refreshDeviceData();
}

function initDataFile() {
  fs.linkSync(__dirname + '/openroboticsdata/data.json');
  fs.writeFileSync(__dirname + '/openroboticsdata/data.json', '{}');
  refreshDeviceData();
}

refreshDeviceData();

const exp = {singleton,
  upsertDeviceData, refreshDeviceData, initDataFile};

module.exports = exp;
