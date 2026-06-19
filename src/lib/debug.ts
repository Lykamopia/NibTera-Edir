/** Lightweight debug logger, gated by NIB_DEBUG / NODE_ENV. */
const enabled = process.env.NIB_DEBUG === 'true' || process.env.NODE_ENV !== 'production';

export function debugLog(...args: any[]) {
  if (enabled) console.log(...args);
}
