/*
  call do with a function that returns a Promise
  this will return a Promise that resolves in fifo order
  of other do calls
*/

module.exports = class FIFOActions {
  constructor() {
    this.messageQueue = [];
    this.processing = false;
  }

  chew() {
    if (this.messageQueue.length < 1 || this.processing) {
      return;
    }
    const [[act, resolve]] = this.messageQueue.slice(0, 1);
    this.messageQueue = [...this.messageQueue.slice(1)];
    this.processing = true;
    act().then((...args) => {
      this.processing = false;
      resolve();
      this.chew();
    });
  }
  do(act) {
    return new Promise((resolve, reject) => {
      this.messageQueue.push([act, resolve]);
      this.chew();
    });
  }
}
