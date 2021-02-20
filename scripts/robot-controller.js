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

module.exports = {
  init: () => Promise.all([
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
           direction: 'out',
           interval: 400,
           ready: function() {
             resolve(motor);
           }
         });
       });
    }))
  ]).then(([pwm, motors]) => ({pwm, motors}))
};
