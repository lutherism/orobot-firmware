// Sim firmware entry point — meant to be forked by sim-test.js.
// Mocks hardware-specific modules so keep-alive.js runs on non-Pi hosts.
var mock = require('mock-require');

// Mock gpio: provides no-op motor objects that call ready() immediately
const mockMotor = { set: (v, cb) => { if (cb) cb(); } };
mock('gpio', {
  logging: false,
  export: (pin, opts) => {
    if (opts && opts.ready) setTimeout(opts.ready, 0);
    return mockMotor;
  }
});

// Mock node-pty: the native binary isn't available on non-Pi hosts
const mockPtyProcess = {
  write: () => {},
  kill: () => {},
  on: function(event, handler) { return this; }
};
mock('node-pty', {
  spawn: () => mockPtyProcess
});

// Mock wifi-control to avoid platform-specific failures
mock('wifi-control', {
  init: () => {},
  configure: () => {},
  scanForWiFi: (cb) => cb ? cb(null, { networks: [] }) : Promise.resolve({ networks: [] })
});

require('./keep-alive.js');
