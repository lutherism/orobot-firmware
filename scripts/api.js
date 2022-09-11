var request = require('request');
const {singleton,
  upsertDeviceData,
  refreshDeviceData} = require('./device-data.js');

let sessionUuid = 'f6fb95cd-9c6d-43d5-9446-2d6e034de0a5';

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
        'Cookies': ((options.headers || {}).Cookies || '') + '_oss=' + sessionUuid + ';'
      })
    });
    console.log(filledOptions.url);
    request(filledOptions, (err, resp, body) => {
      if (err) {
        console.log('req error', err);
        return reject(err);
      }
      console.log('got repsonse', body);
      resolve(body);
    });
  });
};

module.exports = {authRequest};
