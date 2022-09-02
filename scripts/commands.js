var gpio = require("gpio");
var repl = require('repl');
const { exec } = require('child_process');
const FIFOActions = require('./fifo-actions.js');

gpio.logging = true;

const fifoActions = new FIFOActions();

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
  'right': () => {
    return fifoActions.do(() => {
      return new Promise((resolve, reject) => {
        const job = setInterval(() => {
          const orderMappedCoilI = orders[order][ActiveCoil]
          motorsContext.map((m, i) => {
            m.set(orderMappedCoilI === i ? 1 : 0)
          });
          ActiveCoil = (ActiveCoil + 1) % COIL_PINS.length;
        }, 100);
        setTimeout(() => {
          clearInterval(job);
          resolve();
          COMMANDS.stop();
          addToCurrentPos(36);
        }, 2000);
      });
    });
  },
  'fastright': () => {
    return fifoActions.do(() => {
      return new Promise((resolve, reject) => {
        const job = setInterval(() => {
          const orderMappedCoilI = orders[order][ActiveCoil]
          motorsContext.map((m, i) => {
            m.set(orderMappedCoilI === i ? 1 : 0)
          });
          ActiveCoil = (ActiveCoil + 1) % COIL_PINS.length;
        }, 25);
        setTimeout(() => {
          clearInterval(job);
          resolve();
          COMMANDS.stop();
          addToCurrentPos(36);
        }, 2000);
      });
    });
  },
  'fastleft': () => {
    return fifoActions.do(() => {
      return new Promise((resolve, reject) => {
        const job = setInterval(() => {
          const orderMappedCoilI = orders[order][ActiveCoil]
          motorsContext.reverse().map((m, i) => {
            m.set(orderMappedCoilI === i ? 1 : 0)
          });
          ActiveCoil = (ActiveCoil + 1) % COIL_PINS.length;
        }, 25);
        setTimeout(() => {
          clearInterval(job);
          resolve();
          COMMANDS.stop();
          addToCurrentPos(36);
        }, 2000);
      });
    });
  },
  'left': () => {
    return fifoActions.do(() => {
      return new Promise((resolve, reject) => {
        const job = setInterval(() => {
          const orderMappedCoilI = orders[order][ActiveCoil]
          motorsContext.reverse().map((m, i) => {
            m.set(orderMappedCoilI === i ? 1 : 0)
          });
          ActiveCoil = (ActiveCoil + 1) % COIL_PINS.length;
        }, 100);
        setTimeout(() => {
          clearInterval(job);
          resolve();
          COMMANDS.stop();
          addToCurrentPos(-36);
        }, 2000);
      });
    });
  },
  'stop': () => {
    return fifoActions.do(() => {
      return new Promise((resolve, reject) => {
        let numStops = motorsContext.length
        motorsContext.map((m, i) => {
          m.unexport(() => {
            console.log('unexported', numStops)
            numStops--;
            if (numStops === 0) {
              resolve();
            }
          });
        });
      });
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
    return fifoActions.do(() => {
      return new Promise((resolve, reject) => {
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
              COMMANDS.stop();
              resolve();
            }, timeToRotate);
          });
      });
    });
  },
  export: () => {
    return fifoActions.do(() => {
      return Promise.all(Object.keys(COIL_PINS).map((motorKey, i) => {
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
           motorsContext[i] = motor;
         });
      }));
    });
  },
  motorsContext
}

COMMANDS.export();

module.exports = COMMANDS;
