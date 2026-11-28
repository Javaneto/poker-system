-- Rodar uma vez no Supabase: SQL Editor > New query > colar > Run.
--
-- Filtro Cash / Torneio no Histórico de Movimentações (Relatório).
-- Recria a visão relatorio_sessoes (sql/017) com as MESMAS colunas e contas,
-- e acrescenta no fim duas colunas:
--   tem_cash    = a sessão tem algum lançamento de cash (não é pagamento e
--                 não tem torneio_id — mesma regra da página Em Aberto)
--   tem_torneio = a sessão tem algum lançamento com torneio_id
-- Não altera nenhum dado. Pode ser rodado de novo.
-- Antes de rodar, a tela funciona normalmente (só esconde o filtro Cash/Torneio).

do $mig$
begin

  create or replace view public.relatorio_sessoes
  with (security_invoker = true) as
  select
    m.jogador,
    m.jogador_id,
    m.sessao_finalizada_em,
    max(m.id) as ultimo_id,
    count(*) as itens,
    coalesce(sum(m.valor) filter (where m.tipo in ('Entrada', 'Registro', 'Rebuy', 'Add-on')), 0) as entrada,
    coalesce(sum(m.valor) filter (where m.tipo = 'Saída'), 0) as saida,
    coalesce(sum(m.valor) filter (where m.tipo = 'Saída'), 0)
      - coalesce(sum(m.valor) filter (where m.tipo in ('Entrada', 'Registro', 'Rebuy', 'Add-on') and not m.pago), 0)
      + coalesce(sum(m.valor) filter (where m.tipo = 'Pagamento'), 0) as resultado,
    coalesce(bool_or(m.tipo <> 'Pagamento' and m.torneio_id is null), false) as tem_cash,
    coalesce(bool_or(m.torneio_id is not null), false) as tem_torneio
  from public.movimentacoes m
  where m.sessao_finalizada_em is not null
  group by m.jogador, m.jogador_id, m.sessao_finalizada_em;

  -- Só usuários logados (as regras de acesso das tabelas valem aqui também).
  revoke all on public.relatorio_sessoes from public, anon;
  grant select on public.relatorio_sessoes to authenticated;

end $mig$;

notify pgrst, 'reload schema';
