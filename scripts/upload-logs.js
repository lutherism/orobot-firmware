var path = require('path');
var fs = require('fs');
var {authRequest} = require('./api.js');
const {singleton,
  upsertDeviceData,
  refreshDeviceData} = require('./device-data.js');

const filesToUpload = ['run.log', 'run-err.log'];
const logsRootDir = 'tmp';
const deleteLogsOnUpload = true;
const gapBetweenUploads = 1000 * 60 * 60 * 24;

function uploadAndClearLogs() {
  const logTime = (new Date()).toLocaleString();

  return Promise.all(filesToUpload.map(fileName => {
    const targetLogFile = __dirname + '/../' + logsRootDir + '/' + fileName;
    try {
      fileContent = fs.readFileSync(targetLogFile);
    } catch (e) {
      return Promise.resolve();
    }
    return authRequest({
      url: '/device-log',
      method: 'post',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        key: singleton.DeviceData.deviceUuid + '/' + logTime + '/' + fileName,
        body: fileContent.toString()
      })
    }).catch(() => Promise.resolve());
  }));
}

function syncLogsIfAfterGap() {
  if (!singleton.DeviceData.lastLogUpload ||
    Date.now() - singleton.DeviceData.lastLogUpload > gapBetweenUploads) {
    uploadAndClearLogs().then(() => {
      filesToUpload.map(fileName => {
        const targetLogFile = __dirname + '/../' + logsRootDir + '/' + fileName;
        try {
          fs.unlink(targetLogFile);
        } catch (e) {
          return Promise.resolve();
        }
      });
      upsertDeviceData({
        lastLogUpload: Date.now()
      });
    });
  }
}

module.exports = {syncLogsIfAfterGap, uploadAndClearLogs}
