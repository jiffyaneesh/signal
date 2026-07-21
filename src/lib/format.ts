// Pure formatting/ordering helpers — no I/O, no supabase, safe to unit-test.

// Format a clip length (seconds) as m:ss. Handles durations over 59s rather
// than hardcoding the minute to 0 (e.g. 75 → "1:15", 9 → "0:09").
export function formatDuration(sec: number): string {
  const total = Math.max(0, Math.floor(sec));
  const m = Math.floor(total / 60);
  const rem = total % 60;
  return `${m}:${rem < 10 ? '0' : ''}${rem}`;
}

// Canonical unordered-pair ordering: conversations store user_a < user_b so a
// pair maps to exactly one row (see migration 0019). Mirror it client-side so
// lookups/inserts resolve the same row from either side.
export function canonicalPair(u1: string, u2: string): { user_a: string; user_b: string } {
  return u1 < u2 ? { user_a: u1, user_b: u2 } : { user_a: u2, user_b: u1 };
}
