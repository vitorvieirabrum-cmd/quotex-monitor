create table if not exists public.quotex_assets (
  symbol text primary key,
  is_otc boolean not null default false,
  change_24h numeric,
  payout_1m numeric,
  payout_5m numeric,
  active boolean not null default true,
  updated_at timestamptz not null default now()
);

create index if not exists quotex_assets_updated_at_idx
  on public.quotex_assets (updated_at desc);
