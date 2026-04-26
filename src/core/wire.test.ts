import { describe, it, expect } from 'vitest';
import { makeEnvelope } from './wire';

describe('makeEnvelope', () => {
  it('passes a string `data` through unchanged', () => {
    expect(makeEnvelope('x', { data: 'hello' })).toEqual({ type: 'x', data: 'hello' });
  });

  it('JSON.stringifies a non-string `data` (the share-wifi regression class)', () => {
    const env = makeEnvelope('share-wifi', { data: { ssid: 'home', password: 'pw' } });
    expect(env.data).toBe('{"ssid":"home","password":"pw"}');
    expect(typeof env.data).toBe('string');
  });

  it('omits `data` from the envelope when not passed', () => {
    const env = makeEnvelope('message-ack', { ackId: 'a-1' });
    expect(env).toEqual({ type: 'message-ack', ackId: 'a-1' });
    expect('data' in env).toBe(false);
  });

  it('preserves deviceUuid / userUuid / ackId / level / text', () => {
    expect(makeEnvelope('device-log', {
      deviceUuid: 'dev', userUuid: 'usr', ackId: 'a', level: 'log', text: 't',
    })).toEqual({
      type: 'device-log', deviceUuid: 'dev', userUuid: 'usr', ackId: 'a', level: 'log', text: 't',
    });
  });

  it('JSON.stringifies arrays passed as data', () => {
    expect(makeEnvelope('list', { data: [1, 2, 3] }).data).toBe('[1,2,3]');
  });
});
