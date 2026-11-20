export type ErrorCode = 'INVALID_ARGUMENT' | 'LOGIN_REQUIRED' | 'VERIFICATION_REQUIRED' | 'RATE_LIMITED' | 'UPSTREAM_ERROR' | 'UPSTREAM_SCHEMA_CHANGED' | 'CAPABILITY_UNVERIFIED' | 'NETWORK_ERROR';
export class PiggyError extends Error {
  constructor(public readonly code: ErrorCode, message: string) { super(message); }
}
export function exitCode(code: ErrorCode): number {
  return code === 'INVALID_ARGUMENT' ? 2 : code === 'LOGIN_REQUIRED' ? 3 : code === 'VERIFICATION_REQUIRED' ? 4 : code === 'RATE_LIMITED' ? 5 : code === 'CAPABILITY_UNVERIFIED' ? 6 : 1;
}
