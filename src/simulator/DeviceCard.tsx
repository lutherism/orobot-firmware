import React, { useState } from 'react';
import styled, { css, keyframes } from 'styled-components';
import type { Device, DeviceStatus, EventType, GpioMode, PinState } from './types';

// ─── Design tokens ────────────────────────────────────────────────────────────

const T = {
  bgBase:       '#0f1117',
  bgCard:       '#1a1f2e',
  bgCardHdr:    '#141929',
  bgLog:        '#0a0d14',
  bgScope:      '#060a0e',
  bgScopeRow0:  '#06080d',
  bgScopeRow1:  '#07090f',
  bgScopeLabel: '#0a0d14',
  border:       '#2d3748',
  borderSub:    '#111827',
  borderFaint:  '#1e293b',
  text:         '#e2e8f0',
  textMuted:    '#94a3b8',
  textDim:      '#64748b',
  textFaint:    '#475569',
  textVeryFaint:'#334155',
  accent:       '#7c3aed',
  blue:         '#3b82f6',
  green:        '#10b981',
  amber:        '#f59e0b',
  red:          '#ef4444',
  softRed:      '#f87171',
  hiPin:        '#1a1000',
  loPin:        '#001a0d',
  hiLed:        '#f59e0b',
  loLed:        '#10b981',
} as const;

// ─── Animations ───────────────────────────────────────────────────────────────

const pulse = keyframes`
  0%, 100% { opacity: 1; }
  50%       { opacity: 0.4; }
`;

// ─── Card shell ───────────────────────────────────────────────────────────────

const Card = styled.article<{ $status: DeviceStatus }>`
  background: ${T.bgCard};
  border: 1px solid ${({ $status }) =>
    $status === 'connected' ? T.blue : T.border};
  border-radius: 8px;
  overflow: hidden;
  opacity: ${({ $status }) => ($status === 'off' ? 0.4 : 1)};
`;

// ─── Header ───────────────────────────────────────────────────────────────────

const Header = styled.div`
  padding: 8px 10px;
  display: grid;
  grid-template-columns: 1fr auto;
  align-items: center;
  gap: 6px;
  border-bottom: 1px solid ${T.borderFaint};
  background: ${T.bgCardHdr};
`;

const TitleRow = styled.div`
  display: flex;
  align-items: center;
  gap: 7px;
  min-width: 0;
`;

const PowerButton = styled.button<{ $on: boolean }>`
  width: 22px;
  height: 22px;
  border-radius: 50%;
  border: 1.5px solid ${({ $on }) => ($on ? '#22c55e' : T.textVeryFaint)};
  background: ${T.bgBase};
  color: ${({ $on }) => ($on ? '#22c55e' : '#6b7280')};
  font-size: 10px;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
`;

const DeviceName = styled.div`
  font-size: 12px;
  font-weight: 600;
  color: ${T.text};
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
`;

const DeviceUuid = styled.div`
  font-size: 9.5px;
  color: ${T.textVeryFaint};
  font-family: monospace;
`;

// ─── Meta row ─────────────────────────────────────────────────────────────────

const MetaRow = styled.div`
  padding: 6px 10px 5px;
  display: grid;
  grid-template-columns: auto 1fr auto;
  align-items: center;
  gap: 6px;
  border-bottom: 1px solid ${T.borderSub};
`;

const dotColors: Record<string, string> = {
  connected:    T.blue,
  disconnected: T.red,
  connecting:   T.amber,
  off:          T.textVeryFaint,
};

const StatusDot = styled.span<{ $status: DeviceStatus }>`
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: ${({ $status }) => dotColors[$status] ?? T.textVeryFaint};
  flex-shrink: 0;
  box-shadow: ${({ $status }) =>
    $status === 'connected' ? `0 0 5px ${T.blue}` : 'none'};
  animation: ${({ $status }) =>
    $status === 'reconnecting'
      ? css`${pulse} 1s infinite`
      : 'none'};
`;

const UptimeLabel = styled.span`
  font-size: 10px;
  color: ${T.textFaint};
  white-space: nowrap;
`;

const MetaStatus = styled.div`
  display: flex;
  align-items: center;
  gap: 4px;
`;

const OwnerRow = styled.div`
  display: flex;
  align-items: center;
  gap: 5px;
  min-width: 0;
`;

const Avatar = styled.div<{ $color: string }>`
  width: 16px;
  height: 16px;
  border-radius: 50%;
  background: ${({ $color }) => $color};
  font-size: 8px;
  display: flex;
  align-items: center;
  justify-content: center;
  color: white;
  font-weight: 700;
  flex-shrink: 0;
`;

const OwnerName = styled.div`
  font-size: 10.5px;
  color: ${T.textMuted};
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
`;

const OwnerEmail = styled.div`
  font-size: 9.5px;
  color: ${T.textVeryFaint};
`;

const UnclaimedLabel = styled.span`
  font-size: 10px;
  color: ${T.border};
  font-style: italic;
`;

const ConnButton = styled.button<{ $variant: 'connect' | 'disconnect' | 'disabled' }>`
  font-size: 9.5px;
  padding: 2px 7px;
  border-radius: 4px;
  border: 1px solid ${({ $variant }) =>
    $variant === 'disconnect' ? '#7f1d1d'
    : $variant === 'connect'  ? T.borderFaint
    : T.border};
  background: transparent;
  color: ${({ $variant }) =>
    $variant === 'disconnect' ? T.softRed
    : $variant === 'connect'  ? T.blue
    : T.textDim};
  cursor: ${({ $variant }) => ($variant === 'disabled' ? 'not-allowed' : 'pointer')};
  white-space: nowrap;
  opacity: ${({ $variant }) => ($variant === 'disabled' ? 0.3 : 1)};
`;

// ─── Robot row ────────────────────────────────────────────────────────────────

const RobotRowWrap = styled.div`
  padding: 4px 10px;
  display: flex;
  align-items: center;
  gap: 5px;
  border-bottom: 1px solid ${T.borderSub};
  min-width: 0;
  overflow: hidden;
`;

const RobotIcon = styled.span`
  font-size: 9px;
  color: ${T.accent};
  flex-shrink: 0;
`;

const RobotName = styled.span`
  font-size: 10px;
  color: ${T.textMuted};
  font-weight: 600;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  flex: 1;
  min-width: 0;
`;

const RobotSep = styled.span`
  color: ${T.borderFaint};
  font-size: 10px;
  flex-shrink: 0;
`;

const ProgramChip = styled.span`
  font-size: 9px;
  font-family: monospace;
  background: #0a1524;
  border: 1px solid ${T.borderFaint};
  border-radius: 3px;
  padding: 1px 5px;
  color: ${T.blue};
  white-space: nowrap;
  flex-shrink: 0;
`;

const NoRobotLabel = styled.span`
  font-size: 9.5px;
  color: ${T.border};
  font-style: italic;
`;

// ─── GPIO section ─────────────────────────────────────────────────────────────

const GpioWrap = styled.div`
  padding: 5px 10px;
  border-bottom: 1px solid ${T.borderSub};
`;

const GpioHeader = styled.div`
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 3px;
`;

const GpioLabel = styled.span`
  font-size: 8px;
  color: ${T.borderFaint};
  text-transform: uppercase;
  letter-spacing: 0.1em;
`;

// ── Toggle pill ──

const TogglePill = styled.div`
  display: flex;
  border: 1px solid ${T.borderFaint};
  border-radius: 3px;
  overflow: hidden;
`;

const ToggleBtn = styled.button<{ $active: boolean }>`
  font-size: 8px;
  padding: 1px 6px;
  border: none;
  background: ${({ $active }) => ($active ? T.borderFaint : 'transparent')};
  color: ${({ $active }) => ($active ? T.textMuted : T.textVeryFaint)};
  cursor: pointer;
  text-transform: uppercase;
  letter-spacing: 0.06em;
  font-family: monospace;
  line-height: 1.6;
  transition: background 0.12s, color 0.12s;

  & + & {
    border-left: 1px solid ${T.borderFaint};
  }

  &:hover:not([disabled]) {
    background: ${T.borderSub};
    color: ${T.textFaint};
  }
`;

// ── LED strip ──

const LedStrip = styled.div`
  display: flex;
  border-radius: 4px;
  overflow: hidden;
  border: 1px solid ${T.borderFaint};
`;

const LedPin = styled.div<{ $state: 0 | 1 | null }>`
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  padding: 4px 2px 3px;
  background: ${({ $state }) =>
    $state === 1 ? T.hiPin : $state === 0 ? T.loPin : T.bgBase};
  border-right: 1px solid ${T.borderFaint};
  cursor: pointer;
  transition: background 0.15s;
  gap: 3px;

  &:last-child {
    border-right: none;
  }
`;

const LedDot = styled.div<{ $state: 0 | 1 | null }>`
  width: 10px;
  height: 10px;
  border-radius: 50%;
  background: ${({ $state }) =>
    $state === 1 ? T.hiLed : $state === 0 ? T.loLed : T.borderFaint};
  box-shadow: ${({ $state }) =>
    $state === 1
      ? `0 0 6px ${T.hiLed}, 0 0 12px ${T.hiLed}44`
      : $state === 0
      ? `0 0 5px ${T.loLed}88`
      : 'none'};
  flex-shrink: 0;
`;

const PinNumber = styled.span<{ $state: 0 | 1 | null }>`
  font-size: 8.5px;
  color: ${({ $state }) =>
    $state === 1 ? '#78350f' : $state === 0 ? '#065f46' : T.textVeryFaint};
  font-family: monospace;
  font-weight: 600;
`;

// ── Scope view ──

const ScopeWrap = styled.div`
  background: ${T.bgScope};
  border: 1px solid #1a2332;
  border-radius: 4px;
  overflow: hidden;
`;

const ScopeSvg = styled.svg`
  display: block;
  width: 100%;
  height: auto;
`;

// ─── Event log ────────────────────────────────────────────────────────────────

const LogSection = styled.div`
  padding: 6px 10px 8px;
`;

const LogTitle = styled.div`
  font-size: 9px;
  color: ${T.borderFaint};
  text-transform: uppercase;
  letter-spacing: 0.1em;
  margin-bottom: 3px;
`;

const LogBox = styled.div`
  background: ${T.bgLog};
  border: 1px solid ${T.borderSub};
  border-radius: 5px;
  padding: 5px 7px;
`;

const eventColor: Record<EventType, string> = {
  heartbeat:    '#2563eb',
  motor:        '#a78bfa',
  command:      T.textMuted,
  connected:    '#34d399',
  disconnected: T.softRed,
  wifi:         T.amber,
};

const LogLine = styled.div`
  font-size: 10px;
  color: ${T.textFaint};
  font-family: 'Consolas', monospace;
  line-height: 1.7;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
`;

const LogTs = styled.span`
  color: #1a2d45;
  user-select: none;
`;

const LogMsg = styled.span<{ $type: EventType }>`
  color: ${({ $type }) => eventColor[$type] ?? T.textFaint};
`;

// ─── Sub-components ───────────────────────────────────────────────────────────

function buildWavePath(
  history: (0 | 1)[],
  x0: number,
  x1: number,
  rowTop: number,
  rowH: number,
): string {
  if (history.length === 0) return `${x0},${rowTop + rowH * 0.75} ${x1},${rowTop + rowH * 0.75}`;
  const hiY = rowTop + rowH * 0.25;
  const loY = rowTop + rowH * 0.75;
  const step = (x1 - x0) / history.length;
  const pts: string[] = [];

  history.forEach((v, i) => {
    const x = x0 + i * step;
    const y = v === 1 ? hiY : loY;
    if (i === 0) {
      pts.push(`${x.toFixed(1)},${y}`);
    } else if (v !== history[i - 1]) {
      const prevY = history[i - 1] === 1 ? hiY : loY;
      pts.push(`${x.toFixed(1)},${prevY}`);
      pts.push(`${x.toFixed(1)},${y}`);
    } else {
      pts.push(`${x.toFixed(1)},${y}`);
    }
  });
  pts.push(`${x1},${history[history.length - 1] === 1 ? hiY : loY}`);
  return pts.join(' ');
}

const SCOPE_W = 260;
const SCOPE_H = 72;
const LABEL_W = 22;
const ROWS = 4;
const ROW_H = SCOPE_H / ROWS;
const GRID_XS = [85, 148, 211];

const scopeLineColor = (history: (0 | 1)[]): string => {
  const transitions = history.filter((v, i) => i > 0 && v !== history[i - 1]).length;
  if (transitions === 0) return '#1a2d3a';
  if (transitions > 12) return T.softRed;
  if (transitions > 6)  return T.amber;
  return T.green;
};

function GpioScope({ pins }: { pins: PinState[] }) {
  return (
    <ScopeWrap>
      <ScopeSvg viewBox={`0 0 ${SCOPE_W} ${SCOPE_H}`} preserveAspectRatio="none">
        {/* Row backgrounds */}
        {Array.from({ length: ROWS }, (_, i) => (
          <rect
            key={i}
            x={0} y={i * ROW_H}
            width={SCOPE_W} height={ROW_H}
            fill={i % 2 === 0 ? T.bgScopeRow0 : T.bgScopeRow1}
          />
        ))}

        {/* Time-division grid lines */}
        {GRID_XS.map(x => (
          <line key={x} x1={x} y1={0} x2={x} y2={SCOPE_H} stroke={T.bgBase} strokeWidth={0.5} />
        ))}

        {/* Label strip */}
        <rect x={0} y={0} width={LABEL_W} height={SCOPE_H} fill={T.bgScopeLabel} />
        <line x1={LABEL_W} y1={0} x2={LABEL_W} y2={SCOPE_H} stroke={T.borderSub} strokeWidth={0.5} />

        {/* Per-pin traces */}
        {pins.slice(0, ROWS).map((pin, i) => {
          const rowTop = i * ROW_H;
          const color  = scopeLineColor(pin.history);
          const pts    = buildWavePath(pin.history, LABEL_W, SCOPE_W, rowTop, ROW_H);
          return (
            <g key={pin.num}>
              <text
                x={3} y={rowTop + ROW_H * 0.72}
                fontSize={7.5} fontFamily="monospace"
                fill={color === '#1a2d3a' ? T.textVeryFaint : color}
              >
                {pin.num}
              </text>
              <polyline points={pts} fill="none" stroke={color} strokeWidth={1.5} />
            </g>
          );
        })}

        {/* Time axis labels */}
        {['-3s', '-2s', '-1s', ' 0s'].map((label, i) => (
          <text
            key={label}
            x={i === 0 ? LABEL_W + 2 : GRID_XS[i - 1] + 2}
            y={SCOPE_H - 1}
            fontSize={6.5} fontFamily="monospace" fill={T.borderFaint}
          >
            {label}
          </text>
        ))}
      </ScopeSvg>
    </ScopeWrap>
  );
}

function GpioSection({ pins, status }: { pins: PinState[]; status: string }) {
  const [mode, setMode] = useState<GpioMode>('led');
  const isActive = status === 'connected';
  const pinState = (pin: PinState): 0 | 1 | null => (isActive ? pin.value : null);

  return (
    <GpioWrap>
      <GpioHeader>
        <GpioLabel>GPIO</GpioLabel>
        <TogglePill>
          <ToggleBtn $active={mode === 'led'} onClick={() => setMode('led')}>LED</ToggleBtn>
          <ToggleBtn $active={mode === 'scope'} onClick={() => setMode('scope')}>SCOPE</ToggleBtn>
        </TogglePill>
      </GpioHeader>

      {mode === 'led' ? (
        <LedStrip>
          {pins.map(pin => (
            <LedPin key={pin.num} $state={pinState(pin)}>
              <LedDot $state={pinState(pin)} />
              <PinNumber $state={pinState(pin)}>{pin.num}</PinNumber>
            </LedPin>
          ))}
        </LedStrip>
      ) : (
        <GpioScope pins={pins} />
      )}
    </GpioWrap>
  );
}

// ─── WiFi portal button ────────────────────────────────────────────────────────

const WifiBtn = styled.button`
  font-size: 10px;
  padding: 3px 8px;
  border-radius: 4px;
  border: 1px solid ${T.borderFaint};
  background: transparent;
  color: ${T.textDim};
  cursor: pointer;
  white-space: nowrap;
  flex-shrink: 0;

  &:hover {
    border-color: ${T.amber};
    color: ${T.amber};
  }
`;

// ─── DeviceCard ───────────────────────────────────────────────────────────────

interface DeviceCardProps {
  device: Device;
  onConnect?:     () => void;
  onDisconnect?:  () => void;
  onPower?:       (on: boolean) => void;
  onKill?:        () => void;
  onOpenPortal?:  () => void;
}

export function DeviceCard({ device, onConnect, onDisconnect, onPower, onKill, onOpenPortal }: DeviceCardProps) {
  const { name, uuid, status, uptime, owner, robot, pins, events } = device;

  const connVariant =
    status === 'connected'    ? 'disconnect'
    : status === 'off'        ? 'disabled'
    : 'connect';

  const connLabel =
    status === 'connected'    ? 'Disconnect'
    : status === 'reconnecting' ? 'Force'
    : status === 'off'        ? '—'
    : 'Connect';

  const handleConnBtn = () => {
    if (status === 'connected') onDisconnect?.();
    else if (status !== 'off')  onConnect?.();
  };

  return (
    <Card $status={status}>
      {/* Header */}
      <Header>
        <TitleRow>
          <PowerButton $on={status !== 'off'} onClick={() => onPower?.(status === 'off')} aria-label="Power">
            <svg viewBox="0 0 16 16" width="10" height="10" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
              <path d="M8 2v4" />
              <path d="M5 4.2A5 5 0 1 0 11 4.2" strokeLinejoin="round" />
            </svg>
          </PowerButton>
          <div>
            <DeviceName>{name}</DeviceName>
            <DeviceUuid>{uuid}</DeviceUuid>
          </div>
        </TitleRow>
        <WifiBtn title="Open WiFi captive portal" onClick={() => onOpenPortal?.()}>
          WiFi
        </WifiBtn>
      </Header>

      {/* Meta */}
      <MetaRow>
        <MetaStatus>
          <StatusDot $status={status} />
          <UptimeLabel>{uptime}</UptimeLabel>
        </MetaStatus>

        {owner ? (
          <OwnerRow>
            <Avatar $color={owner.color}>{owner.initials}</Avatar>
            <div>
              <OwnerName>{owner.name}</OwnerName>
              <OwnerEmail>{owner.email}</OwnerEmail>
            </div>
          </OwnerRow>
        ) : (
          <UnclaimedLabel>unclaimed</UnclaimedLabel>
        )}

        <ConnButton $variant={connVariant} disabled={status === 'off'} onClick={handleConnBtn}>
          {connLabel}
        </ConnButton>
      </MetaRow>

      {/* Robot / program */}
      <RobotRowWrap>
        {robot ? (
          <>
            <RobotIcon>🤖</RobotIcon>
            <RobotName>{robot.name}</RobotName>
            <RobotSep>·</RobotSep>
            <ProgramChip>{robot.program}</ProgramChip>
          </>
        ) : (
          <NoRobotLabel>no robot assigned</NoRobotLabel>
        )}
      </RobotRowWrap>

      {/* GPIO */}
      <GpioSection pins={pins} status={status} />

      {/* Event log */}
      <LogSection>
        <LogTitle>Event log</LogTitle>
        <LogBox>
          {events.map((ev, i) => (
            <LogLine key={i}>
              <LogTs>{ev.time} </LogTs>
              <LogMsg $type={ev.type}>{ev.message}</LogMsg>
            </LogLine>
          ))}
        </LogBox>
      </LogSection>
    </Card>
  );
}
