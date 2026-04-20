import React, { useState } from 'react';
import styled, { keyframes } from 'styled-components';

const T = {
  bgBase: '#0f1117',
  bgCard: '#111827',
  border: '#2d3748',
  borderFaint: '#1e293b',
  text: '#e2e8f0',
  textMuted: '#94a3b8',
  textDim: '#64748b',
  accent: '#7c3aed',
  red: '#ef4444',
} as const;

const fadeIn = keyframes`
  from { opacity: 0; transform: translateY(18px); }
  to { opacity: 1; transform: translateY(0); }
`;

const spin = keyframes`
  to { transform: rotate(360deg); }
`;

const Shell = styled.div`
  min-height: 100vh;
  display: grid;
  place-items: center;
  padding: 24px;
  background: linear-gradient(135deg, #0f1117 0%, #1a1f2e 100%);
  color: ${T.text};
`;

const Card = styled.div`
  width: min(440px, 100%);
  background: ${T.bgCard};
  border: 1px solid ${T.border};
  border-radius: 16px;
  padding: 36px;
  box-shadow: 0 20px 60px rgba(0, 0, 0, 0.32);
  animation: ${fadeIn} 220ms ease-out;
`;

const Header = styled.header`
  margin-bottom: 24px;
  text-align: center;
`;

const Mark = styled.div`
  color: ${T.accent};
  font-size: 28px;
  font-weight: 800;
  letter-spacing: 0.08em;
  margin-bottom: 10px;
`;

const Title = styled.h1`
  margin: 0 0 6px;
  font-size: 20px;
  font-weight: 700;
`;

const Subtitle = styled.p`
  margin: 0;
  color: ${T.textMuted};
  font-size: 13px;
  line-height: 1.45;
`;

const Form = styled.form`
  display: grid;
  gap: 16px;
`;

const Field = styled.label`
  display: grid;
  gap: 6px;
  font-size: 12px;
  font-weight: 600;
`;

const Input = styled.input`
  background: #1e293b;
  border: 1px solid ${T.border};
  border-radius: 10px;
  padding: 11px 12px;
  color: ${T.text};
  font-size: 14px;
  outline: none;

  &:focus {
    border-color: ${T.accent};
  }

  &::placeholder {
    color: ${T.textDim};
  }
`;

const Alert = styled.div<{ $tone?: 'error' | 'info' }>`
  display: flex;
  align-items: center;
  gap: 8px;
  border-radius: 10px;
  padding: 10px 12px;
  font-size: 12px;
  line-height: 1.4;
  border: 1px solid ${({ $tone }) => ($tone === 'info' ? 'rgba(16, 185, 129, 0.25)' : 'rgba(239, 68, 68, 0.2)')};
  background: ${({ $tone }) => ($tone === 'info' ? 'rgba(16, 185, 129, 0.1)' : 'rgba(239, 68, 68, 0.1)')};
  color: ${({ $tone }) => ($tone === 'info' ? '#10b981' : T.red)};
`;

const Button = styled.button<{ $loading?: boolean }>`
  border: none;
  border-radius: 10px;
  padding: 12px 14px;
  background: ${T.accent};
  color: white;
  font-weight: 700;
  font-size: 14px;
  cursor: ${({ $loading }) => ($loading ? 'not-allowed' : 'pointer')};
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  opacity: ${({ $loading }) => ($loading ? 0.8 : 1)};
`;

const Spinner = styled.span`
  width: 14px;
  height: 14px;
  border-radius: 50%;
  border: 2px solid rgba(255, 255, 255, 0.35);
  border-top-color: white;
  animation: ${spin} 800ms linear infinite;
`;

const Footer = styled.footer`
  margin-top: 18px;
  padding-top: 18px;
  border-top: 1px solid ${T.borderFaint};
  color: ${T.textDim};
  font-size: 11px;
  text-align: center;
`;

export interface AuthScreenProps {
  onLogin: (identifier: string, password: string) => Promise<void>;
}

export function AuthScreen({ onLogin }: AuthScreenProps) {
  const [identifier, setIdentifier] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setError('');

    if (!identifier.trim()) {
      setError('Email or username is required');
      return;
    }

    if (!password) {
      setError('Password is required');
      return;
    }

    setLoading(true);
    try {
      await onLogin(identifier.trim(), password);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to sign in');
    } finally {
      setLoading(false);
    }
  };

  return (
    <Shell>
      <Card>
        <Header>
          <Mark>⬡ OROBOT</Mark>
          <Title>Simulator Sign In</Title>
          <Subtitle>Use your robots-gateway account to unlock the simulator dashboard.</Subtitle>
        </Header>

        <Form onSubmit={submit}>
          <Field>
            Email or username
            <Input
              type="text"
              placeholder="you@example.com or handle"
              value={identifier}
              onChange={(e) => setIdentifier(e.target.value)}
              disabled={loading}
              autoComplete="username"
              required
            />
          </Field>

          <Field>
            Password
            <Input
              type="password"
              placeholder="••••••••"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              disabled={loading}
              autoComplete="current-password"
              required
            />
          </Field>

          {error && <Alert $tone="error">{error}</Alert>}

          <Button type="submit" disabled={loading} $loading={loading}>
            {loading && <Spinner />}
            Sign In
          </Button>
        </Form>

        <Footer>Auth is proxied through robots-gateway using the current local or production URL.</Footer>
      </Card>
    </Shell>
  );
}
