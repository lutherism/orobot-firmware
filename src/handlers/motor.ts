import type { StepperMotor } from '../hardware/stepper-motor';
import type { MessageHandler } from './registry';

/**
 * Handles prefix-matched 'gotoangle:N' command-in messages.
 * Register with: registry.register('gotoangle', true, createMotorHandler(motor))
 */
export function createMotorHandler(motor: StepperMotor): MessageHandler {
  return async (msg) => {
    const degrees = Number(msg.data.split(':')[1]);
    await motor.gotoAngle(degrees);
  };
}

/**
 * Handles prefix-matched 'gotorelative:N' command-in messages.
 * Register with: registry.register('gotorelative', true, createGotoRelativeHandler(motor))
 */
export function createGotoRelativeHandler(motor: StepperMotor): MessageHandler {
  return async (msg) => {
    const degrees = Number(msg.data.split(':')[1]);
    await motor.gotoRelative(degrees);
  };
}

/**
 * Handles 'stop' command: de-energizes all motor coils immediately.
 * Registered as a system message type so user code cannot intercept it.
 * Register with: registry.register('stop', createStopAllHandler(motor))
 */
export function createStopAllHandler(motor: StepperMotor): MessageHandler {
  return async (_msg) => {
    await motor.stop();
  };
}
