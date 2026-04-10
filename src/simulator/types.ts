export type DeviceStatus = 'connected' | 'reconnecting' | 'disconnected' | 'off';
export type EventType = 'heartbeat' | 'motor' | 'command' | 'connected' | 'disconnected' | 'wifi';
export type GpioMode = 'led' | 'scope';

export interface PinState {
  num: number;
  /** Current binary value: 1 = HIGH, 0 = LOW */
  value: 0 | 1;
  /** Recent history sampled at ~20fps for scope view, newest last */
  history: (0 | 1)[];
}

export interface DeviceEvent {
  time: string;
  type: EventType;
  message: string;
}

export interface DeviceOwner {
  name: string;
  email: string;
  initials: string;
  color: string;
}

export interface DeviceRobot {
  uuid: string;
  name: string;
  program: string;
}

export interface Device {
  id: string;
  name: string;
  uuid: string;
  status: DeviceStatus;
  uptime: string;
  owner?: DeviceOwner;
  robot?: DeviceRobot;
  pins: PinState[];
  events: DeviceEvent[];
}
