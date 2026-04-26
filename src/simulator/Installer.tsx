/**
 * Installer — the unified install lifecycle UI.
 *
 * One flow regardless of transport:
 *   pick distribution → find device → install → surface errors with guidance
 *   → celebrate success.
 *
 * Transport-specific work (esptool-js for ESP32, dd/etcher for SD cards) lives
 * behind the `Transport` interface in `./transports/`. This view doesn't care
 * which one it's driving.
 */

import React, { useEffect, useMemo, useRef, useState } from 'react';
import styled from 'styled-components';
import {
  type Distribution,
  type InstallError,
  type InstallState,
  type Transport,
  type TransportKind,
  ERR_INSTALL_CANCELLED,
} from './transports/types';
import { idleState, transition, validateDistribution } from './installerUtils';

// ─── Tokens (shared with dashboard) ───────────────────────────────────────────

const T = {
  bgBase:    '#0f1117',
  border:    '#2d3748',
  text:      '#e2e8f0',
  textMuted: '#94a3b8',
  textDim:   '#64748b',
  accent:    '#7c3aed',
  blue:      '#3b82f6',
  green:     '#10b981',
  amber:     '#f59e0b',
  red:       '#ef4444',
} as const;

// ─── Styled vocabulary ────────────────────────────────────────────────────────

const Container = styled.div`
  display: flex; flex-direction: column; height: 100%; background: ${T.bgBase};
`;
const Header = styled.div`padding: 16px 20px; border-bottom: 1px solid ${T.border};`;
const Title = styled.h2`font-size: 14px; font-weight: 600; color: ${T.text}; margin: 0 0 8px 0;`;
const Subtitle = styled.p`font-size: 12px; color: ${T.textMuted}; margin: 0;`;
const Content = styled.div`flex: 1; padding: 16px 20px; overflow-y: auto;`;
const Section = styled.div`margin-bottom: 24px;`;
const SectionTitle = styled.h3`
  font-size: 11px; font-weight: 600; color: ${T.textMuted};
  text-transform: uppercase; letter-spacing: 0.05em; margin: 0 0 12px 0;
`;

const DistroList = styled.div`display: flex; flex-direction: column; gap: 8px;`;
const DistroCard = styled.button<{ $selected: boolean; $disabled?: boolean }>`
  background: ${({ $selected }) => $selected ? '#1e293b' : '#111827'};
  border: 1px solid ${({ $selected }) => $selected ? T.accent : T.border};
  border-radius: 8px; padding: 12px 16px; cursor: pointer;
  text-align: left; transition: all 0.15s;
  opacity: ${({ $disabled }) => $disabled ? 0.5 : 1};
  pointer-events: ${({ $disabled }) => $disabled ? 'none' : 'auto'};
  &:hover { border-color: ${T.accent}; }
`;
const DistroName = styled.div`font-size: 13px; font-weight: 600; color: ${T.text}; margin-bottom: 2px;`;
const DistroDesc = styled.div`font-size: 11px; color: ${T.textMuted};`;

const Panel = styled.div`
  background: #111827; border: 1px solid ${T.border};
  border-radius: 8px; padding: 16px;
`;
const PanelMessage = styled.div`font-size: 13px; color: ${T.text}; margin-bottom: 8px;`;
const PanelHint = styled.div`font-size: 12px; color: ${T.textMuted}; margin-bottom: 12px;`;

const ButtonRow = styled.div`display: flex; gap: 12px; flex-wrap: wrap;`;

const PrimaryButton = styled.button<{ $disabled?: boolean }>`
  background: ${({ $disabled }) => $disabled ? T.border : T.accent};
  border: none; border-radius: 6px; padding: 10px 20px;
  font-size: 13px; font-weight: 600;
  color: ${({ $disabled }) => $disabled ? T.textDim : 'white'};
  cursor: ${({ $disabled }) => $disabled ? 'not-allowed' : 'pointer'};
`;
const SecondaryButton = styled.button`
  background: transparent; border: 1px solid ${T.border};
  border-radius: 6px; padding: 10px 20px;
  font-size: 13px; font-weight: 600; color: ${T.textMuted}; cursor: pointer;
  &:hover { border-color: ${T.blue}; color: ${T.text}; }
`;
const SuccessButton = styled(PrimaryButton)`
  background: ${({ $disabled }) => $disabled ? T.border : T.green};
`;

const ProgressBar = styled.div`
  background: ${T.border}; border-radius: 4px;
  height: 8px; overflow: hidden; margin-top: 12px;
`;
const ProgressFill = styled.div<{ $progress: number }>`
  background: ${T.blue}; height: 100%;
  width: ${({ $progress }) => Math.round($progress * 100)}%;
  transition: width 0.3s;
`;

const LogBox = styled.pre`
  background: #0a0a0a; border: 1px solid ${T.border};
  border-radius: 4px; padding: 12px;
  font-size: 11px; font-family: 'Consolas', monospace; color: ${T.green};
  height: 140px; overflow-y: auto; margin-top: 12px;
  white-space: pre-wrap;
`;

const ErrorTitle = styled.div`font-size: 13px; font-weight: 600; color: ${T.red}; margin-bottom: 6px;`;
const ErrorGuidance = styled.div`font-size: 12px; color: ${T.text}; margin-bottom: 12px; line-height: 1.5;`;
const ErrorDetailsToggle = styled.button`
  background: none; border: none; padding: 0;
  color: ${T.textMuted}; font-size: 11px; cursor: pointer;
  text-decoration: underline; margin-bottom: 8px;
`;
const ErrorDetailsBox = styled.pre`
  background: #1f1414; border: 1px solid ${T.red}; border-radius: 4px;
  padding: 8px; font-size: 11px; color: ${T.textMuted};
  white-space: pre-wrap; margin: 4px 0 12px 0;
`;

const SuccessIcon = styled.div`
  font-size: 32px; color: ${T.green};
  margin-bottom: 8px;
`;

// ─── Component ────────────────────────────────────────────────────────────────

export interface InstallerProps {
  distributions: Distribution[];
  /** Map of transport implementations keyed by TransportKind. */
  transports: Map<TransportKind, Transport>;
}

export function Installer({ distributions, transports }: InstallerProps) {
  const [selectedDistroId, setSelectedDistroId] = useState<string | null>(null);
  const [state, setState] = useState<InstallState>(idleState());
  const [showDetails, setShowDetails] = useState(false);
  const abortRef = useRef<AbortController | null>(null);

  const selectedDistro = useMemo(
    () => distributions.find(d => d.id === selectedDistroId) ?? null,
    [distributions, selectedDistroId],
  );

  const transport = selectedDistro ? transports.get(selectedDistro.targetKind) : undefined;
  const transportSupported = transport !== undefined;

  const isBusy = state.phase === 'finding' || state.phase === 'installing' || state.phase === 'verifying';

  // Abort any in-flight install if the component unmounts.
  useEffect(() => () => abortRef.current?.abort(), []);

  const safeTransition = (to: InstallState['phase'], subPhase?: string) => {
    setState(prev => {
      try { return transition(prev, to, subPhase); }
      catch (err) {
        console.error('[installer]', err);
        return prev;
      }
    });
  };

  const toInstallError = (err: unknown, fallbackCode = 'UNKNOWN'): InstallError => {
    const e = err as { __installerErrorCode?: string; __installerErrorDetails?: unknown; message?: string };
    const code = e?.__installerErrorCode ?? fallbackCode;
    const entry = transport?.errorCatalog[code];
    return {
      code,
      message: entry?.message ?? e?.message ?? 'Something went wrong.',
      guidance: entry?.guidance ?? 'Try again. If it keeps happening, file a bug.',
      details: e?.__installerErrorDetails ?? (err instanceof Error ? err.stack : err),
    };
  };

  const handleFind = async () => {
    if (!selectedDistro || !transport) return;
    const validation = validateDistribution(selectedDistro);
    if (validation.length > 0) {
      setState(prev => ({
        ...prev, phase: 'error',
        error: { code: 'INVALID_DISTRIBUTION', message: 'Distribution config is invalid.', guidance: validation.join('\n') },
      }));
      return;
    }
    safeTransition('finding');
    try {
      const device = await transport.findDevice(selectedDistro);
      setState(prev => {
        const next = transition(prev, 'found');
        next.device = device;
        return next;
      });
    } catch (err) {
      setState(prev => ({
        ...transition(prev, 'error'),
        error: toInstallError(err),
      }));
    }
  };

  const handleInstall = async () => {
    if (!selectedDistro || !transport || !state.device) return;
    const controller = new AbortController();
    abortRef.current = controller;
    safeTransition('installing', 'fetching');
    try {
      await transport.install(
        selectedDistro,
        state.device,
        {
          onPhaseChange: (phase, subPhase) => safeTransition(phase, subPhase),
          onProgress: (progress) => setState(prev => ({ ...prev, progress })),
          onLog: (line) => setState(prev => ({ ...prev, log: [...prev.log, line] })),
          onDeviceFound: (device) => setState(prev => ({ ...prev, device })),
        },
        controller.signal,
      );
      safeTransition('success');
    } catch (err) {
      const isCancel = err instanceof Error && err.message === ERR_INSTALL_CANCELLED;
      setState(prev => {
        const to = isCancel ? 'cancelled' : 'error';
        const next = transition(prev, to);
        if (!isCancel) next.error = toInstallError(err);
        return next;
      });
    } finally {
      abortRef.current = null;
    }
  };

  const handleCancel = () => {
    abortRef.current?.abort();
  };

  const handleReset = () => {
    abortRef.current?.abort();
    abortRef.current = null;
    setState(idleState());
    setShowDetails(false);
  };

  return (
    <Container>
      <Header>
        <Title>Installer</Title>
        <Subtitle>Write orobot firmware to a connected device</Subtitle>
      </Header>

      <Content>
        {/* Distribution picker */}
        <Section>
          <SectionTitle>Distribution</SectionTitle>
          <DistroList>
            {distributions.map(d => (
              <DistroCard
                key={d.id}
                $selected={selectedDistroId === d.id}
                $disabled={isBusy}
                onClick={() => !isBusy && setSelectedDistroId(d.id)}
              >
                <DistroName>{d.label}</DistroName>
                <DistroDesc>{d.description}</DistroDesc>
              </DistroCard>
            ))}
          </DistroList>
        </Section>

        {/* Lifecycle panel */}
        {selectedDistro && (
          <Section>
            <SectionTitle>{phaseLabel(state.phase)}</SectionTitle>
            <Panel>
              {!transportSupported && (
                <>
                  <PanelMessage>This install path isn't wired up yet.</PanelMessage>
                  <PanelHint>
                    The {selectedDistro.label} distribution targets a transport
                    ({selectedDistro.targetKind}) that the simulator doesn't implement
                    in this build. Pick a different distribution.
                  </PanelHint>
                </>
              )}

              {transportSupported && state.phase === 'idle' && (
                <>
                  <PanelMessage>Ready to find a {selectedDistro.label} device.</PanelMessage>
                  <PanelHint>
                    Click below — your browser will ask which serial port to use.
                    Plug in the board and pick it from the list.
                  </PanelHint>
                  <ButtonRow>
                    <PrimaryButton onClick={handleFind}>Find {selectedDistro.label}</PrimaryButton>
                  </ButtonRow>
                </>
              )}

              {state.phase === 'finding' && (
                <>
                  <PanelMessage>Looking for a device…</PanelMessage>
                  <PanelHint>
                    If you don't see a port listed, try a different USB cable
                    (charge-only cables won't show up).
                  </PanelHint>
                </>
              )}

              {state.phase === 'found' && state.device && (
                <>
                  <PanelMessage>Found <strong>{state.device.displayName}</strong>.</PanelMessage>
                  <PanelHint>Ready to install. This will overwrite the firmware on the board.</PanelHint>
                  <ButtonRow>
                    <PrimaryButton onClick={handleInstall}>Install</PrimaryButton>
                    <SecondaryButton onClick={handleReset}>Pick a different device</SecondaryButton>
                  </ButtonRow>
                </>
              )}

              {(state.phase === 'installing' || state.phase === 'verifying') && (
                <>
                  <PanelMessage>
                    {state.phase === 'installing' ? 'Writing firmware' : 'Verifying'}
                    {state.subPhase ? ` — ${state.subPhase}` : '…'}
                  </PanelMessage>
                  <ProgressBar><ProgressFill $progress={state.progress} /></ProgressBar>
                  <PanelHint style={{ marginTop: 12 }}>
                    Don't unplug the board until this finishes.
                  </PanelHint>
                  <ButtonRow>
                    <SecondaryButton onClick={handleCancel}>Cancel</SecondaryButton>
                  </ButtonRow>
                </>
              )}

              {state.phase === 'success' && (
                <>
                  <SuccessIcon>✓</SuccessIcon>
                  <PanelMessage>Install complete.</PanelMessage>
                  <PanelHint>
                    The board is running orobot firmware. You can unplug it now,
                    or move on to provisioning over the captive portal.
                  </PanelHint>
                  <ButtonRow>
                    <SuccessButton onClick={handleReset}>Install another</SuccessButton>
                  </ButtonRow>
                </>
              )}

              {state.phase === 'error' && state.error && (
                <>
                  <ErrorTitle>{state.error.message}</ErrorTitle>
                  <ErrorGuidance>{state.error.guidance}</ErrorGuidance>
                  {state.error.details !== undefined && (
                    <>
                      <ErrorDetailsToggle onClick={() => setShowDetails(s => !s)}>
                        {showDetails ? 'Hide' : 'Show'} technical details
                      </ErrorDetailsToggle>
                      {showDetails && (
                        <ErrorDetailsBox>
                          {formatDetails(state.error.details)}
                        </ErrorDetailsBox>
                      )}
                    </>
                  )}
                  <ButtonRow>
                    <PrimaryButton onClick={handleReset}>Try again</PrimaryButton>
                  </ButtonRow>
                </>
              )}

              {state.phase === 'cancelled' && (
                <>
                  <PanelMessage>Install cancelled.</PanelMessage>
                  <PanelHint>The board may be in an inconsistent state. Re-run install to recover.</PanelHint>
                  <ButtonRow>
                    <PrimaryButton onClick={handleReset}>Start over</PrimaryButton>
                  </ButtonRow>
                </>
              )}

              {state.log.length > 0 && (state.phase === 'installing' || state.phase === 'verifying' || state.phase === 'success' || state.phase === 'error') && (
                <LogBox>{state.log.join('\n')}</LogBox>
              )}
            </Panel>
          </Section>
        )}
      </Content>
    </Container>
  );
}

function phaseLabel(phase: InstallState['phase']): string {
  switch (phase) {
    case 'idle':       return 'Ready';
    case 'finding':    return 'Finding device';
    case 'found':      return 'Device found';
    case 'installing': return 'Installing';
    case 'verifying':  return 'Verifying';
    case 'success':    return 'Done';
    case 'error':      return 'Something went wrong';
    case 'cancelled':  return 'Cancelled';
  }
}

function formatDetails(details: unknown): string {
  if (typeof details === 'string') return details;
  if (details instanceof Error) return details.stack ?? details.message;
  try { return JSON.stringify(details, null, 2); }
  catch { return String(details); }
}
