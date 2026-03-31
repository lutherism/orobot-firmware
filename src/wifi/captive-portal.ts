import express, { type Express } from 'express';
import type { Server } from 'http';
import path from 'path';
import type { DeviceStateService } from '../core/device-state';
import type { EventBus } from '../core/event-bus';
import type { WifiManager } from './wifi-manager';
import type { WifiCredentials } from '../core/types';
import { createLogger } from '../core/logger';

const PORTAL_PORT = 3006;
const PUBLIC_DIR  = path.join(__dirname, '../../public');
const log         = createLogger('captive-portal');

export class CaptivePortalServer {
  private server: Server | null = null;
  private readonly _app: Express;

  constructor(
    private readonly wifiManager: WifiManager,
    private readonly state:       DeviceStateService,
    private readonly bus:         EventBus,
  ) {
    this._app = this.buildRoutes(express());
  }

  /**
   * Exposed for tests: use with supertest(portal.expressApp) to test
   * routes without binding to a port.
   */
  get expressApp(): Express {
    return this._app;
  }

  start(): void {
    if (this.server) return;
    this.server = this._app.listen(PORTAL_PORT, () => {
      log.info({ event: 'portal:started', port: PORTAL_PORT }, 'Captive portal listening');
    });
  }

  stop(): void {
    if (this.server) {
      this.server.close();
      this.server = null;
    }
  }

  private buildRoutes(app: Express): Express {
    app.use(express.json());
    app.use(express.static(PUBLIC_DIR));

    app.get('/api/wifi', async (_req, res) => {
      try {
        const networks = await this.wifiManager.scanNetworks();
        res.json({ wifi: networks });
      } catch (err) {
        log.warn({ err: String(err) }, 'WiFi scan failed');
        res.status(500).json({ error: 'scan failed' });
      }
    });

    app.post('/api/wifi', async (req, res) => {
      try {
        await this.wifiManager.provisionNetwork(req.body as WifiCredentials);
        res.json({ ok: true });
      } catch (err) {
        log.warn({ err: String(err) }, 'Provision failed');
        res.status(500).json({ error: 'provision failed' });
      }
    });

    app.get('/api/known-wifi', (_req, res) => {
      const { knownNetworks } = this.state.get();
      res.json({
        knownNetworks: knownNetworks.map((n) => ({ ssid: n.ssid, mac: n.mac })),
      });
    });

    app.post('/api/goto-client', (_req, res) => {
      res.json({ ok: true });
      this.bus.emit('wifi:goto-client-requested', {});
    });

    return app;
  }
}
