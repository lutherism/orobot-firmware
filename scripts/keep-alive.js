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
var shell = os.platform() === 'win32' ? 'powershell.exe' : 'bash';

const WS_URL = process.env.NODE_ENV === 'local' ?
  'ws://localhost:8080/' : 'wss://robots-gateway.uc.r.appspot.com/';
const API_URL = process.env.NODE_ENV === 'local' ?
  'http://localhost:8080' : 'https://robots-gateway.uc.r.appspot.com';

var ptyProcess = pty.spawn(shell, [], {
  name: 'xterm-color',
  cols: 80,
  rows: 30,
  cwd: `${process.env.HOME}/orobot-firmware`,
  env: process.env
});

var ts = through(function write(data) {
  console.log('through data', data);
  this.queue(data);
},
function end () { //optional
  this.queue(null)
});

const delay = ms => new Promise(res => setTimeout(res, ms))
let backoffTime = 100;
const MAX_DELAY = 20000;
const RETRY_WIFI = 3000;

function recursiveConnect() {
  return keepOpenGatewayConnection()
  .catch((err) => {
    console.log(`err happened, backoff at ${backoffTime}ms`);
    // assumes that the error is "request made too soon"
    if (backoffTime > RETRY_WIFI) {
      exec('sudo wpa_supplicant -i wlan0 -c/etc/wpa_supplicant/wpa_supplicant.conf &');
    }
    if (backoffTime < MAX_DELAY) {
      backoffTime *= 2;
    } else {
      COMMANDS['setup-wifi']();
    }
    console.log(err);
    return delay(backoffTime).then(() => {
      console.log('retrying...');
      return recursiveConnect();
    });
  });
}

recursiveConnect();

let DeviceData = JSON.parse(fs.readFileSync(__dirname + '/openroboticsdata/data.json'));

let interval = null;

let version = fs.readFileSync(__dirname + '/../.git/refs/heads/master').toString();

function intervalHeartbeat(msDelay = 8000) {
  const heartPump = () => {
    const hb = {
      deviceUuid: DeviceData.deviceUuid,
      payloadJSON: JSON.stringify({
        version: version,
        type: "wifi-motor"
      })
    };
    request.post({
      uri: `${API_URL}/api/device/state`,
      json: true,
      body: hb
    });
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
      //console.log(client.on)
      var clientStream = WebSocket.createWebSocketStream(client);
      clientStream.on('error', () => {});
      client.on('error', function() {
            console.log('WebSocket Connection Error');
            reject();
      });

      client.onopen = function() {
          /*ptyProcess = pty.spawn(shell, [], {
            name: 'xterm-color',
            cols: 80,
            rows: 30,
            cwd: `${process.env.HOME}/orobot-firmware`,
            env: process.env
          });*/
          console.log(`WebSocket Client Connected to ${WS_URL} ${client.readyState}`);
          client.send(JSON.stringify({
            type: 'identify-connection',
            deviceUuid: DeviceData.deviceUuid}));
          if (client.readyState === client.OPEN) {
            ptyProcess.on('data', (data) => {
              console.log('pyt out data');
              client.send(JSON.stringify({
                type: 'pty-out',
                data,
                deviceUuid: DeviceData.deviceUuid}));
            });
            ptyProcess.write('sudo -u pi -i && cd /home/pi/orobot-firmware');
            ptyProcess.write('echo \'' +
              `Welcome to Open Robotics Terminal! Device UUID: ${DeviceData.deviceUuid}`
              + '`\'\r');
          }

          intervalHeartbeat();
      };

      client.onclose = function() {
          console.log('ssh-protocol Client Closed');
          ptyProcess.kill();
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
          } else if (messageObj.data.indexOf('gotoangle') === 0){
            COMMANDS.gotoangle(Number(messageObj.data.split(':')[1]));
          }
          client.send(JSON.stringify({type: 'command-recieved', data: `ok:${messageObj.data}`}));
        }
      };
    } catch (e) {
      console.log('error caught', e)
      reject();
    }
  });
}
