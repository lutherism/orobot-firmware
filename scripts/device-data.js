var fs = require('fs');
const singleton = {};
const dataPath = __dirname + '/openroboticsdata/data.json';
function refreshDeviceData() {
  singleton.DeviceData = JSON.parse(fs.readFileSync(__dirname + '/openroboticsdata/data.json'));
}

function upsertDeviceData(data) {
  refreshDeviceData();
  fs.writeFileSync(dataPath, JSON.stringify({
    ...singleton.DeviceData,
    ...data
  }));
  refreshDeviceData();
}

function initDataFile() {
  console.log('creating datafile at ' + dataPath);
  fs.writeFileSync(dataPath, '{}');
  refreshDeviceData();
}

try {
  refreshDeviceData();
} catch (err) {
  console.log(err);
  //console.log(fs.readFileSync(__dirname + '/openroboticsdata/data.json'))
  initDataFile();
}

const exp = {singleton,
  upsertDeviceData, refreshDeviceData, initDataFile};

module.exports = exp;
