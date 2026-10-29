-- Paiements MoniSaaS via SasPay. Suppose public.profiles(id uuid, role text: client|admin|superadmin).
create table if not exists public.plans (
  id text primary key, name text not null,
  price_monthly numeric(12,2) not null, price_annual numeric(12,2),
  currency text not null default 'USD', active boolean not null default true
);

-- Réglages SasPay : ligne unique, secrets chiffrés (AES-256-GCM côté serveur). Aucune policy = inaccessible aux clients.
create table if not exists public.payment_settings (
  id int primary key check (id = 1),
  api_key_enc text, api_key_last4 text, api_mode text check (api_mode in ('test','live')),
  webhook_secret_enc text, webhook_secret_last4 text,
  enabled boolean not null default false,
  fee_charge_mode text not null default 'ADD_ON' check (fee_charge_mode in ('ADD_ON','DEDUCTED')),
  updated_by uuid references auth.users(id), updated_at timestamptz not null default now()
);
insert into public.payment_settings (id) values (1) on conflict do nothing;

create table if not exists public.payments (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id),
  plan_id text not null references public.plans(id),
  period text not null check (period in ('monthly','annual')),
  amount numeric(14,2) not null, currency text not null,
  status text not null default 'PENDING' check (status in ('PENDING','SUCCESS','FAILED','EXPIRED')),
  provider_payment_id text unique,
  idempotency_key uuid not null unique default gen_random_uuid(),
  net_amount numeric(14,2), delivered_at timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists payments_pending_idx on public.payments (created_at) where status = 'PENDING';

create table if not exists public.subscriptions (
  user_id uuid primary key references auth.users(id),
  plan_id text not null references public.plans(id),
  status text not null default 'active', current_period_end timestamptz not null
);

create table if not exists public.audit_logs (
  id bigserial primary key, actor_id uuid, action text not null, meta jsonb, created_at timestamptz not null default now()
);

alter table public.plans enable row level security;
alter table public.payment_settings enable row level security;
alter table public.payments enable row level security;
alter table public.subscriptions enable row level security;
alter table public.audit_logs enable row level security;
create policy plans_read on public.plans for select to authenticated using (active);
create policy payments_own on public.payments for select to authenticated using (user_id = auth.uid());
create policy subs_own on public.subscriptions for select to authenticated using (user_id = auth.uid());

-- Livraison unique et atomique : un seul appelant "gagne" le paiement, l'abonnement est activé dans la même transaction.
create or replace function public.activate_payment(p_id uuid, p_net numeric) returns boolean
language plpgsql security definer set search_path = public as $$
declare p public.payments%rowtype; n_days int;
begin
  update payments set status = 'SUCCESS', net_amount = p_net, delivered_at = now()
   where id = p_id and delivered_at is null returning * into p;
  if not found then return false; end if;
  n_days := case p.period when 'annual' then 365 else 30 end;
  insert into subscriptions (user_id, plan_id, status, current_period_end)
  values (p.user_id, p.plan_id, 'active', now() + make_interval(days => n_days))
  on conflict (user_id) do update set plan_id = excluded.plan_id, status = 'active',
    current_period_end = greatest(subscriptions.current_period_end, now()) + make_interval(days => n_days);
  return true;
end $$;
revoke all on function public.activate_payment(uuid, numeric) from public, anon, authenticated;
