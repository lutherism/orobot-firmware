# CI — orobot-firmware

## Workflows

| Workflow | Trigger | What it does |
|----------|---------|--------------|
| `ci.yml` | push/PR | Type-check + vitest run |
| `esp32-build.yml` | push/PR | ESP32 firmware compile check |
| `stale-branches.yml` | schedule | Flags stale branches |
| `publish-sim-images.yml` | push to master (sim/simulator paths) | Builds + pushes Docker images to Artifact Registry |

## Published images

Both images live in the same GAR repository under the `robots-gateway-v2` GCP project:

```
us-central1-docker.pkg.dev/<FIRMWARE_GCP_PROJECT_ID>/orobot-firmware/sim-host:<sha>
us-central1-docker.pkg.dev/<FIRMWARE_GCP_PROJECT_ID>/orobot-firmware/sim-host:latest

us-central1-docker.pkg.dev/<FIRMWARE_GCP_PROJECT_ID>/orobot-firmware/sim:<sha>
us-central1-docker.pkg.dev/<FIRMWARE_GCP_PROJECT_ID>/orobot-firmware/sim:latest
```

`FIRMWARE_GCP_PROJECT_ID` is the GHA repo variable (see Post-merge ops below).

| Image | Dockerfile | Purpose |
|-------|-----------|---------|
| `sim-host` | `Dockerfile.simhost` | Multi-tenant HTTP service; spawns and manages isolated simulator instances. Deployed to Cloud Run by the gateway's `CloudSimDriver`. |
| `sim` | `Dockerfile.sim` | Single headless device simulator. Used for one-off Cloud Run Jobs. |

## Consuming the images (gateway side)

The gateway's `CloudSimDriver` pulls the `sim-host` image by SHA (pinned at deploy time) or `:latest` for non-production environments. Cloud Run deployment config lives in `orobotio/apps/gateway/` — not in this repo.

## Post-merge ops (one-time, per-project setup)

These steps are needed the first time — subsequent pushes to master run automatically.

1. **Create the GAR repository** (if not already present):
   ```bash
   gcloud artifacts repositories create orobot-firmware \
     --repository-format=docker \
     --location=us-central1 \
     --project=<FIRMWARE_GCP_PROJECT_ID>
   ```

2. **Create or reuse a publish service account** with `roles/artifactregistry.writer` on the `orobot-firmware` repository.

3. **Configure WIF** for `lutherism/orobot-firmware` (if not already done). The provider and SA email go into two GitHub repo secrets:
   - `FIRMWARE_GCP_WIF_PROVIDER` — WIF provider resource name
   - `FIRMWARE_GCP_PUBLISH_SA` — publish service account email

4. **Set the repo variable** `FIRMWARE_GCP_PROJECT_ID` to the GCP project ID (e.g. `robots-gateway-v2`).

5. **Trigger a manual run** via Actions → publish-sim-images → Run workflow to verify before the next master push.
