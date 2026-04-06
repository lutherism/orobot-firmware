/**
 * Simulator React client entry point.
 *
 * Mounts <SimulatorDashboard> and keeps device state in sync via the SSE
 * stream at /api/events. All mutations go through fetch() calls to the
 * REST API endpoints.
 */

import React, { useEffect, useReducer, useCallback } from 'react';
import ReactDOM from 'react-dom';
import { SimulatorDashboard } from './SimulatorDashboard';
import type { Device } from './types';

// ── State ─────────────────────────────────────────────────────────────────────

interface State {
  devices:         Device[];
  watcherLastReload: string | null;
  error:           string | null;
}

type Action =
  | { type: 'init';           devices: Device[] }
  | { type: 'device-added';   device:  Device   }
  | { type: 'device-updated'; device:  Device   }
  | { type: 'device-removed'; id:      string   }
  | { type: 'error';          message: string   };

function reducer(state: State, action: Action): State {
  switch (action.type) {
    case 'init':
      return { ...state, devices: action.devices, error: null };

    case 'device-added':
      return { ...state, devices: [...state.devices, action.device] };

    case 'device-updated':
      return {
        ...state,
        devices: state.devices.map(d =>
          d.id === action.device.id ? action.device : d,
        ),
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
  devices:          [],
  watcherLastReload: null,
  error:            null,
};

// ── SSE hook ──────────────────────────────────────────────────────────────────

function useDeviceStream(dispatch: React.Dispatch<Action>) {
  useEffect(() => {
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
      dispatch({ type: 'error', message: 'Lost connection to simulator — reconnecting…' });
    };

    return () => es.close();
  }, [dispatch]);
}

// ── API helpers ───────────────────────────────────────────────────────────────

async function apiPost(url: string, body?: unknown): Promise<void> {
  const res = await fetch(url, {
    method:  'POST',
    headers: { 'Content-Type': 'application/json' },
    body:    body !== undefined ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) {
    const { error } = await res.json() as { error: string };
    throw new Error(error ?? `HTTP ${res.status}`);
  }
}

async function apiDelete(url: string): Promise<void> {
  const res = await fetch(url, { method: 'DELETE' });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
}

// ── Root component ────────────────────────────────────────────────────────────

function SimulatorApp() {
  const [state, dispatch] = useReducer(reducer, initialState);
  useDeviceStream(dispatch);

  const handleSpawn = useCallback(async () => {
    try {
      await apiPost('/api/devices');
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

  return (
    <SimulatorDashboard
      devices={state.devices}
      watcherFile="src/**/*.ts"
      onSpawn={handleSpawn}
      onConnect={handleConnect}
      onDisconnect={handleDisconnect}
      onPower={handlePower}
      onKill={handleKill}
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
