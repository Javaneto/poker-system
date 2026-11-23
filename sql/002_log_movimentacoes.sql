-- Rodar uma vez no Supabase: SQL Editor > New query > colar > Run.
--
-- Log automático (auditoria) de tudo que acontece em movimentacoes e
-- jogadores: inclusão, alteração e exclusão (Desfazer), com quem fez e
-- quando. É gravado pelo próprio banco, então vale para qualquer página
-- e não depende do navegador. Usado pela aba "Log" e pelo botão
-- "Restaurar" do Histórico/Log.

create table if not exists public.log_alteracoes (
  id          bigint generated always as identity primary key,
  tabela      text        not null,
  operacao    text        not null,          -- INSERT | UPDATE | DELETE
  registro_id text,
  dados_antes jsonb,
  dados_depois jsonb,
  usuario_email text,
  criado_em   timestamptz not null default now()
);

create index if not exists log_alteracoes_criado_em_idx
  on public.log_alteracoes (criado_em desc);

create index if not exists log_alteracoes_registro_idx
  on public.log_alteracoes (tabela, registro_id);

create or replace function public.registrar_log_alteracao()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.log_alteracoes
    (tabela, operacao, registro_id, dados_antes, dados_depois, usuario_email)
  values (
    tg_table_name,
    tg_op,
    coalesce(to_jsonb(new) ->> 'id', to_jsonb(old) ->> 'id'),
    case when tg_op in ('UPDATE', 'DELETE') then to_jsonb(old) end,
    case when tg_op in ('INSERT', 'UPDATE') then to_jsonb(new) end,
    auth.jwt() ->> 'email'
  );
  return coalesce(new, old);
end;
$$;

drop trigger if exists log_movimentacoes on public.movimentacoes;
create trigger log_movimentacoes
  after insert or update or delete on public.movimentacoes
  for each row execute function public.registrar_log_alteracao();

drop trigger if exists log_jogadores on public.jogadores;
create trigger log_jogadores
  after insert or update or delete on public.jogadores
  for each row execute function public.registrar_log_alteracao();

-- Só usuários logados leem o log; ninguém altera nem apaga pelo site
-- (o log é gravado só pelo gatilho acima).
alter table public.log_alteracoes enable row level security;

drop policy if exists "log leitura autenticados" on public.log_alteracoes;
create policy "log leitura autenticados"
  on public.log_alteracoes for select
  to authenticated
  using (true);
