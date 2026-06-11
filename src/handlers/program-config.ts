import type { ProgramConfigService, ProgramConfig } from '../core/program-config';
import type { StepperMotor } from '../hardware/stepper-motor';
import type { MessageHandler } from './registry';
import type { CameraStreamService } from './camera-stream';
import type { AdapterInstaller } from './adapter-installer';
import { createLogger } from '../core/logger';

const log = createLogger('handler-load-config');

export function createLoadConfigHandler(
  programConfigSvc: ProgramConfigService,
  motor: StepperMotor,
  cameraStream?: CameraStreamService,
  adapterInstaller?: AdapterInstaller,
): MessageHandler {
  return async (msg) => {
    let payload: { config: ProgramConfig; unitId: string; deviceUuid?: string };
    try {
      payload = JSON.parse(msg.data) as { config: ProgramConfig; unitId: string; deviceUuid?: string };
    } catch {
      log.warn({ data: msg.data }, 'load-config: failed to parse data, ignoring');
      return;
    }

    const { config, unitId } = payload;
    await programConfigSvc.save({ ...config, unitId });

    const firstMotor = config.motors?.[0];
    if (firstMotor !== undefined) {
      motor.setConstraints(firstMotor.minAngle, firstMotor.maxAngle);
    }

    // Start or stop the camera stream depending on config.camera.enabled.
    if (cameraStream) {
      const cameraEnabled = config.camera?.enabled === true;
      if (cameraEnabled && !cameraStream.isRunning) {
        cameraStream.start(msg.deviceUuid, config.camera ?? {});
      } else if (!cameraEnabled && cameraStream.isRunning) {
        cameraStream.stop();
      }
    }

    // Auto-install declared hardware adapters (fire-and-forget — failures are
    // logged but do not block program load).  AdapterInstaller enforces its own
    // allowlist (@orobot/adapter-* only) so the raw array is safe to pass through.
    if (adapterInstaller && Array.isArray(config.hardwareAdapters) && config.hardwareAdapters.length > 0) {
      void adapterInstaller.installAdapters(config.hardwareAdapters).then((installed) => {
        if (installed.length > 0) {
          log.info({ installed }, 'load-config: hardware adapters installed');
        }
      });
    }

    log.info({ unitId }, 'load-config applied');
  };
}
