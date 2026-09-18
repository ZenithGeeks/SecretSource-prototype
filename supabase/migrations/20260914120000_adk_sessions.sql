-- ADK chat-session persistence lives in its own `adk` schema, separate from `public`, so
-- Supabase's REST API (which only serves `public`) can never expose conversations. The chat
-- agents (backend/app/sessions.py) connect with SESSION_DB_URL / DIRECT_URL and let
-- google-adk's DatabaseSessionService create its own tables — sessions, events, app_states,
-- user_states, adk_internal_metadata — inside this schema on first use. Their columns come
-- from the installed google-adk version, so we do NOT define them here.
--
-- sessions.py already runs `create schema if not exists adk` on connect. This migration exists
-- so the schema is also there for a migrations-only setup (`supabase db push` before the
-- backend has ever run) and, more importantly, so the "browsers get nothing" guarantee is
-- enforced by the database, not just by convention: without USAGE on the schema, the anon and
-- authenticated roles cannot reach any table ADK later creates in it.
create schema if not exists adk;

revoke all on schema adk from anon, authenticated;
alter default privileges in schema adk revoke all on tables from anon, authenticated;
