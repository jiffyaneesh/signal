-- Signal — user search.
-- Problem: no way to find people by username. The users table is RLS self-only,
-- so a client-side filter can't scan other users, and the public_usernames view
-- has no index tuned for prefix matching.
--
-- Fix: a single security-definer RPC, `search_users(q, lim)`, that does a
-- case-insensitive PREFIX match on username and returns at most `lim` rows
-- (server-capped). It excludes the caller and anyone in a block relationship
-- with the caller (either direction), so blocked users never surface in search.
-- The client only decorates the result with follow state.
--
-- Security notes:
--   * SECURITY DEFINER — needed to read other users' rows, but the function
--     exposes ONLY (id, username): the same columns public_usernames already
--     grants. No email, no auth data.
--   * `q` is treated as a LITERAL prefix: %, _ and \ are escaped before being
--     spliced into LIKE, so a user typing "%" can't turn the query into a full
--     table scan / wildcard match.
--   * search_path pinned to public — SECURITY DEFINER functions must never
--     resolve unqualified names against a caller-controlled search_path.
--
-- Performance: a case-insensitive prefix index on username makes
-- `lower(username) LIKE 'abc%'` an index range scan, not a seq scan. The
-- text_pattern_ops opclass is what lets LIKE with a left-anchored pattern use
-- the btree.
--
-- Run in the Supabase SQL editor (or `supabase db push`). Idempotent.

-- ─────────────────────────────────────────────────────────────
-- Prefix-search index
-- ─────────────────────────────────────────────────────────────

create index if not exists users_username_lower_prefix_idx
  on public.users (lower(username) text_pattern_ops);

-- ─────────────────────────────────────────────────────────────
-- search_users(q, lim)
-- ─────────────────────────────────────────────────────────────

create or replace function public.search_users(q text, lim integer default 20)
returns table (id uuid, username text)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  raw text;      -- normalized query, unescaped (for exact-match ranking)
  needle text;   -- escaped LIKE prefix pattern
  capped int;
begin
  -- Normalize + guard the query. Empty/whitespace → no rows (avoid scanning the
  -- whole table for a bare wildcard).
  raw := lower(btrim(coalesce(q, '')));
  if length(raw) = 0 then
    return;
  end if;

  -- Escape LIKE metacharacters so the input is a literal prefix, then anchor it.
  needle := replace(raw, '\', '\\');
  needle := replace(needle, '%', '\%');
  needle := replace(needle, '_', '\_');
  needle := needle || '%';

  -- Clamp the page size server-side: callers can ask for less, never more.
  capped := least(greatest(coalesce(lim, 20), 1), 30);

  return query
    select u.id, u.username
    from public.users u
    where lower(u.username) like needle escape '\'
      and u.id <> auth.uid()
      -- Exclude any block relationship in either direction with the caller.
      and not exists (
        select 1 from public.blocks b
        where (b.blocker_id = auth.uid() and b.blocked_id = u.id)
           or (b.blocker_id = u.id and b.blocked_id = auth.uid())
      )
    order by
      -- Exact match first, then shortest (closest) usernames, then alpha.
      (lower(u.username) = raw) desc,
      length(u.username) asc,
      u.username asc
    limit capped;
end;
$$;

grant execute on function public.search_users(text, integer) to authenticated;
