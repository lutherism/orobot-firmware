function wait(ms) {
  return new Promise((resolve, reject) => {
    setTimeout(() => {
      resolve();
    }, ms);
  });
}

function speed(d = 0) {
  const waveFreq = ((d / 100) * 10000) + 5000;
  return (robot) => {
    return Promise.resolve([
      robot.pwm.setPulseLength(4, waveFreq),
      robot.pwm.setPulseLength(5, waveFreq)
    ]);
  }
}

function fast() {
  return speed(100);
}

function slow() {
  return speed(0);
}

function setMotors(speeds) {
  return (robot) => {
    return Promise.resolve(
      speeds.map((speed, i) => {
        console.log(`settings motor ${i} to ${speed ? void(0) : 0}`);
        robot.motors[i].set(speed ? void(0) : 0)
      }));
  }
}

function forward() {
  return setMotors([false, true, false, true]);
}

function reverse() {
  return setMotors([true, false, true, false]);
}

function stop() {
  return setMotors([false, false, false, false]);
}

/*
*
*/
function turn(d) {
  const waveFreq = ((d / 100) * 350) + 1500;
  return (robot) => {
    return Promise.resolve(
      robot.pwm.setPulseLength(0, waveFreq)
    );
  }
}

function straight() {
  return turn(0);
}

function left() {
  return turn(-100);
}

function right(d) {
  return turn(100);
}

function init() {
  return (robot) => {
    robot.pwm.setPulseLength(0, 1500);
    robot.pwm.setPulseLength(4, 1500);
    robot.pwm.setPulseLength(5, 1500);

    robot.pwm.channelOn(4);
    robot.pwm.channelOn(5);
    robot.pwm.channelOn(0);
    return setMotors([false, false, false, false])(robot);
  }
}

function square() {
  return (robot) => {
    return init()(robot)
      .then(() => straight()(robot))
      .then(() => forward()(robot))
      .then(() => slow()(robot))
      .then(() => corner(right)(robot))
      .then(() => corner(right)(robot))
      .then(() => corner(right)(robot))
      .then(() => stop()(robot))
  }
}

function corner(turn) {
  const STRAIGHT_TIME = 1000;
  const TURN_TIME = 1700;
  return (robot) => {
    return wait(STRAIGHT_TIME)
      .then(() => turn()(robot))
      .then(() => slow()(robot))
      .then(() => wait(TURN_TIME))
      .then(() => straight()(robot))
  }
}

function threePointTurn() {
  const STRAIGHT_TIME = 600;
  const TURN_TIME = 3000;
  return (robot) => {

    return init()(robot)
      .then(() => left()(robot))
      .then(() => slow()(robot))
      .then(() => reverse()(robot))
      .then(() => wait(TURN_TIME))
      .then(() => straight()(robot))
      .then(() => stop()(robot))
  }
}

function testAction() {
  return (robot) => {
    return threePointTurn()(robot)
      .then(() => forward()(robot))
      .then(() => fast()(robot))
      .then(() => wait(1000))
      .then(() => threePointTurn()(robot))
      .then(() => reverse()(robot))
      .then(() => threePointTurn()(robot))
      .then(() => slow()(robot))
      .then(() => forward()(robot))
      .then(() => turn(-40)(robot))
      .then(() => wait(8000))
      .then(() => square()(robot))
      .then(() => stop()(robot))
  }
}

module.exports = {left, right, straight, threePointTurn, testAction,
  fast, slow, speed, square, turn, init, stop, forward, reverse, wait};
