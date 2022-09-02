var mock = require('mock-require');

mock('child_process', {
  exec: function() {
    console.log('exec called');
  }
});
var fs = require('fs')
mock('fs', {
  ...fs,
  writeFileSync: function() {
    console.log('writeFileSync called');
  }
});

mock('./api.js', {
  authRequest: function() {
    console.log('authRequest called');
    return new Promise((resolve, reject) => {
      resolve(JSON.stringify({owner:{uuid: '123'}}))
    })
  }
});

var WebSocket = require('ws');
class MockWebsocket extends WebSocket {
  constructor(...args) {
    console.log('mock socket called');
    super(...args);
  }
  createWebSocketStream() {
    console.log('createWebSocketStream called');
  }
}

mock('ws', MockWebsocket);

require('./keep-alive.js')

setTimeout(() => {
  console.log('==== PASS ====');
  process.exit(1)
}, 3000)
