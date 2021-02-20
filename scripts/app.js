var gpio = require("gpio");
var i2cBus = require("i2c-bus");
var Pca9685Driver = require("pca9685").Pca9685Driver;
var Actions = require('./actions');

const MOTORS = {
  '1a': 17,
  '1b': 18,
  '2a': 27,
  '2b': 22
};
var options = {
    i2c: i2cBus.openSync(1),
    address: 0x40,
    frequency: 60,
    debug: true
};

Promise.all([
    new Promise((resolve, reject) => {
      const pwm = new Pca9685Driver(options, function(err) {
        if (err) {
          console.error("Error initializing PCA9685", err);
          throw err;
        }

        resolve(pwm);
      });
    }),
    Promise.all(Object.keys(MOTORS).map(motorKey => {
      return new Promise((resolve, reject) => {
        const motor = gpio.export(MOTORS[motorKey], {
           // When you export a pin, the default direction is out. This allows you to set
           // the pin value to either LOW or HIGH (3.3V) from your program.
           direction: 'out',

           // set the time interval (ms) between each read when watching for value changes
           // note: this is default to 100, setting value too low will cause high CPU usage
           interval: 400,

           // Due to the asynchronous nature of exporting a header, you may not be able to
           // read or write to the header right away. Place your logic in this ready
           // function to guarantee everything will get fired properly
           ready: function() {
             resolve(motor);
           }
         });
       });
    }))
  ]).then(([pwm, motors]) => {
    Actions.square()({pwm, motors});
  })
