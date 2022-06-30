const request = require('request');
const fs = require('fs');

const WS_URL = process.env.NODE_ENV === 'local' ?
  'ws://localhost:8080/' : 'wss://robots-gateway.uc.r.appspot.com/';
const API_URL = process.env.NODE_ENV === 'local' ?
  'http://localhost:8080' : 'https://robots-gateway.uc.r.appspot.com';
const dataFilePath = './openroboticsdata/data.json';

function checkRegisteredAndGetSession() {
  fs.readFile(dataFilePath)
    .then(file => {
      const data = JSON.parse(file.body);
      if (data.sessionUUID) {
        return request({
          url: API_URL + '/device-session/' + data.sessionUUID
        }).then(sessionData => {
          if (!sessionData.body.ok) {
            data.sessionUUID = null;
            fs.writeFileSync(
              dataFilePath,
              JSON.stringify(data));
            return getRegisteredOwner(data.deviceUuid);
          }
        });
      } else if (data.deviceUuid) {
        getRegisteredOwner(data.deviceUuid);
      } else {
        throw new Error('no device uuid');
      }
    });
}

function getRegisteredOwner(deviceUuid) {
  return request({
    url: API_URL + '/device/' + deviceUuid
  }).then(deviceData => {
    if (deviceData.body.owner.uuid) {
      return login(deviceUuid, deviceData.body.owner.uuid);
    }
  });
}

function login(deviceUuid, userUuid) {
  let sessionUuid;
  return request({
    method: 'post',
    url: API_URL + '/device-session',
    body: {
      deviceUuid,
      userUuid
    }
  }).then(sessionData => {
    sessionUuid = sessionData.body.sessionUuid;
    return fs.readFile(dataFilePath);
  }).then(dataFile => {
    const data = JSON.parse(dataFile.body);
    data.sessionUuid = sessionUuid;
    return fs.writeFile(dataFilePath, JSON.stringify(data));
  });
}

export default checkRegisteredAndGetSession;
