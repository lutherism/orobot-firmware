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
      url: (singleton.DeviceData.network === 'dev' ?
        DEV_URL : API_URL) + options.url,
      headers: Object.assign((options.headers || {}), {
        'Cookies': ((options.headers || {}).Cookies || '') + '_oss=' + sessionUuid + ';'
      })
    });
    request(filledOptions, (res, err) => {
      if (err) {
        return reject(err);
      }
      resolve(res);
    });
  });
};

module.exports = {authRequest};
