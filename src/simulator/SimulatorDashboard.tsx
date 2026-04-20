import React, { useEffect, useRef, useState } from 'react';
import styled, { keyframes } from 'styled-components';
import { DeviceCard } from './DeviceCard';
import type { Device, DeviceStatus } from './types';

// ─── Tokens ───────────────────────────────────────────────────────────────────

const T = {
  bgBase:      '#0f1117',
  bgHeader:    '#1a1f2e',
  border:      '#2d3748',
  borderFaint: '#1e293b',
  borderSub:   '#111827',
  text:        '#e2e8f0',
  textMuted:   '#94a3b8',
  textDim:     '#64748b',
  textFaint:   '#475569',
  accent:      '#7c3aed',
  blue:        '#3b82f6',
  green:       '#10b981',
  amber:       '#f59e0b',
  red:         '#ef4444',
} as const;

// ─── App header ───────────────────────────────────────────────────────────────

const AppHeader = styled.header`
  background: ${T.bgHeader};
  border-bottom: 1px solid ${T.border};
  padding: 12px 20px;
  display: flex;
  align-items: center;
  gap: 16px;
`;

const AppTitle = styled.h1`
  font-size: 16px;
  font-weight: 700;
  color: ${T.accent};
  letter-spacing: 0.05em;
  margin: 0;
`;

const Badge = styled.span<{ $variant?: 'green' | 'yellow' | 'default' }>`
  background: ${({ $variant }) =>
    $variant === 'green'  ? '#064e3b'
    : $variant === 'yellow' ? '#451a03'
    : T.border};
  color: ${({ $variant }) =>
    $variant === 'green'  ? T.green
    : $variant === 'yellow' ? T.amber
    : T.textMuted};
  font-size: 11px;
  padding: 2px 8px;
  border-radius: 10px;
`;

const Spacer = styled.div`flex: 1;`;

const HdrButton = styled.button<{ $secondary?: boolean }>`
  background: ${({ $secondary }) => ($secondary ? '#1e293b' : T.accent)};
  border: ${({ $secondary }) => ($secondary ? `1px solid #334155` : 'none')};
  color: ${({ $secondary }) => ($secondary ? T.textMuted : 'white')};
  border-radius: 6px;
  padding: 6px 14px;
  font-size: 12px;
  font-weight: 600;
  cursor: pointer;
`;

const SplitButtonWrap = styled.div`
  position: relative;
  display: inline-flex;
  align-items: stretch;
`;

const SplitButtonMain = styled(HdrButton)`
  border-top-right-radius: 0;
  border-bottom-right-radius: 0;
`;

const SplitButtonToggle = styled(HdrButton)<{ $open?: boolean }>`
  width: 30px;
  padding: 6px 0;
  border-top-left-radius: 0;
  border-bottom-left-radius: 0;
  border-left: 1px solid rgba(255, 255, 255, 0.08);
  background: ${({ $open }) => ($open ? '#334155' : '#1e293b')};
  color: ${T.textMuted};
  display: grid;
  place-items: center;
`;

const SplitMenu = styled.div`
  position: absolute;
  top: calc(100% + 6px);
  right: 0;
  z-index: 40;
  min-width: 220px;
  padding: 6px;
  background: #111827;
  border: 1px solid #334155;
  border-radius: 10px;
  box-shadow: 0 18px 32px rgba(0, 0, 0, 0.35);
`;

const SplitMenuItem = styled.button`
  width: 100%;
  border: none;
  background: transparent;
  color: ${T.text};
  font-size: 12px;
  font-weight: 600;
  text-align: left;
  padding: 8px 10px;
  border-radius: 8px;
  cursor: pointer;

  &:hover {
    background: #1f2937;
  }
`;

// ─── Watcher bar ──────────────────────────────────────────────────────────────

const pulse = keyframes`
  0%, 100% { opacity: 1; }
  50%       { opacity: 0.4; }
`;

const WatcherBar = styled.div`
  background: ${T.bgBase};
  border-bottom: 1px solid ${T.borderFaint};
  padding: 5px 20px;
  font-size: 11px;
  color: ${T.textDim};
  display: flex;
  align-items: center;
  gap: 8px;
`;

const WatcherDot = styled.span`
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: ${T.green};
  display: inline-block;
  animation: ${pulse} 2s infinite;
`;

// ─── Toolbar ──────────────────────────────────────────────────────────────────

const Toolbar = styled.div`
  padding: 8px 16px;
  background: ${T.bgBase};
  border-bottom: 1px solid ${T.borderFaint};
  display: flex;
  align-items: center;
  gap: 10px;
`;

const SearchWrap = styled.div`
  position: relative;
  flex: 0 0 200px;
`;

const SearchInput = styled.input`
  width: 100%;
  background: #111827;
  border: 1px solid ${T.border};
  border-radius: 6px;
  padding: 5px 10px 5px 26px;
  font-size: 11px;
  color: ${T.text};
  outline: none;

  &::placeholder { color: #374151; }
`;

const FilterGroup = styled.div`display: flex; gap: 3px;`;

const filterColors: Record<DeviceStatus | 'all', string> = {
  all:          T.textMuted,
  connected:    T.blue,
  reconnecting: T.amber,
  disconnected: T.red,
  off:          '#374151',
};

const FilterBtn = styled.button<{ $key: DeviceStatus | 'all'; $active: boolean }>`
  font-size: 11px;
  padding: 4px 9px;
  border-radius: 5px;
  border: 1px solid ${({ $key, $active }) => ($active ? filterColors[$key] : T.border)};
  background: transparent;
  color: ${({ $key, $active }) => ($active ? filterColors[$key] : T.textDim)};
  cursor: pointer;
  display: flex;
  align-items: center;
  gap: 4px;
  white-space: nowrap;
`;

const FilterDot = styled.span<{ $key: DeviceStatus | 'all' }>`
  width: 5px;
  height: 5px;
  border-radius: 50%;
  background: ${({ $key }) => filterColors[$key]};
`;

const ToolbarSpacer = styled.div`flex: 1;`;

const Pagination = styled.div`
  display: flex;
  align-items: center;
  gap: 3px;
`;

const PageInfo = styled.span`
  font-size: 11px;
  color: ${T.textFaint};
  margin-right: 6px;
  white-space: nowrap;
`;

const PageBtn = styled.button<{ $active?: boolean }>`
  width: 26px;
  height: 26px;
  border-radius: 5px;
  border: 1px solid ${({ $active }) => ($active ? T.accent : T.border)};
  background: ${({ $active }) => ($active ? T.accent : 'transparent')};
  color: ${({ $active }) => ($active ? 'white' : T.textDim)};
  font-size: 11px;
  font-weight: ${({ $active }) => ($active ? 700 : 400)};
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
`;

// ─── Device grid ──────────────────────────────────────────────────────────────

const DeviceGrid = styled.main`
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 10px;
  padding: 12px 16px;
`;

// ─── Stats bar ────────────────────────────────────────────────────────────────

const StatsBar = styled.footer`
  display: flex;
  gap: 12px;
  padding: 8px 20px;
  border-top: 1px solid ${T.borderFaint};
  background: ${T.bgBase};
  font-size: 11px;
  color: ${T.textFaint};
`;

const StatVal = styled.span<{ $color?: string }>`
  color: ${({ $color }) => $color ?? T.textMuted};
  font-weight: 600;
`;

// ─── SimulatorDashboard ───────────────────────────────────────────────────────

const PAGE_SIZE = 8;
type FilterKey = DeviceStatus | 'all';

interface Props {
  devices: Device[];
  watcherFile?: string;
  watcherLastReload?: string;
  userLabel?: string;
  onLogout?: () => void;
  onSpawn?:       () => void;
  onSpawnUnattached?: () => void;
  onImport?:      () => void;
  onConnect?:     (id: string) => void;
  onDisconnect?:  (id: string) => void;
  onPower?:       (id: string, on: boolean) => void;
  onKill?:        (id: string) => void;
  onOpenPortal?:  (id: string) => void;
}

export function SimulatorDashboard({
  devices,
  watcherFile = 'src/**/*.ts',
  watcherLastReload,
  userLabel,
  onLogout,
  onSpawn,
  onSpawnUnattached,
  onImport,
  onConnect,
  onDisconnect,
  onPower,
  onKill,
  onOpenPortal,
}: Props) {
  const [search, setSearch]   = useState('');
  const [filter, setFilter]   = useState<FilterKey>('all');
  const [page, setPage]       = useState(0);
  const [spawnMenuOpen, setSpawnMenuOpen] = useState(false);
  const spawnMenuRef = useRef<HTMLDivElement>(null);
  
  // Flash manager state
  const [drives, setDrives] = useState<Drive[]>([
    { letter: 'E:', name: 'SD_CARD', size: 32 * 1024 * 1024 * 1024, free: 0, condition: 'ready' },
    { letter: 'F:', name: 'USB_DRIVE', size: 64 * 1024 * 1024 * 1024, free: 32 * 1024 * 1024 * 1024, condition: 'ready' },
  ]);
  const [distributions, setDistributions] = useState<Distribution[]>([]);
  const [flashState, setFlashState] = useState<FlashState>({ 
    status: 'flashing', 
    progress: 0, 
    log: [],
    driveStates: {
      'E:': { status: 'preparing', progress: 0 },
      'F:': { status: 'flashing', progress: 30 },
    },
    driveLogs: {
      'E:': 'writing bits...hello?',
      'F:': 'writing bits...hello?',
    },
  });
  
  // Load drives and distributions on mount
  useEffect(() => {
    // detectDrives().then(setDrives);
    fetch('/distribution-config.json')
      .then(r => r.json())
      .then(cfg => setDistributions(cfg.distributions || []))
      .catch(() => {});
  }, []);

  useEffect(() => {
    const onDocMouseDown = (event: MouseEvent) => {
      if (!spawnMenuRef.current?.contains(event.target as Node)) {
        setSpawnMenuOpen(false);
      }
    };

    document.addEventListener('mousedown', onDocMouseDown);
    return () => document.removeEventListener('mousedown', onDocMouseDown);
  }, []);

  const counts: Record<FilterKey, number> = {
    all:          devices.length,
    connected:    devices.filter(d => d.status === 'connected').length,
    reconnecting: devices.filter(d => d.status === 'reconnecting').length,
    disconnected: devices.filter(d => d.status === 'disconnected').length,
    off:          devices.filter(d => d.status === 'off').length,
  };

  const filtered = devices.filter(d => {
    if (filter !== 'all' && d.status !== filter) return false;
    if (search) {
      const q = search.toLowerCase();
      return (
        d.name.toLowerCase().includes(q) ||
        d.uuid.toLowerCase().includes(q) ||
        d.owner?.name.toLowerCase().includes(q) ||
        d.owner?.email.toLowerCase().includes(q)
      );
    }
    return true;
  });

  const totalPages = Math.ceil(filtered.length / PAGE_SIZE);
  const pageDevices = filtered.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE);
  const pageStart = page * PAGE_SIZE + 1;
  const pageEnd   = Math.min((page + 1) * PAGE_SIZE, filtered.length);

  const filters: { key: FilterKey; label: string }[] = [
    { key: 'all',          label: `All ${counts.all}` },
    { key: 'connected',    label: `Connected ${counts.connected}` },
    { key: 'reconnecting', label: `Reconnecting ${counts.reconnecting}` },
    { key: 'disconnected', label: `Disconnected ${counts.disconnected}` },
    { key: 'off',          label: `Off ${counts.off}` },
  ];

  return (
    <div style={{ background: T.bgBase, minHeight: '100vh', color: T.text }}>
      {/* App header */}
      <AppHeader>
        <AppTitle>⬡ OROBOT DEVICE SIMULATOR</AppTitle>
        <Badge $variant="green">{counts.connected} online</Badge>
        {counts.reconnecting > 0 && (
          <Badge $variant="yellow">{counts.reconnecting} reconnecting</Badge>
        )}
        <Badge>{devices.length} total</Badge>
        <Spacer />
        {userLabel && <Badge>{userLabel}</Badge>}
        {onLogout && <HdrButton $secondary onClick={onLogout}>Log out</HdrButton>}
        <HdrButton $secondary onClick={onImport}>Import UUID</HdrButton>
        {onSpawn && (
          <SplitButtonWrap ref={spawnMenuRef}>
            <SplitButtonMain onClick={onSpawn}>+ Spawn Device</SplitButtonMain>
            <SplitButtonToggle
              type="button"
              $open={spawnMenuOpen}
              onClick={() => setSpawnMenuOpen(v => !v)}
              aria-haspopup="menu"
              aria-expanded={spawnMenuOpen}
              aria-label="Spawn device options"
            >
              ▾
            </SplitButtonToggle>
            {spawnMenuOpen && onSpawnUnattached && (
              <SplitMenu role="menu">
                <SplitMenuItem
                  type="button"
                  role="menuitem"
                  onClick={() => {
                    setSpawnMenuOpen(false);
                    onSpawnUnattached();
                  }}
                >
                  Spawn unattached device
                </SplitMenuItem>
              </SplitMenu>
            )}
          </SplitButtonWrap>
        )}
      </AppHeader>

      {/* Watcher bar */}
      <WatcherBar>
        <WatcherDot />
        Watching <code>{watcherFile}</code>
        {watcherLastReload && <> — last reload {watcherLastReload}</>}
        {' '}· {devices.length} devices hot-reloaded
      </WatcherBar>

      {/* Toolbar */}
      <Toolbar>
        <SearchWrap>
          <SearchInput
            placeholder="Search name, UUID, owner…"
            value={search}
            onChange={e => { setSearch(e.target.value); setPage(0); }}
          />
        </SearchWrap>

        <FilterGroup>
          {filters.map(({ key, label }) => (
            <FilterBtn
              key={key}
              $key={key}
              $active={filter === key}
              onClick={() => { setFilter(key); setPage(0); }}
            >
              {key !== 'all' && <FilterDot $key={key} />}
              {label}
            </FilterBtn>
          ))}
        </FilterGroup>

        <ToolbarSpacer />

        <Pagination>
          <PageInfo>{pageStart}–{pageEnd} of {filtered.length}</PageInfo>
          <PageBtn onClick={() => setPage(p => Math.max(0, p - 1))}>◀</PageBtn>
          {Array.from({ length: totalPages }, (_, i) => (
            <PageBtn key={i} $active={i === page} onClick={() => setPage(i)}>
              {i + 1}
            </PageBtn>
          ))}
          <PageBtn onClick={() => setPage(p => Math.min(totalPages - 1, p + 1))}>▶</PageBtn>
        </Pagination>
      </Toolbar>

      {/* Device grid */}
      <DeviceGrid>
        {pageDevices.map(device => (
          <DeviceCard
            key={device.id}
            device={device}
            onConnect={onConnect       ? () => onConnect(device.id)           : undefined}
            onDisconnect={onDisconnect ? () => onDisconnect(device.id)        : undefined}
            onPower={onPower           ? (on) => onPower(device.id, on)       : undefined}
            onKill={onKill             ? () => onKill(device.id)              : undefined}
            onOpenPortal={onOpenPortal ? () => onOpenPortal(device.id)        : undefined}
          />
        ))}
      </DeviceGrid>

      {/* Stats bar */}
      <StatsBar>
        <span>Total: <StatVal>{devices.length}</StatVal></span>
        <span>Connected: <StatVal $color={T.blue}>{counts.connected}</StatVal></span>
        <span>Reconnecting: <StatVal $color={T.amber}>{counts.reconnecting}</StatVal></span>
        <span>Disconnected: <StatVal $color={T.red}>{counts.disconnected}</StatVal></span>
        <span>Off: <StatVal>{counts.off}</StatVal></span>
        <Spacer />
        <span>Page {page + 1} of {totalPages}</span>
        <span>Watcher: <StatVal $color={T.green}>active</StatVal></span>
      </StatsBar>
    </div>
  );
}
