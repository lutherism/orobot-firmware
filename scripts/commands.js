var gpio = require("gpio");
var i2cBus = require("i2c-bus");
var repl = require('repl');
const { exec } = require('child_process');

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
let currentPos = 0;
let pendingGotoAngle = null;
let goToAngleRunnning = false;

const addToCurrentPos = (angle) => {
  currentPos = ((currentPos + angle) + 360) % 360;
}

const COMMANDS = {
  'reboot': () => {
    exec('reboot');
  },
  'update': () => {
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
  },
  'right': () => {
    const job = setInterval(() => {
      const orderMappedCoilI = orders[order][ActiveCoil]
      motorsContext.map((m, i) => {
        m.set(orderMappedCoilI === i ? 1 : 0)
      });
      ActiveCoil = (ActiveCoil + 1) % COIL_PINS.length;
    }, 100);
    setTimeout(() => {
      clearInterval(job);
      COMMANDS.stop();
      addToCurrentPos(36);
    }, 2000);
  },
  'fastright': () => {
    const job = setInterval(() => {
      const orderMappedCoilI = orders[order][ActiveCoil]
      motorsContext.map((m, i) => {
        m.set(orderMappedCoilI === i ? 1 : 0)
      });
      ActiveCoil = (ActiveCoil + 1) % COIL_PINS.length;
    }, 25);
    setTimeout(() => {
      clearInterval(job);
      COMMANDS.stop();
      addToCurrentPos(36);
    }, 2000);
  },
  'fastleft': () => {
    const job = setInterval(() => {
      const orderMappedCoilI = orders[order][ActiveCoil]
      motorsContext.reverse().map((m, i) => {
        m.set(orderMappedCoilI === i ? 1 : 0)
      });
      ActiveCoil = (ActiveCoil + 1) % COIL_PINS.length;
    }, 25);
    setTimeout(() => {
      clearInterval(job);
      COMMANDS.stop();
      addToCurrentPos(36);
    }, 2000);
  },
  'left': () => {
    const job = setInterval(() => {
      const orderMappedCoilI = orders[order][ActiveCoil]
      motorsContext.reverse().map((m, i) => {
        m.set(orderMappedCoilI === i ? 1 : 0)
      });
      ActiveCoil = (ActiveCoil + 1) % COIL_PINS.length;
    }, 100);
    setTimeout(() => {
      clearInterval(job);
      COMMANDS.stop();
      addToCurrentPos(-36);
    }, 2000);
  },
  'stop': () => {
    return new Promise((resolve, reject) => {
      motorsContext.map((m, i) => {
        m.set(0);
      });
      resolve();
    });
  },
  flicker: n => {
    console.log(`flickering ${COIL_PINS[n]}`);
    let i = 0;
    const job = setInterval(() => {
      motorsContext[n].set(i);
      i = i + 1 - (i*2);
    }, 100);
    setTimeout(() => {
      clearInterval(job);
      COMMANDS.stop();
    }, 2000);
  },
  gflicker: n => {
    console.log(`flickering gpio ${n}`);
    let i = 0;
    new Promise((resolve, reject) => {
      const motor = gpio.export(n, {
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
           console.log('starting flicker');
           const job = setInterval(() => {
             motor.set(i);
             i = i + 1 - (i*2);
           }, 100);
           setTimeout(() => {
             clearInterval(job);
           }, 2000);
         }
       });
     });
  },
  gotoangle: (angle) => {
    if (goToAngleRunnning) {
      pendingGotoAngle = angle;
      return;
    } else {
      goToAngleRunnning = true;
    }
    COMMANDS.stop()
      .then(() => COMMANDS.export())
      .then(() => {
        const diff = currentPos - angle;
        let job;
        const timeToRotate = Math.floor(Math.abs(diff) * (200/360)) * 100;
        if (diff < 0) {
          job = setInterval(() => {
            const orderMappedCoilI = orders[order][ActiveCoil]
            motorsContext.map((m, i) => {
              m.set(orderMappedCoilI === i ? 1 : 0)
            });
            ActiveCoil = (ActiveCoil + 1) % COIL_PINS.length;
          }, 100);
        } else if (diff > 0) {
          job = setInterval(() => {
            const orderMappedCoilI = orders[order][ActiveCoil]
            motorsContext.reverse().map((m, i) => {
              m.set(orderMappedCoilI === i ? 1 : 0)
            });
            ActiveCoil = (ActiveCoil + 1) % COIL_PINS.length;
          }, 100);
        }
        console.log(`rotating by ${diff} for ${timeToRotate}ms`);
        setTimeout(() => {
          clearInterval(job);
          goToAngleRunnning = false;
          currentPos = angle;
          if (pendingGotoAngle) {
            console.log(`resuming for ${pendingGotoAngle}`);
            const tmpAngle = pendingGotoAngle;
            pendingGotoAngle = null;
            COMMANDS.gotoangle(tmpAngle);
          } else {
            COMMANDS.stop();
          }
        }, timeToRotate);
      });
  },
  export: () => {
    return Promise.all(Object.keys(COIL_PINS).map(motorKey => {
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
  },
  motorsContext
}

COMMANDS.export();

module.exports = COMMANDS;
