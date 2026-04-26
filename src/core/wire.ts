/**
 * Outbound wire contract for `network:send` bus events.
 *
 * The gateway parses every envelope assuming `data` is a string — when a
 * handler accidentally emits an object (the historical `share-wifi` bug)
 * the firmware looks healthy but the gateway-side parse silently drops
 * the message. Encoding the contract in the type instead of in CLAUDE.md
 * prose makes that regression class unrepresentable: a non-string `data`
 * argument now fails `tsc`, and `makeEnvelope()` stringifies anything
 * non-string the caller passes by accident.
 *
 * `level` / `text` are kept as optional named fields because the existing
 * `device-log` payload predates the contract and the gateway tolerates
 * the extras — folding them into `data` would be a wire change.
 */
export type OutboundEnvelope = {
  type:        string;
  deviceUuid?: string;
  userUuid?:   string;
  ackId?:      string;
  data?:       string;
  level?:      'log' | 'warn' | 'error';
  text?:       string;
};

/**
 * Build an `OutboundEnvelope` while normalizing `data` to a string. Pass an
 * object and it gets `JSON.stringify`-ed; pass a string and it passes through;
 * omit it and `data` is omitted from the envelope.
 */
export function makeEnvelope(
  type:   string,
  fields: Omit<OutboundEnvelope, 'type' | 'data'> & { data?: unknown } = {},
): OutboundEnvelope {
  const { data, ...rest } = fields;
  const env: OutboundEnvelope = { type, ...rest };
  if (data !== undefined) {
    env.data = typeof data === 'string' ? data : JSON.stringify(data);
  }
  return env;
}
