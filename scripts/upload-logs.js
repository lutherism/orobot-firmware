var path = require('path');
var fs = require('fs');
var {authRequest} = require('./api.js');

const filesToUpload = ['run.log', 'run-err.log', 'reboot.log', 'web.log'];
const logsRootDir = 'tmp';
const deleteLogsOnUpload = true;
const dataFilePath = __dirname + '/openroboticsdata/data.json';
const gapBetweenUploads = 1000 * 60 * 60 * 24;

function uploadAndClearLogs() {
  const deviceData = fs.readFileSync(dataFilePath);
  const deviceDataJSON = JSON.parse(deviceData);
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
        key: deviceDataJSON.deviceUuid + '/' + logTime + '/' + fileName,
        body: fileContent.toString()
      })
    }).catch(() => Promise.resolve());
  }));
}

function syncLogsIfAfterGap() {
  const deviceData = fs.readFileSync(dataFilePath);
  const deviceDataJSON = JSON.parse(deviceData);
  if (!deviceDataJSON.lastLogUpload ||
    Date.now() - deviceDataJSON.lastLogUpload > gapBetweenUploads) {
    uploadAndClearLogs().then(() => {
      filesToUpload.map(fileName => {
        const targetLogFile = __dirname + '/../' + logsRootDir + '/' + fileName;
        try {
          fs.unlink(targetLogFile);
        } catch (e) {
          return Promise.resolve();
        }
      });
      deviceDataJSON.lastLogUpload = Date.now();
      fs.writeFileSync(dataFilePath, JSON.stringify(deviceDataJSON));
    });
  }
}

module.exports = {syncLogsIfAfterGap, uploadAndClearLogs}
