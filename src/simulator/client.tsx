/**
 * Simulator React client entry point.
 *
 * Mounts <SimulatorDashboard> and keeps device state in sync via the SSE
 * stream at /api/events once the user has signed in with robots-gateway.
 */

import React, { useCallback, useEffect, useReducer, useState } from 'react';
import ReactDOM from 'react-dom';
import styled, { keyframes } from 'styled-components';
import { SimulatorDashboard } from './SimulatorDashboard';
import { AuthScreen } from './AuthScreen';
import {
  getCurrentUser,
  login,
  logout,
  type UserSession,
} from './authService';
import type { Device } from './types';

// ── State ─────────────────────────────────────────────────────────────────────

interface State {
  devices: Device[];
  watcherLastReload: string | null;
  error: string | null;
}

type Action =
  | { type: 'init'; devices: Device[] }
  | { type: 'device-added'; device: Device }
  | { type: 'device-updated'; device: Device }
  | { type: 'device-removed'; id: string }
  | { type: 'error'; message: string };

function reducer(state: State, action: Action): State {
  switch (action.type) {
    case 'init':
      return { ...state, devices: action.devices, error: null };

    case 'device-added':
      return { ...state, devices: [...state.devices, action.device] };

    case 'device-updated':
      return {
        ...state,
        devices: state.devices.map(d => (d.id === action.device.id ? action.device : d)),
      };

    case 'device-removed':
      return { ...state, devices: state.devices.filter(d => d.id !== action.id) };

    case 'error':
      return { ...state, error: action.message };

    default:
      return state;
  }
}

const initialState: State = {
  devices: [],
  watcherLastReload: null,
  error: null,
};

// ── Styling ───────────────────────────────────────────────────────────────────

const LoadingShell = styled.div`
  min-height: 100vh;
  display: grid;
  place-items: center;
  background: linear-gradient(135deg, #0f1117 0%, #1a1f2e 100%);
  color: #e2e8f0;
`;

const LoadingCard = styled.div`
  min-width: 280px;
  padding: 28px 30px;
  border-radius: 16px;
  border: 1px solid #2d3748;
  background: rgba(17, 24, 39, 0.95);
  display: grid;
  gap: 14px;
  justify-items: center;
  text-align: center;
`;

const spin = keyframes`
  to { transform: rotate(360deg); }
`;

const Spinner = styled.div`
  width: 18px;
  height: 18px;
  border-radius: 50%;
  border: 2px solid rgba(255, 255, 255, 0.25);
  border-top-color: #7c3aed;
  animation: ${spin} 1s linear infinite;
`;

// ── SSE hook ──────────────────────────────────────────────────────────────────

function useDeviceStream(dispatch: React.Dispatch<Action>, enabled: boolean) {
  useEffect(() => {
    if (!enabled) return;

    const es = new EventSource('/api/events');

    es.onmessage = (ev: MessageEvent<string>) => {
      try {
        const msg = JSON.parse(ev.data) as Action;
        dispatch(msg);
      } catch {
        // ignore malformed messages
      }
    };

    es.onerror = () => {
      dispatch({ type: 'error', message: 'Lost connection to simulator - reconnecting.' });
    };

    return () => es.close();
  }, [dispatch, enabled]);
}

// ── API helpers ───────────────────────────────────────────────────────────────

async function handleLogin(identifier: string, password: string): Promise<UserSession> {
  return login(identifier, password);
}

async function apiPost(url: string, body?: unknown): Promise<void> {
  const res = await fetch(url, {
    method: 'POST',
    credentials: 'include',
    headers: {
      'Content-Type': 'application/json',
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });

  if (!res.ok) {
    const payload = await res.json().catch(() => ({}));
    throw new Error(payload.error ?? `HTTP ${res.status}`);
  }
}

async function apiDelete(url: string): Promise<void> {
  const res = await fetch(url, { method: 'DELETE' });
  if (!res.ok) {
    throw new Error(`HTTP ${res.status}`);
  }
}

// ── Root component ────────────────────────────────────────────────────────────

function SimulatorApp() {
  const [state, dispatch] = useReducer(reducer, initialState);
  const [authChecked, setAuthChecked] = useState(false);
  const [session, setSession] = useState<UserSession | null>(null);

  useEffect(() => {
    let cancelled = false;

    (async () => {
      try {
        const current = await getCurrentUser();
        if (cancelled) return;
        setSession(current);
      } finally {
        if (!cancelled) setAuthChecked(true);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  useDeviceStream(dispatch, authChecked && session !== null);

  const handleLogout = useCallback(async () => {
    await logout();
    setSession(null);
  }, []);

  const handleSpawn = useCallback(async () => {
    try {
      await apiPost('/api/devices');
    } catch (err) {
      dispatch({ type: 'error', message: String(err) });
    }
  }, []);

  const handleSpawnUnattached = useCallback(async () => {
    try {
      await apiPost('/api/devices', { attach: false });
    } catch (err) {
      dispatch({ type: 'error', message: String(err) });
    }
  }, []);

  const handleConnect = useCallback(async (id: string) => {
    try {
      await apiPost(`/api/devices/${id}/connect`);
    } catch (err) {
      dispatch({ type: 'error', message: String(err) });
    }
  }, []);

  const handleDisconnect = useCallback(async (id: string) => {
    try {
      await apiPost(`/api/devices/${id}/disconnect`);
    } catch (err) {
      dispatch({ type: 'error', message: String(err) });
    }
  }, []);

  const handlePower = useCallback(async (id: string, on: boolean) => {
    try {
      await apiPost(`/api/devices/${id}/power`, { on });
    } catch (err) {
      dispatch({ type: 'error', message: String(err) });
    }
  }, []);

  const handleKill = useCallback(async (id: string) => {
    try {
      await apiDelete(`/api/devices/${id}`);
    } catch (err) {
      dispatch({ type: 'error', message: String(err) });
    }
  }, []);

  const handleOpenPortal = useCallback((id: string) => {
    window.open(`/portal/${id}`, '_blank', 'noopener,noreferrer');
  }, []);

  if (!authChecked) {
    return (
      <LoadingShell>
        <LoadingCard>
          <Spinner />
          <div>
            <div style={{ fontSize: 16, fontWeight: 700 }}>Checking session</div>
            <div style={{ marginTop: 4, color: '#94a3b8', fontSize: 13 }}>
              Connecting to robots-gateway...
            </div>
          </div>
        </LoadingCard>
      </LoadingShell>
    );
  }

  if (!session) {
    return (
      <AuthScreen
        onLogin={async (identifier, password) => {
          const next = await handleLogin(identifier, password);
          setSession(next);
        }}
      />
    );
  }

  const userLabel = session.name || session.username || session.email || 'Signed in';

  return (
    <SimulatorDashboard
      devices={state.devices}
      watcherFile="src/**/*.ts"
      userLabel={userLabel}
      onLogout={handleLogout}
      onSpawn={handleSpawn}
      onSpawnUnattached={handleSpawnUnattached}
      onConnect={handleConnect}
      onDisconnect={handleDisconnect}
      onPower={handlePower}
      onKill={handleKill}
      onOpenPortal={handleOpenPortal}
    />
  );
}

// ── Mount ─────────────────────────────────────────────────────────────────────

ReactDOM.render(
  <React.StrictMode>
    <SimulatorApp />
  </React.StrictMode>,
  document.getElementById('root'),
);
