-- Plateforme MoniSaaS : maintenance, moniteurs, incidents, KPI, expiration automatique.
create table if not exists public.profiles (id uuid primary key references auth.users(id) on delete cascade, role text not null default 'client' check (role in ('client','admin','superadmin')), full_name text, onboarded boolean not null default false);
alter table public.profiles enable row level security;
create policy profiles_own on public.profiles for select to authenticated using (id = auth.uid());
revoke update on public.profiles from authenticated;           -- un client ne peut pas se promouvoir
grant update (full_name, onboarded) on public.profiles to authenticated;
create policy profiles_upd on public.profiles for update to authenticated using (id = auth.uid());
create or replace function public.handle_new_user() returns trigger language plpgsql security definer set search_path = public as $$
begin insert into profiles (id, full_name) values (new.id, new.raw_user_meta_data->>'full_name') on conflict do nothing; return new; end $$;
drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created after insert on auth.users for each row execute function public.handle_new_user();

create or replace function public.is_superadmin() returns boolean language sql stable security definer set search_path = public as
$$ select exists (select 1 from profiles where id = auth.uid() and role = 'superadmin') $$;

-- Offres : standard / business / sur mesure (sur demande, hors table plans)
alter table public.plans add column if not exists kind text not null default 'standard' check (kind in ('standard','business'));
alter table public.plans add column if not exists max_monitors int not null default 5;
alter table public.plans add column if not exists interval_seconds int not null default 60;
insert into public.plans (id, name, price_monthly, currency, kind, max_monitors, interval_seconds) values
 ('starter','Starter',10,'USD','standard',5,60), ('pro','Professional',25,'USD','standard',20,30), ('business','Business',49,'USD','business',75,15)
 on conflict (id) do nothing;
create policy plans_public on public.plans for select to anon using (active);

create table if not exists public.app_settings (id int primary key check (id = 1), maintenance boolean not null default false, maintenance_message text, maintenance_eta timestamptz, worker_seen_at timestamptz);
insert into public.app_settings (id) values (1) on conflict do nothing;
alter table public.app_settings enable row level security;
create policy app_read on public.app_settings for select to anon, authenticated using (true);
create policy app_write on public.app_settings for update to authenticated using (is_superadmin()) with check (is_superadmin());

create table if not exists public.monitors (
  id uuid primary key default gen_random_uuid(), user_id uuid not null references auth.users(id) on delete cascade,
  name text not null, url text not null check (url ~* '^https?://'),
  status text not null default 'pending' check (status in ('pending','up','down')),
  fail_count int not null default 0, last_checked_at timestamptz, last_response_ms int, last_error text,
  active boolean not null default true, created_at timestamptz not null default now());
create table if not exists public.monitor_checks (id bigserial primary key, monitor_id uuid not null references public.monitors(id) on delete cascade, ok boolean not null, http_status int, response_ms int, error text, checked_at timestamptz not null default now());
create index if not exists checks_idx on public.monitor_checks (monitor_id, checked_at desc);
create table if not exists public.incidents (id bigserial primary key, monitor_id uuid not null references public.monitors(id) on delete cascade, user_id uuid not null, opened_at timestamptz not null default now(), resolved_at timestamptz, last_error text);
create table if not exists public.notifications (id bigserial primary key, user_id uuid not null, title text not null, body text, read boolean not null default false, created_at timestamptz not null default now());
create table if not exists public.quote_requests (id bigserial primary key, user_id uuid not null default auth.uid(), company text, need text, contact text, created_at timestamptz not null default now());

alter table public.monitors enable row level security; alter table public.monitor_checks enable row level security;
alter table public.incidents enable row level security; alter table public.notifications enable row level security; alter table public.quote_requests enable row level security;
create policy mon_sel on public.monitors for select to authenticated using (user_id = auth.uid());
create policy mon_ins on public.monitors for insert to authenticated with check (user_id = auth.uid());
create policy mon_del on public.monitors for delete to authenticated using (user_id = auth.uid());
create policy chk_sel on public.monitor_checks for select to authenticated using (exists (select 1 from monitors m where m.id = monitor_id and m.user_id = auth.uid()));
create policy inc_sel on public.incidents for select to authenticated using (user_id = auth.uid());
create policy not_sel on public.notifications for select to authenticated using (user_id = auth.uid());
create policy not_upd on public.notifications for update to authenticated using (user_id = auth.uid());
create policy quo_ins on public.quote_requests for insert to authenticated with check (user_id = auth.uid());
create policy quo_adm on public.quote_requests for select to authenticated using (is_superadmin());
create policy pay_adm on public.payments for select to authenticated using (is_superadmin());

-- Quota appliqué côté base : sans abonnement actif = 1 moniteur (valeur modifiable ici).
create or replace function public.enforce_monitor_limit() returns trigger language plpgsql security definer set search_path = public as $$
declare lim int;
begin
  select coalesce((select p.max_monitors from subscriptions s join plans p on p.id = s.plan_id where s.user_id = new.user_id and s.status = 'active' and s.current_period_end > now()), 1) into lim;
  if (select count(*) from monitors where user_id = new.user_id) >= lim then raise exception 'monitor_limit_reached'; end if;
  return new;
end $$;
drop trigger if exists monitors_limit on public.monitors;
create trigger monitors_limit before insert on public.monitors for each row execute function public.enforce_monitor_limit();

create or replace function public.client_kpis() returns json language sql stable as $$
 select json_build_object(
  'monitors', (select count(*) from monitors where user_id = auth.uid()),
  'up', (select count(*) from monitors where user_id = auth.uid() and status = 'up'),
  'down', (select count(*) from monitors where user_id = auth.uid() and status = 'down'),
  'open_incidents', (select count(*) from incidents where user_id = auth.uid() and resolved_at is null),
  'uptime_24h', (select round(100.0 * avg(c.ok::int), 2) from monitor_checks c join monitors m on m.id = c.monitor_id where m.user_id = auth.uid() and c.checked_at > now() - interval '24 hours'),
  'avg_ms_24h', (select round(avg(c.response_ms)) from monitor_checks c join monitors m on m.id = c.monitor_id where m.user_id = auth.uid() and c.ok and c.checked_at > now() - interval '24 hours')) $$;

create or replace function public.admin_kpis() returns json language plpgsql stable security definer set search_path = public as $$
begin
  if not is_superadmin() then raise exception 'forbidden'; end if;
  return json_build_object(
   'users', (select count(*) from profiles),
   'active_subs', (select count(*) from subscriptions where status = 'active' and current_period_end > now()),
   'expiring_7d', (select count(*) from subscriptions where status = 'active' and current_period_end between now() and now() + interval '7 days'),
   'revenue', (select coalesce(json_object_agg(currency, t), '{}'::json) from (select currency, sum(amount) t from payments where status = 'SUCCESS' group by currency) x),
   'payments_success', (select count(*) from payments where status = 'SUCCESS'),
   'payments_pending', (select count(*) from payments where status = 'PENDING'),
   'payments_failed', (select count(*) from payments where status = 'FAILED'),
   'monitors', (select count(*) from monitors), 'monitors_down', (select count(*) from monitors where status = 'down'),
   'open_incidents', (select count(*) from incidents where resolved_at is null));
end $$;
revoke all on function public.admin_kpis() from public, anon;
grant execute on function public.admin_kpis() to authenticated;
grant execute on function public.client_kpis() to authenticated;

-- Fin d'abonnement : coupure automatique + nettoyage (activer l'extension pg_cron dans Supabase > Database > Extensions).
-- L'application vérifie aussi current_period_end > now(), donc l'accès est coupé même si le cron a du retard.
create extension if not exists pg_cron;
select cron.schedule('expire-subscriptions', '*/15 * * * *', $$update public.subscriptions set status = 'expired' where status = 'active' and current_period_end < now()$$);
select cron.schedule('purge-checks', '0 3 * * *', $$delete from public.monitor_checks where checked_at < now() - interval '30 days'$$);
