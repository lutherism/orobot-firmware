var request = require('request');
const {singleton,
  upsertDeviceData,
  refreshDeviceData} = require('./device-data.js');

let sessionUuid = null;

const API_URL = 'https://robots-gateway.uc.r.appspot.com/api';
const DEV_URL = () => {
  return `http://${singleton.DeviceData.devIP ||
    '192.168.68.224'}:8080`
};

function authRequest(options) {
  return new Promise((resolve, reject) => {
    const filledOptions = Object.assign(options, {
      url: (singleton.DeviceData.networkMode === 'dev' ?
        DEV_URL : API_URL) + options.url,
      headers: Object.assign((options.headers || {}), {
        'Content-Type': 'application/json',
        'Cookies': ((options.headers || {}).Cookies || '') + '_oss=' + sessionUuid + ';'
      })
    });
    request(filledOptions, (err, resp, body) => {
      if (err) {
        console.log('req error', err);
        return reject(err);
      }
      console.log('got repsonse', res);
      resolve(body);
    });
  });
};

module.exports = {authRequest};
