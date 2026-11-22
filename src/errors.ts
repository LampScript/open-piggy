export type ErrorCode = 'ACCESS_DENIED' | 'PAGE_NOT_READY' | 'INVALID_ARGUMENT' | 'LOGIN_REQUIRED' | 'VERIFICATION_REQUIRED' | 'RATE_LIMITED' | 'UPSTREAM_ERROR' | 'UPSTREAM_SCHEMA_CHANGED' | 'CAPABILITY_UNVERIFIED' | 'NETWORK_ERROR' | 'BROWSER_RUNTIME_NOT_INSTALLED' | 'BROWSER_NOT_INSTALLED' | 'BROWSER_SYSTEM_DEPENDENCIES' | 'BROWSER_UNSUPPORTED_RUNTIME' | 'BROWSER_DISPLAY_REQUIRED';
export class PiggyError extends Error {
  constructor(public readonly code: ErrorCode, message: string, public readonly context?: {httpStatus?:number;stage?:string | undefined}) { super(message); }
}
export function exitCode(code: ErrorCode): number {
  if(code.startsWith('BROWSER_'))return 7;
  return code === 'INVALID_ARGUMENT' ? 2 : code === 'LOGIN_REQUIRED' ? 3 : code === 'VERIFICATION_REQUIRED' ? 4 : code === 'RATE_LIMITED' ? 5 : code === 'CAPABILITY_UNVERIFIED' ? 6 : 1;
}
