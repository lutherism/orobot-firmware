import type { PTYManager } from '../pty/pty-manager';
import type { MessageHandler } from './registry';

export function createPtyHandler(manager: PTYManager): MessageHandler {
  return async (msg) => {
    manager.write(msg.data);
  };
}
