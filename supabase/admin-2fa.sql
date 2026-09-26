-- =====================================================================
-- God Seven Line — exigir o código da app de autenticação no /admin (verificação em dois passos)
--
-- Para bases de dados já criadas com uma versão anterior de schema.sql (a versão atual já o inclui).
-- Como usar: Supabase → SQL Editor → New query → colar este ficheiro → Run. Pode ser corrido mais do que uma vez.
--
-- IMPORTANTE — ordem certa:
--   1. Entra primeiro no /admin (versão nova) e ativa a verificação em dois passos com a app do telemóvel.
--   2. Só depois corre este ficheiro. A partir daí, sem o código (sessão aal2) o Supabase recusa ler pedidos,
--      alterar produtos, stock ou imagens, mesmo a quem saiba a palavra-passe.
-- Para desfazer (ex.: perdeste o telemóvel e ainda não removeste o fator), ver docs/SETUP.md → "Perdi o telemóvel".
-- =====================================================================

begin;

create or replace function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(auth.jwt() ->> 'aal', '') = 'aal2'
     and exists (select 1 from public.admin_users where user_id = auth.uid());
$$;

revoke all on function public.is_admin() from public;
grant execute on function public.is_admin() to anon, authenticated;

commit;
