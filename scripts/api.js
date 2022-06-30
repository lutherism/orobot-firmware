var request = require('request');

let sessionUuid = null;

const WS_URL = process.env.NODE_ENV === 'local' ?
  'ws://localhost:8080/' : 'wss://robots-gateway.uc.r.appspot.com/';
const API_URL = process.env.NODE_ENV === 'local' ?
  'http://localhost:8080/api' : 'https://robots-gateway.uc.r.appspot.com/api';

function authRequest(options) {
  return new Promise((resolve, reject) => {
    const filledOptions = Object.assign(options, {
      url: API_URL + options.url,
      headers: Object.assign((options.headers || {}), {
        'Content-Type': 'application/json',
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
