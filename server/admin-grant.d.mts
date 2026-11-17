/** Types for `admin-api.mjs` (the Admin Tool's server rules). */
export declare const ADMIN_BOSS_SPECIES: ReadonlySet<number>;
export declare function adminRoute(
  role: string | undefined,
  rest: readonly string[],
  method: string,
  body: unknown,
): { status: number; body: Record<string, unknown> };
export declare function normalizeAdminGrant(body: unknown): Record<string, unknown> | null;
