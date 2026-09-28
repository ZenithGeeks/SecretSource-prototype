-- A read-only role for the Grafana on ss-core: it reads finished and running analyses to chart
-- success rate, duration and verdicts. It can read public.analyses and public.sources and
-- nothing else (no auth, teacher, project or preference data).
--
-- Created without a login. The login and its password are set by hand, never in git:
--   alter role grafana_ro with login password '...';
-- The password is kept only in ss-core's .env as GRAFANA_DB_PASSWORD.

do $$
begin
  if not exists (select from pg_roles where rolname = 'grafana_ro') then
    create role grafana_ro nologin;
  end if;
end
$$;

grant usage on schema public to grafana_ro;
grant select on public.analyses, public.sources to grafana_ro;

-- Both tables have RLS on with no policies, which hides every row from any role that does not
-- bypass RLS. These policies let grafana_ro read, and only read.
drop policy if exists grafana_ro_read on public.analyses;
create policy grafana_ro_read on public.analyses for select to grafana_ro using (true);
drop policy if exists grafana_ro_read on public.sources;
create policy grafana_ro_read on public.sources for select to grafana_ro using (true);
