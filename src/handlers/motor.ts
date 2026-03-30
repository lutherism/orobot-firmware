import type { StepperMotor } from '../hardware/stepper-motor';
import type { MessageHandler } from './registry';

/**
 * Handles prefix-matched messages like 'gotoangle:90'.
 * Register with: registry.register('gotoangle', true, createMotorHandler(motor))
 */
export function createMotorHandler(motor: StepperMotor): MessageHandler {
  return async (msg) => {
    const degrees = Number(msg.data.split(':')[1]);
    await motor.gotoAngle(degrees);
  };
}
