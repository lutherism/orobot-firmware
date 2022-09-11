var gpio = require('gpio');
const {singleton,
  upsertDeviceData,
  refreshDeviceData} = require('./device-data.js');

let COIL_PINS;

if (singleton.DeviceData.hardware === 'banana') {
  COIL_PINS= [
    0,
    1,
    3,
    2
  ];
} else {
  COIL_PINS= [
    17,
    18,
    22,
    27
  ];
}

const motorsSingleton = {
  motorsContext: []
};

const exportMotors = Promise.all(Object.keys(COIL_PINS).map((motorKey, i) => {
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
     motorsSingleton.motorsContext[i] = motor;
   });
}));

module.exports = {
  motorsSingleton,
  exportMotors
};
