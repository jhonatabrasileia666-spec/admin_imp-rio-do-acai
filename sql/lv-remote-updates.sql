-- Delivery LV: controle remoto de atualização; não altera pedidos ou acessos.
-- A autenticação existente usa sessões privadas via x-panel-session, não Supabase Auth.
begin;
create table public.lv_app_releases (
  app text primary key check (app in ('menu','admin')),
  revision uuid,
  requested_at timestamptz
);
alter table public.lv_app_releases enable row level security;
revoke all on public.lv_app_releases from public, anon, authenticated;
grant select on public.lv_app_releases to anon, authenticated;
create policy lv_releases_read on public.lv_app_releases for select to anon, authenticated using (true);
insert into public.lv_app_releases(app) values ('menu'),('admin');

create function lv_private.force_app_update(p_target text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  account uuid := lv_private.panel_account_id();
  next_revision uuid := gen_random_uuid();
  changed jsonb;
begin
  if account is null or not exists (
    select 1 from lv_private.panel_accounts a where a.id=account and a.active and a.role='superadmin'
  ) then
    raise exception 'Somente o super admin pode forçar uma atualização.' using errcode='42501';
  end if;
  if p_target is null or p_target not in ('menu','admin','both') then
    raise exception 'Destino de atualização inválido.' using errcode='22023';
  end if;
  -- Ordem consistente de bloqueio, inclusive em comandos simultâneos para os dois sites.
  perform 1 from public.lv_app_releases where p_target='both' or app=p_target order by app for update;
  with updated as (
    update public.lv_app_releases set revision=next_revision,requested_at=clock_timestamp()
    where p_target='both' or app=p_target
    returning app,revision,requested_at
  ) select jsonb_agg(to_jsonb(updated)) into changed from updated;
  return jsonb_build_object('ok',true,'releases',changed);
end;
$$;
revoke all on function lv_private.force_app_update(text) from public, anon, authenticated;
grant execute on function lv_private.force_app_update(text) to anon, authenticated;

create function public.lv_force_app_update(p_target text)
returns jsonb language sql security invoker set search_path = '' as $$
  select lv_private.force_app_update(p_target);
$$;
revoke all on function public.lv_force_app_update(text) from public, anon, authenticated;
grant execute on function public.lv_force_app_update(text) to anon, authenticated;
comment on function public.lv_force_app_update(text) is 'Sessão x-panel-session validada no servidor; exclusivo de superadmin. Destinos menu/admin/both.';
notify pgrst, 'reload schema';
commit;
