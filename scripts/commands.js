var gpio = require("gpio");
var i2cBus = require("i2c-bus");
var repl = require('repl');
const { spawn } = require('child_process');

var options = {
    i2c: i2cBus.openSync(1),
    address: 0x40,
    frequency: 60,
    debug: true
};

const COIL_PINS = [
  17,
  18,
  22,
  27
];
const orders = [
  [0, 1, 3, 2],
  //[2, 3, 1, 0]
];
let motorsContext = [];
let order = 0;
let ActiveCoil = 0;

Promise.all(Object.keys(COIL_PINS).map(motorKey => {
  return new Promise((resolve, reject) => {
    const motor = gpio.export(COIL_PINS[motorKey], {
       // When you export a pin, the default direction is out. This allows you to set
       // the pin value to either LOW or HIGH (3.3V) from your program.
       direction: 'out',

       // set the time interval (ms) between each read when watching for value changes
       // note: this is default to 100, setting value too low will cause high CPU usage
       interval: 100,

       // Due to the asynchronous nature of exporting a header, you may not be able to
       // read or write to the header right away. Place your logic in this ready
       // function to guarantee everything will get fired properly
       ready: function() {
         resolve(motor);
       }
     });
   });
})).then(motors => {
  motorsContext = motors;
});

const COMMANDS = {
  'update': () => {
    const st = spawn('cd /home/pi/projects/orobot-firmware && sudo git pull && sudo reboot');

    st.stdout.on('data', (data) => {
      console.log(`stdout: ${data}`);
    });

    st.stderr.on('data', (data) => {
      console.error(`stderr: ${data}`);
    });

    st.on('close', (code) => {
      console.log(`child process exited with code ${code}`);
    });
  },
  'right': () => {
    const job = setInterval(() => {
      const orderMappedCoilI = orders[order][ActiveCoil]
      motorsContext.map((m, i) => {
        m.set(orderMappedCoilI === i ? 1 : 0)
      });
      ActiveCoil = (ActiveCoil + 1) % COIL_PINS.length;
      console.log(motorsContext.map((m, i) => ([m.value, m])));
    }, 100);
    setTimeout(() => {
      clearInterval(job)
    }, 2000);
  },
  'left': () => {
    const job = setInterval(() => {
      const orderMappedCoilI = orders[order][ActiveCoil]
      motorsContext.reverse().map((m, i) => {
        m.set(orderMappedCoilI === i ? 1 : 0)
      });
      ActiveCoil = (ActiveCoil + 1) % COIL_PINS.length;
      console.log(motorsContext.map((m, i) => ([m.value, m])));
    }, 100);
    setTimeout(() => {
      clearInterval(job)
    }, 2000);
  },
  'stop': () => {
    motorsContext.map((m, i) => {
      m.set(0)
    });
  }
}

module.exports = COMMANDS;
