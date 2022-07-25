var fs = require('fs');
const WebSocket = require('ws');
const request = require('request');
var through = require('through')
var os = require('os');
var pty = require('node-pty');
var COMMANDS = require('./commands.js');
const { Duplex } = require('stream');
var {syncLogsIfAfterGap} = require('./upload-logs');
const {exec} = require('child_process');
var {authRequest} = require('./api.js');

var shell = os.platform() === 'win32' ? 'powershell.exe' : 'bash';

const WS_URL = process.env.NODE_ENV === 'local' ?
  'ws://localhost:8080/' : 'wss://robots-gateway.uc.r.appspot.com/';
const DEV_URL = 'http://192.168.86.222:8080';
const API_URL = process.env.NODE_ENV === 'local' ? DEV_URL : 'https://robots-gateway.uc.r.appspot.com';

class PTYContainer {
  constructor() {
    this.init();
    this.mutated = false;
  }
  init() {
    this.ptyProcess = pty.spawn(shell, [], {
      name: 'xterm-color',
      cols: 80,
      rows: 30,
      env: process.env
    });
    this.ptyProcess.write('su - pi\r');
    this.ptyProcess.on('data', () => {
      console.log('mutated data');
      this.mutated = true;
    });
    this.ptyProcess.on('exit', () => {
      console.log('pty exit');
      this.ptyProcess.kill(9);
      setTimeout(() => {
        this.init();
      }, 1000);
    });
  }
  on(...args) {
    return this.ptyProcess.on(...args);
  }
  write(...args) {
    console.log(`pty writing ${args[0]}`)
    this.mutated = false;
    clearTimeout(this.timer);
    this.timer = setTimeout(() => {
      if (!this.mutated) {
        console.log('resetting pty')
        this.ptyProcess.kill(9);
        this.init();
      }
    }, 5000);
    return this.ptyProcess.write(...args);
  }
}

var ptyProcess = new PTYContainer();

var ts = through(function write(data) {
  console.log('through data', data);
  this.queue(data);
},
function end () { //optional
  this.queue(null)
});

const delay = ms => new Promise(res => setTimeout(res, ms))
let backoffTime = 100;
const MAX_DELAY = 6000;
let failsTillAPMode = 100;

function recursiveConnect() {
  return keepOpenGatewayConnection()
  .then(() => {
  })
  .catch((err) => {
    console.log(`err happened, backoff at ${backoffTime}ms`);
    // assumes that the error is "request made too soon"
    if (backoffTime < MAX_DELAY) {
      backoffTime *= 2;
    }
    console.log(err);
    return delay(backoffTime).then(() => {
      console.log('retrying...');
      failsTillAPMode--;
      if !(failsTillAPMode) {
        exec('sudo ' + __dirname + '/../retry-ap.sh');
      }
      return recursiveConnect();
    });
  });
}
//exec('sudo' + __dirname + '/../switch-to-wifi-client.sh');
recursiveConnect();

let DeviceData;

function refreshDeviceData() {
  DeviceData = JSON.parse(fs.readFileSync(__dirname + '/openroboticsdata/data.json'));
}

refreshDeviceData();

let interval = null;

let version = fs.readFileSync(__dirname + '/../.git/refs/heads/master').toString();

function intervalHeartbeat(msDelay = 8000) {
  const heartPump = () => {
    const hb = {
      deviceUuid: DeviceData.deviceUuid,
      payloadJSON: JSON.stringify({
        version: version,
        type: DeviceData.type
      })
    };
    request.post({
      uri: `${API_URL}/api/device/state`,
      json: true,
      body: hb
    });
    console.log(`heartbeat ${Date.now()}`);
    syncLogsIfAfterGap();
  };
  heartPump();
  clearInterval(interval);
  interval = setInterval(heartPump, msDelay);
}

function keepOpenGatewayConnection() {
  return new Promise((resolve, reject) => {
    try {
      const client = new WebSocket(WS_URL, 'ssh-protocol');
      let connected = false;
      //console.log(client.on)
      var clientStream = WebSocket.createWebSocketStream(client);
      clientStream.on('error', () => {});
      client.on('error', function() {
            console.log('WebSocket Connection Error');
            reject();
      });
      ptyProcess.on('data', (data) => {
        console.log('pyt out data');
        if (connected) {
          client.send(JSON.stringify({
            type: 'pty-out',
            data,
            deviceUuid: DeviceData.deviceUuid}));
        }
      });
      client.onopen = function() {
        connected = true;
          console.log(`WebSocket Client Connected to ${WS_URL} ${client.readyState}`);
          client.send(JSON.stringify({
            type: 'identify-connection',
            deviceUuid: DeviceData.deviceUuid}));
          intervalHeartbeat();
      };

      client.onclose = function() {
          console.log('ssh-protocol Client Closed');
          reject();
      };

      client.onmessage = function(e) {
        if (typeof e.data === 'string') {
          const messageObj = JSON.parse(e.data);
          console.log('got ws message', messageObj);
          if (messageObj.type === 'pty-in') {
            ptyProcess.write(messageObj.data);
          } else if (messageObj.type === 'command-in' &&
            COMMANDS[messageObj.data]) {
            COMMANDS.export()
              .then(() => {
                COMMANDS[messageObj.data]();
              });
          } else if (messageObj.type === 'getframe') {
            request.post({
              url: `${API_URL}/api/device-cam/${DeviceData.deviceUuid}`,
              formData: {
                file: {
                  value: request.get('http://localhost:8000/frame.jpg'),
                  options: {
                    filename: 'frame.jpg',
                    contentType: 'image/jpeg'
                  }
                }
              }
            });
          } else if (messageObj.data.indexOf('gotoangle') === 0){
            COMMANDS.gotoangle(Number(messageObj.data.split(':')[1]));
          }
          client.send(JSON.stringify({
            type: 'command-recieved',
            data: `ok:${messageObj.data}`,
            deviceUuid: DeviceData.deviceUuid}));
        }
      };
    } catch (e) {
      console.log('error caught', e)
      reject();
    }
  });
}
