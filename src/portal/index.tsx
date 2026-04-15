import React, { useState, useEffect, useCallback } from 'react';
import ReactDOM from 'react-dom';

// ── Types ─────────────────────────────────────────────────────────────────────

interface WifiNetwork {
  ssid:     string;
  signal:   number;   // dBm
  security: 'WPA2' | 'WPA3' | 'open';
}

interface PortalConfig {
  wifiUrl:    string;   // base URL for GET/POST
  deviceName: string;
}

type View = 'scan' | 'connect' | 'success' | 'claim';

// ── Runtime config (injected by the server) ───────────────────────────────────

declare global {
  interface Window {
    OROBOT_PORTAL?: Partial<PortalConfig>;
  }
}

const CONFIG: PortalConfig = {
  wifiUrl:    '/api/wifi',
  deviceName: 'your robot',
  ...window.OROBOT_PORTAL,
};

// ── Styles ────────────────────────────────────────────────────────────────────

const S = {
  body: {
    fontFamily: 'Inter, system-ui, sans-serif',
    background: '#f1f5f9',
    color: '#1e293b',
    minHeight: '100vh',
    display: 'flex',
    alignItems: 'flex-start' as const,
    justifyContent: 'center',
    padding: '40px 16px',
    margin: 0,
  },
  card: {
    background: '#fff',
    borderRadius: 16,
    boxShadow: '0 4px 24px rgba(0,0,0,.08), 0 1px 4px rgba(0,0,0,.04)',
    width: '100%',
    maxWidth: 420,
    overflow: 'hidden' as const,
  },
  header: {
    padding: '24px 24px 20px',
    borderBottom: '1px solid #f1f5f9',
    borderTop: '4px solid transparent',
    borderImage: 'linear-gradient(160deg, #0e7490 0%, #0891b2 40%, #22d3ee 100%) 1',
  },
  logoBadge: {
    display: 'flex',
    alignItems: 'center',
    gap: 10,
    marginBottom: 12,
  },
  logoText: {
    fontSize: 14,
    fontWeight: 800,
    color: '#0f172a',
    letterSpacing: '-0.01em',
  },
  h1: { fontSize: 18, fontWeight: 700, color: '#0f172a', marginBottom: 4 },
  headerSub: { fontSize: 13, color: '#64748b' },
  sectionLabel: {
    fontSize: 11,
    fontWeight: 600,
    color: '#94a3b8',
    textTransform: 'uppercase' as const,
    letterSpacing: '0.06em',
    padding: '16px 24px 8px',
  },
  networkItem: (hovered: boolean): React.CSSProperties => ({
    display: 'flex',
    alignItems: 'center',
    gap: 12,
    padding: '13px 24px',
    cursor: 'pointer',
    background: hovered ? '#f8fafc' : '#fff',
    transition: 'background 0.1s',
  }),
  networkDivider: { border: 'none', borderTop: '1px solid #f1f5f9', margin: '0 24px' },
  networkName: { fontSize: 14, fontWeight: 500, color: '#0f172a', flex: 1 },
  badge: (isOpen: boolean): React.CSSProperties => ({
    fontSize: 10,
    fontWeight: 600,
    padding: '2px 7px',
    borderRadius: 999,
    background: isOpen ? '#dcfce7' : '#f1f5f9',
    color: isOpen ? '#16a34a' : '#64748b',
  }),
  scanning: {
    padding: '36px 24px',
    textAlign: 'center' as const,
    color: '#94a3b8',
    fontSize: 13,
  },
  connectForm: { padding: 24 },
  h2: { fontSize: 16, fontWeight: 700, color: '#0f172a', marginBottom: 4 },
  formSub: { fontSize: 13, color: '#64748b', marginBottom: 20 },
  fieldLabel: {
    display: 'block',
    fontSize: 12,
    fontWeight: 600,
    color: '#475569',
    marginBottom: 6,
  },
  input: (focused: boolean): React.CSSProperties => ({
    display: 'block',
    width: '100%',
    background: focused ? '#fff' : '#f8fafc',
    border: `1.5px solid ${focused ? '#0891b2' : '#e2e8f0'}`,
    borderRadius: 8,
    padding: '10px 12px',
    fontSize: 14,
    color: '#0f172a',
    outline: 'none',
    transition: 'border-color 0.15s',
  }),
  showPassRow: {
    display: 'flex',
    alignItems: 'center',
    gap: 7,
    marginTop: 8,
    marginBottom: 16,
  },
  showPassLabel: { fontSize: 12, color: '#64748b', cursor: 'pointer', userSelect: 'none' as const },
  errorBox: {
    fontSize: 12,
    color: '#dc2626',
    background: '#fef2f2',
    border: '1px solid #fecaca',
    borderRadius: 6,
    padding: '8px 10px',
    marginBottom: 14,
  },
  btnRow: { display: 'flex', gap: 8, marginTop: 4 },
  btnPrimary: (disabled: boolean): React.CSSProperties => ({
    flex: 1,
    padding: '10px 16px',
    borderRadius: 8,
    fontSize: 14,
    fontWeight: 600,
    cursor: disabled ? 'not-allowed' : 'pointer',
    border: 'none',
    background: '#0891b2',
    color: '#fff',
    opacity: disabled ? 0.5 : 1,
    transition: 'opacity 0.15s',
  }),
  btnSecondary: {
    flex: 1,
    padding: '10px 16px',
    borderRadius: 8,
    fontSize: 14,
    fontWeight: 600,
    cursor: 'pointer',
    background: '#f1f5f9',
    color: '#475569',
    border: '1.5px solid #e2e8f0',
  } as React.CSSProperties,
  successScreen: { padding: '48px 24px 40px', textAlign: 'center' as const },
  successIcon: {
    width: 56,
    height: 56,
    background: '#f0fdf4',
    borderRadius: '50%',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    margin: '0 auto 16px',
  },
  successH2: { fontSize: 18, fontWeight: 700, color: '#0f172a', marginBottom: 8 },
  successP: { fontSize: 13, color: '#64748b', lineHeight: 1.5 },
  successHint: { marginTop: 24, fontSize: 12, color: '#94a3b8' },
  codeDisplay: {
    fontFamily: 'monospace',
    fontSize: '2.2rem',
    fontWeight: 700,
    letterSpacing: '0.25em',
    textAlign: 'center' as const,
    background: '#f8fafc',
    border: '2px solid #e2e8f0',
    borderRadius: 10,
    padding: '16px 0',
    marginBottom: 8,
    color: '#0f172a',
  },
};

// ── Signal bars ───────────────────────────────────────────────────────────────

function SignalBars({ dbm }: { dbm: number }) {
  const strength = dbm >= -50 ? 4 : dbm >= -60 ? 3 : dbm >= -70 ? 2 : 1;
  const heights  = [6, 10, 14, 18];
  return (
    <div style={{ display: 'flex', alignItems: 'flex-end', gap: 2, flexShrink: 0, width: 18 }}>
      {heights.map((h, i) => (
        <span
          key={i}
          style={{
            width: 4,
            height: h,
            borderRadius: 1,
            background: i < strength ? '#22d3ee' : '#e2e8f0',
          }}
        />
      ))}
    </div>
  );
}

// ── Spinner ───────────────────────────────────────────────────────────────────

function Spinner() {
  return (
    <>
      <style>{`
        @keyframes orobot-spin { to { transform: rotate(360deg); } }
        .orobot-spinner {
          width: 24px; height: 24px;
          border: 2px solid #e2e8f0;
          border-top-color: #0891b2;
          border-radius: 50%;
          animation: orobot-spin 0.7s linear infinite;
          margin: 0 auto 12px;
        }
      `}</style>
      <div className="orobot-spinner" />
    </>
  );
}

// ── PortalLogo ────────────────────────────────────────────────────────────────

function PortalLogo() {
  return (
    <div style={S.logoBadge}>
      <img src="/logo3-thumb.png" width={28} height={28} alt="orobot.io logo" />
      <span style={S.logoText}>orobot.io</span>
    </div>
  );
}

// ── ScanView ──────────────────────────────────────────────────────────────────

interface ScanViewProps {
  onSelect: (ssid: string, isOpen: boolean) => void;
}

function ScanView({ onSelect }: ScanViewProps) {
  const [networks, setNetworks] = useState<WifiNetwork[] | null>(null);
  const [error, setError]       = useState(false);
  const [hovered, setHovered]   = useState<string | null>(null);

  useEffect(() => {
    fetch(CONFIG.wifiUrl)
      .then(r => r.json())
      .then(d => setNetworks(d.networks ?? d.wifi ?? []))
      .catch(() => setError(true));
  }, []);

  if (error) {
    return (
      <div style={{ ...S.scanning, color: '#dc2626' }}>
        Failed to scan networks. Please try again.
      </div>
    );
  }

  if (!networks) {
    return (
      <div style={S.scanning}>
        <Spinner />
        Scanning for networks&hellip;
      </div>
    );
  }

  if (!networks.length) {
    return <div style={S.scanning}>No networks found nearby.</div>;
  }

  return (
    <div>
      <div style={S.sectionLabel}>Available Networks</div>
      {networks.map((n, i) => (
        <React.Fragment key={n.ssid}>
          {i > 0 && <hr style={S.networkDivider} />}
          <div
            style={S.networkItem(hovered === n.ssid)}
            onMouseEnter={() => setHovered(n.ssid)}
            onMouseLeave={() => setHovered(null)}
            onClick={() => onSelect(n.ssid, n.security === 'open')}
          >
            <SignalBars dbm={n.signal} />
            <span style={S.networkName}>{n.ssid}</span>
            <span style={S.badge(n.security === 'open')}>
              {n.security === 'open' ? 'Open' : n.security}
            </span>
          </div>
        </React.Fragment>
      ))}
    </div>
  );
}

// ── ConnectView ───────────────────────────────────────────────────────────────

interface ConnectViewProps {
  ssid:    string;
  isOpen:  boolean;
  onBack:  () => void;
  onSuccess: () => void;
}

function ConnectView({ ssid, isOpen, onBack, onSuccess }: ConnectViewProps) {
  const [password,     setPassword]     = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [focused,      setFocused]      = useState(false);
  const [busy,         setBusy]         = useState(false);
  const [error,        setError]        = useState<string | null>(null);

  const connect = useCallback(async () => {
    setBusy(true);
    setError(null);
    try {
      const res  = await fetch(CONFIG.wifiUrl, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ ssid, password }),
      });
      const data = await res.json() as { ok: boolean; error?: string };
      if (data.ok) {
        onSuccess();
      } else {
        setError(data.error ?? 'Incorrect password — please try again.');
        setBusy(false);
      }
    } catch {
      setError('Network error — please try again.');
      setBusy(false);
    }
  }, [ssid, password, onSuccess]);

  return (
    <div style={S.connectForm}>
      <h2 style={S.h2}>{ssid}</h2>
      <p style={S.formSub}>
        {isOpen
          ? 'This is an open network — no password required.'
          : 'Enter the password for this network.'}
      </p>

      {!isOpen && (
        <>
          <label style={S.fieldLabel} htmlFor="wifi-password">Password</label>
          <input
            id="wifi-password"
            type={showPassword ? 'text' : 'password'}
            value={password}
            onChange={e => setPassword(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && connect()}
            onFocus={() => setFocused(true)}
            onBlur={() => setFocused(false)}
            placeholder="Enter WiFi password"
            autoComplete="current-password"
            autoFocus
            style={S.input(focused)}
          />
          <div style={S.showPassRow}>
            <input
              type="checkbox"
              id="show-password"
              checked={showPassword}
              onChange={e => setShowPassword(e.target.checked)}
              style={{ width: 14, height: 14, accentColor: '#0891b2' }}
            />
            <label htmlFor="show-password" style={S.showPassLabel}>Show password</label>
          </div>
        </>
      )}

      {error && <div style={S.errorBox}>{error}</div>}

      <div style={S.btnRow}>
        <button style={S.btnSecondary} onClick={onBack} disabled={busy}>Back</button>
        <button style={S.btnPrimary(busy)} onClick={connect} disabled={busy}>
          {busy ? 'Connecting\u2026' : 'Connect'}
        </button>
      </div>
    </div>
  );
}

// ── SuccessView ───────────────────────────────────────────────────────────────

function SuccessView({ ssid, onRegister }: { ssid: string; onRegister: () => void }) {
  return (
    <div style={S.successScreen}>
      <div style={S.successIcon}>
        <svg width="28" height="28" viewBox="0 0 24 24" fill="none"
          stroke="#16a34a" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
          <polyline points="20 6 9 17 4 12" />
        </svg>
      </div>
      <h2 style={S.successH2}>Connected!</h2>
      <p style={S.successP}>
        <strong style={{ color: '#475569' }}>{CONFIG.deviceName}</strong> is now connecting to
        &ldquo;{ssid}&rdquo;.
      </p>
      <p style={{ ...S.successP, marginTop: 16 }}>
        Enter the 7-digit code from your setup wizard to register this device to your account.
      </p>
      <div style={{ marginTop: 20, display: 'flex', flexDirection: 'column', gap: 8, alignItems: 'center' }}>
        <button style={{ ...S.btnPrimary(false), maxWidth: 240 }} onClick={onRegister}>
          Enter Claim Code
        </button>
        <button style={{ ...S.btnSecondary, maxWidth: 240 }} onClick={() => {}}>
          Skip for now
        </button>
      </div>
    </div>
  );
}

// ── ClaimView ─────────────────────────────────────────────────────────────────

function ClaimView() {
  const [code,    setCode]    = useState('');
  const [busy,    setBusy]    = useState(false);
  const [error,   setError]   = useState<string | null>(null);
  const [done,    setDone]    = useState(false);
  const [focused, setFocused] = useState(false);

  const submit = useCallback(async () => {
    const normalized = code.replace(/\s/g, '');
    if (!/^\d{7}$/.test(normalized)) {
      setError('Please enter the 7-digit code exactly as shown.');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const res  = await fetch('/api/claim-code', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ code: normalized }),
      });
      const data = await res.json() as { ok?: boolean; error?: string };
      if (data.ok) {
        setDone(true);
      } else {
        setError(data.error ?? 'Failed to save code. Please try again.');
        setBusy(false);
      }
    } catch {
      setError('Could not reach the device. Please try again.');
      setBusy(false);
    }
  }, [code]);

  if (done) {
    return (
      <div style={S.successScreen}>
        <div style={S.successIcon}>
          <svg width="28" height="28" viewBox="0 0 24 24" fill="none"
            stroke="#16a34a" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="20 6 9 17 4 12" />
          </svg>
        </div>
        <h2 style={S.successH2}>Code saved!</h2>
        <p style={S.successP}>
          Your device will automatically register to your account once it connects to the internet.
          You can close this page.
        </p>
      </div>
    );
  }

  return (
    <div style={S.connectForm}>
      <h2 style={S.h2}>Enter claim code</h2>
      <p style={S.formSub}>
        Enter the 7-digit code shown in your setup wizard on your computer or phone.
      </p>
      <label style={S.fieldLabel} htmlFor="claim-code">Claim code</label>
      <input
        id="claim-code"
        type="text"
        inputMode="numeric"
        pattern="[0-9 ]*"
        maxLength={8}
        value={code}
        onChange={e => setCode(e.target.value.replace(/[^0-9\s]/g, ''))}
        onKeyDown={e => e.key === 'Enter' && submit()}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        placeholder="e.g. 483 9271"
        autoFocus
        style={{ ...S.input(focused), ...S.codeDisplay, padding: '16px 0' }}
      />
      {error && <div style={S.errorBox}>{error}</div>}
      <div style={{ ...S.btnRow, marginTop: 16 }}>
        <button style={S.btnPrimary(busy)} onClick={submit} disabled={busy}>
          {busy ? 'Saving\u2026' : 'Register Device'}
        </button>
      </div>
    </div>
  );
}

// ── App ───────────────────────────────────────────────────────────────────────

function App() {
  const [view,     setView]     = useState<View>('scan');
  const [ssid,     setSsid]     = useState('');
  const [isOpen,   setIsOpen]   = useState(false);

  const handleSelect = (selectedSsid: string, open: boolean) => {
    setSsid(selectedSsid);
    setIsOpen(open);
    setView('connect');
  };

  const headerTitle = view === 'claim' ? 'Register Device' : 'Connect to WiFi';

  return (
    <div style={S.body}>
      <div style={S.card}>
        <div style={S.header}>
          <PortalLogo />
          <h1 style={S.h1}>{headerTitle}</h1>
          <p style={S.headerSub}>
            Select a network for{' '}
            <strong style={{ color: '#475569' }}>{CONFIG.deviceName}</strong>
          </p>
        </div>

        {view === 'scan'    && <ScanView onSelect={handleSelect} />}
        {view === 'connect' && (
          <ConnectView
            ssid={ssid}
            isOpen={isOpen}
            onBack={() => setView('scan')}
            onSuccess={() => setView('success')}
          />
        )}
        {view === 'success' && (
          <SuccessView ssid={ssid} onRegister={() => setView('claim')} />
        )}
        {view === 'claim' && <ClaimView />}
      </div>
    </div>
  );
}

// ── Mount ─────────────────────────────────────────────────────────────────────

ReactDOM.render(<App />, document.getElementById('root'));
