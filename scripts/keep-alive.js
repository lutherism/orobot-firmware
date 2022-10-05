var fs = require('fs');
const WebSocket = require('ws');
const request = require('request');
var through = require('through')
var os = require('os');
var pty = require('node-pty');
var COMMANDS = require('./commands.js');
const { Duplex } = require('stream');
var {syncLogsIfAfterGap} = require('./upload-logs');
const {exec, fork} = require('child_process');
var {authRequest} = require('./api.js');
const {
  apServerEvents, apServerListen
} = require('./ap-server.js');

const {singleton,
  upsertDeviceData,
  refreshDeviceData} = require('./device-data.js');
let heartbeatLogging = false;
var _log = console.log;
console.log = function(...args) {
  if (heartbeatLogging) {
    heartbeatLogging = false;
    process.stdout.write('\n')
  }
  _log.apply(this, args);
}
require('log-timestamp')
var shell = os.platform() === 'win32' ? 'powershell.exe' : 'bash';
const wifiCmd = 'sudo ' +
  __dirname + '/../switch-to-wifi-client.sh >> ' + __dirname + '/../tmp/run.log';
const apCmd = 'sudo ' +
  __dirname + '/../switch-to-wifi-ap.sh >> ' + __dirname + '/../tmp/run.log';

const WS_URL = process.env.NODE_ENV === 'local' ?
  'ws://localhost:8080/' : 'wss://robots-gateway.uc.r.appspot.com/';
const DEV_URL = () => {
  return `http://${singleton.DeviceData.devIP ||
    '192.168.68.224'}:8080`
};
const DEV_WS_URL = () => {
  return `ws://${singleton.DeviceData.devIP ||
    '192.168.68.224'}:8080`
};
const API_URL = 'https://robots-gateway.uc.r.appspot.com';
let client;

function getConfigedWSURL() {
  return singleton.DeviceData.networkMode === 'dev' ? DEV_WS_URL() : WS_URL;
}

function getConfigedURL() {
  return singleton.DeviceData.networkMode === 'dev' ? DEV_URL() : API_URL
}

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
    this.ptyProcess.write('echo Welcome to ORobot SSH\r');
    this.ptyProcess.on('data', () => {
      this.mutated = true;
    });
    this.ptyProcess.on('exit', () => {
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

var ptyProcess;

var ts = through(function write(data) {
  console.log('through data', data);
  this.queue(data);
},
function end () { //optional
  this.queue(null)
});

const delay = ms => new Promise(res => setTimeout(res, ms))
let backoffTime = 2000;
let iterations = 0;
const RETRY_CLIENT = 40;
const SWITCH_TO_AP = 100;
let failsTillAPMode = 100;

function recursiveConnect() {
  console.log('attempting to connect');
  if (!singleton.DeviceData.wifiSettings ||
  !singleton.DeviceData.wifiSettings.ssid) {
    upsertDeviceData({
      networkMode: 'ap'
    });
  }
  if (singleton.DeviceData.networkMode === 'ap') {
    console.log('exiting connect loop for ap mode');
    return;
  }
  return keepOpenGatewayConnection()
  .catch((err) => {
    iterations++;
    console.log(`err happened, backoff at ${backoffTime}ms`, err);
    // assumes that the error is "request made too soon"
    if (iterations > RETRY_CLIENT &&
      iterations < SWITCH_TO_AP) {
      console.log('retry client', wifiCmd);
      exec(wifiCmd, (...args1) => {
        console.log(args1);
      });
      backoffTime = 5000;
    } else if (iterations > SWITCH_TO_AP) {
      console.log('switch to wifi setup', apCmd);
      upsertDeviceData({
        networkMode: 'ap'
      });
      exec(apCmd, (...args1) => {
        console.log(args1);
        apServerListen();
      });
    }
    console.log(err);
    return delay(backoffTime).then(() => {
      console.log('retrying...');
      recursiveConnect();
    });
  });
}


let interval = null;

let version = fs.readFileSync(__dirname + '/../.git/refs/heads/master').toString();

function intervalHeartbeat(msDelay = 8000) {
  const heartPump = () => {
    const hb = {
      deviceUuid: singleton.DeviceData.deviceUuid,
      payloadJSON: JSON.stringify({
        version: version,
        type: singleton.DeviceData.type
      })
    };
    authRequest({
      url: `/device/state`,
      method: 'post',
      json: true,
      body: hb
    })
    .catch(e => console.log('hb err'))
    .then(b => {
      if (heartbeatLogging) {
        process.stdout.write(".");
      } else {
        process.stdout.write(`[${(new Date().toISOString())}] heartbeat `);
        heartbeatLogging = true;
      }
    });
    syncLogsIfAfterGap();
  };
  heartPump();
  clearInterval(interval);
  interval = setInterval(heartPump, msDelay);
}

function handleWebSocketMessage(e) {
  if (typeof e.data === 'string') {
    const messageObj = JSON.parse(e.data);
    console.log('got ws message', messageObj);
    if (messageObj.type === 'pty-in') {
      ptyProcess.write(messageObj.data);
    } else if (messageObj.type === 'command-in' &&
      COMMANDS[messageObj.data]) {
      COMMANDS.export()
        .then(() => COMMANDS[messageObj.data]())
        .then(() => COMMANDS.stop())
        .catch(err => {
          console.error(err);
        });
    } else if (messageObj.type === 'command-in' &&
      messageObj.data === 'reboot') {
      exec('reboot');
    } else if (messageObj.type === 'command-in' &&
      messageObj.data.indexOf('varyspeed') > -1) {
        COMMANDS.export()
          .then(() => COMMANDS.varySpeed(Number(messageObj.data.split(':')[1])))
          .then(() => COMMANDS.stop())
          .catch(err => {
            console.error(err);
          });
    } else if (messageObj.type === 'command-in' &&
      messageObj.data === 'update') {
        const st = exec('sudo /home/pi/orobot-firmware/update-reboot.sh');

        st.stdout.on('data', (data) => {
          console.log(`stdout: ${data}`);
        });

        st.stderr.on('data', (data) => {
          console.error(`stderr: ${data}`);
        });

        st.on('close', (code) => {
          console.log(`child process exited with code ${code}`);
        });
      } else if (messageObj.type === 'getframe') {
      request.post({
        url: `${getConfigedURL()}/api/device-cam/${singleton.DeviceData.deviceUuid}`,
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
    } else if (messageObj.type === 'networkmode') {
      if (messageObj.data.indexOf('dev') > -1) {
        const [mode, ip] = messageObj.data.split(':');
        upsertDeviceData({
          networkMode: mode,
          devIP: ip
        });
      } else {
        upsertDeviceData({
          networkMode: messageObj.data
        });
      }
      delay(1000).then(() => {
        client.close();
        run();
      });
    } else if (messageObj.type === 'getDeviceData') {
      client.send(JSON.stringify({
        type: 'device-data-read',
        data: singleton.DeviceData,
        userUuid: singleton.DeviceData.ownerUuid
      }));
    } else if (messageObj.data.indexOf('gotoangle') === 0){
      COMMANDS.gotoangle(Number(messageObj.data.split(':')[1]));
    }
    console.log('acking');
    client.send(JSON.stringify({
      type: 'message-ack',
      ackId: messageObj.ackId,
      deviceUuid: singleton.DeviceData.deviceUuid}));
  }
};

function rebootConnection() {
    console.log('ssh-protocol Client Closed. Rebooting...');
    clearInterval(interval);
    delay(200).then(() => recursiveConnect());
};

function keepOpenGatewayConnection() {
  return new Promise((resolve, reject) => {
    try {
      client = new WebSocket(
        getConfigedWSURL(),
        'ssh-protocol');
      var clientStream = WebSocket.createWebSocketStream(client);
      clientStream.on('error', () => {});
      client.on('error', function(e) {
        console.log('WebSocket Connection Error');
        reject(e);
      });
      client.onopen = function() {
        console.log(`WebSocket Client Connected to ${getConfigedWSURL()} ${client.readyState}`);
        if (client.readyState === 0) {
          reject();
        }
        client.send(JSON.stringify({
          type: 'identify-connection',
          deviceUuid: singleton.DeviceData.deviceUuid}));
        client.send(JSON.stringify({
          type: 'connect-to-user',
          deviceUuid: singleton.DeviceData.deviceUuid}));
        if (!ptyProcess) {
          ptyProcess = new PTYContainer();
          ptyProcess.on('data', (data) => {
            if (client.readyState === 1) {
              client.send(JSON.stringify({
                type: 'pty-out',
                data,
                deviceUuid: singleton.DeviceData.deviceUuid}));
            }
          });
        }
        intervalHeartbeat();
        const deviceUrl = `/device/${singleton.DeviceData.deviceUuid}`;
        console.log('getting owner info', deviceUrl);
        authRequest({
          url: deviceUrl
        }).then(body => {
          console.log('got owner info', body)
          upsertDeviceData({
            ownerUuid: JSON.parse(body).owner.uuid
          });
        });
        client.addEventListener('close', rebootConnection);
        resolve();
      };

      client.addEventListener('message', handleWebSocketMessage);

    } catch (e) {
      console.log('error caught', e)
      reject(e);
    }
  });
}

function run() {
  if (singleton.DeviceData.networkMode === 'ap') {
    console.log('should switch to AP', apCmd);
    exec(apCmd, (...args1) => {
      console.log(args1);
      apServerListen();
    });
  }
  if (singleton.DeviceData.networkMode === 'client') {
    console.log('should switch to client', apCmd);
    authRequest({
      url: '/test'
    })
    .then(() => {
      recursiveConnect();
    })
    .catch((err) => {
      const results = exec("sudo iwlist wlan0 scan", (e, o, err) => {
        const networks = o.split('      Cell');
        const matchingNetworks = networks
          .map(networkString => {
            return networkString.split('\n                    ')
              .find(row => {
                return row.indexOf('ESSID') > -1 &&
                  row.indexOf(singleton.DeviceData.wifiSettings.ssid) > -1;
              });
          }).filter(x => x);
          if (matchingNetworks.length === 0) {
            console.log(`Wifi Setting ${singleton.DeviceData.wifiSettings.ssid} not found. Switching to AP`);
            upsertDeviceData({
              networkMode: 'ap'
            });
            exec(apCmd, (...args1) => {
              console.log(args1);
              apServerListen();
            });
          } else {
            console.log('failed to connect to server.', err)
            exec(wifiCmd, (...args1) => {
              console.log('client reconfiged, retrying run');
              run();
            });
          }
      });
    });
  }
}

apServerEvents.on('switch-to-client', () => {
  console.log(`Switching to Wifi ${singleton.DeviceData.wifiSettings.ssid}`);
  run();
});

run();
