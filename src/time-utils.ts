export function toEpochSeconds(msEpoch: number): number {
  // integer seconds, as KV APIs typically use
  return Math.floor(msEpoch / 1000);
}

export function fromEpochSeconds(sec: number): number {
  return Math.floor(sec * 1000);
}

export function nowMs(): number {
  return Date.now();
}
