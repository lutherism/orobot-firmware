import express, { type Express } from 'express';
import fs from 'fs';
import type { Server } from 'http';
import path from 'path';
import type { DeviceStateService } from '../core/device-state';
import type { EventBus } from '../core/event-bus';
import type { WifiManager } from './wifi-manager';
import type { WifiCredentials } from '../core/types';
import { createLogger } from '../core/logger';

const PORTAL_PORT = 3006;
const PUBLIC_DIR  = path.join(__dirname, '../../public');
const SHELL_PATH  = path.join(PUBLIC_DIR, 'portal-shell.html');

function buildPortalHtml(deviceName: string): string {
  const shell = fs.readFileSync(SHELL_PATH, 'utf8');
  const config = JSON.stringify({ wifiUrl: '/api/wifi', deviceName });
  return shell.replace(
    '<!-- OROBOT_PORTAL_CONFIG -->',
    `<script>window.OROBOT_PORTAL = ${config};</script>`,
  );
}
export class CaptivePortalServer {
  private server: Server | null = null;
  private readonly _app: Express;
  private readonly log: ReturnType<typeof createLogger>;

  constructor(
    private readonly wifiManager: WifiManager,
    private readonly state:       DeviceStateService,
    private readonly bus:         EventBus,
    device?: string,
  ) {
    this.log = createLogger('captive-portal', device);
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
      this.log.info({ event: 'portal:started', port: PORTAL_PORT }, 'Captive portal listening');
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
    // Serve static portal assets (portal.js, etc.) but handle / ourselves so
    // we can inject the per-device window.OROBOT_PORTAL config block.
    app.use(express.static(PUBLIC_DIR, { index: false }));

    app.get('/', (_req, res) => {
      const { deviceUuid } = this.state.get();
      try {
        res.type('html').send(buildPortalHtml(deviceUuid ?? 'your robot'));
      } catch {
        this.log.warn({}, 'Portal shell not found — run npm run build:portal');
        res.status(503).send('Portal unavailable. Run: npm run build:portal');
      }
    });

    app.get('/api/wifi', async (_req, res) => {
      try {
        const networks = await this.wifiManager.scanNetworks();
        res.json({ wifi: networks });
      } catch (err) {
        this.log.warn({ err: String(err) }, 'WiFi scan failed');
        res.status(500).json({ error: 'scan failed' });
      }
    });

    app.post('/api/wifi', async (req, res) => {
      try {
        await this.wifiManager.provisionNetwork(req.body as WifiCredentials);
        res.json({ ok: true });
      } catch (err) {
        this.log.warn({ err: String(err) }, 'Provision failed');
        res.status(500).json({ error: 'provision failed' });
      }
    });

    app.get('/api/setup-status', (_req, res) => {
      const { lastSetupError, pendingClaimCode } = this.state.get();
      res.json({ lastError: lastSetupError, pendingClaimCode });
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

    app.post('/api/claim-code', async (req, res) => {
      const { code } = req.body as { code?: string };
      const normalized = (code ?? '').replace(/\s/g, '');
      if (!/^\d{6}$/.test(normalized)) {
        res.status(400).json({ error: 'Code must be 6 digits' });
        return;
      }
      await this.state.patch({ pendingClaimCode: normalized });
      this.log.info({ event: 'claim-code:stored', code: normalized }, 'Claim code stored');
      this.bus.emit('portal:claim-code-stored', { code: normalized });
      res.json({ ok: true });
    });

    return app;
  }
}
