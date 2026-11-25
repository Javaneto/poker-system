-- Rodar uma vez no Supabase: SQL Editor > New query > colar > Run.
--
-- SEGURANÇA: fecha as tabelas antigas para quem não está logado.
--
-- Antes deste arquivo, qualquer pessoa com a chave pública do site (ela fica
-- no código das páginas, é pública por natureza) conseguia ler e alterar
-- jogadores (CPF, telefone), movimentações, torneios e configurações direto
-- pela API, sem login. As tabelas do Ranking (004) e do Log (002) já eram
-- fechadas; aqui as demais passam a seguir a mesma regra:
--   só usuários logados leem e alteram.
--
-- Todas as telas do sistema já exigem login, então nada muda para quem usa.
-- O Ranking público continua funcionando: ele não lê tabelas, só chama a
-- função ranking_publico (sql/006), que devolve apenas o placar.

do $$
declare
  t text;
  p record;
begin
  foreach t in array array[
    'jogadores', 'movimentacoes', 'torneios', 'torneio_valores',
    'configuracoes', 'premiacao_estruturas', 'estruturas_blinds'
  ] loop
    execute format('alter table public.%I enable row level security', t);

    -- Remove regras antigas (podiam liberar acesso sem login).
    for p in select policyname from pg_policies where schemaname = 'public' and tablename = t loop
      execute format('drop policy %I on public.%I', p.policyname, t);
    end loop;

    execute format('create policy "acesso autenticados" on public.%I for all to authenticated using (true) with check (true)', t);
  end loop;
end $$;

notify pgrst, 'reload schema';
