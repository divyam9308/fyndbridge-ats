create table if not exists user_preferences (
  id uuid primary key default gen_random_uuid(),
  user_id text not null,
  preference_key text not null,
  value jsonb not null,
  updated_at timestamptz not null default now(),
  unique (user_id, preference_key)
);
