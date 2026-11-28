-- Rodar uma vez no Supabase: SQL Editor > New query > colar > Run.
--
-- Economia de tráfego (Rodada 2): totais calculados no próprio banco.
-- As telas Jogadores e Torneios baixavam milhares de movimentações a cada
-- mudança só para somar. Agora pedem uma linha pronta por jogador / torneio.
-- Não altera nenhum dado. Pode ser rodado de novo.
--
-- Mesma conta das telas (calcularResultadoMovimentacoes, js/comum.js):
--   saldo = Saídas − entradas não pagas + Pagamentos
--   (entradas = Entrada, Registro, Rebuy, Add-on)

do $mig$
begin

  create or replace view public.jogadores_resumo
  with (security_invoker = true) as
  select
    j.id as jogador_id,
    count(m.id) as qtd_movs,
    count(m.id) filter (where m.sessao_finalizada_em is null) as qtd_abertas,
    coalesce(sum(m.valor) filter (where m.tipo = 'Saída'), 0)
      - coalesce(sum(m.valor) filter (where m.tipo in ('Entrada', 'Registro', 'Rebuy', 'Add-on') and not m.pago), 0)
      + coalesce(sum(m.valor) filter (where m.tipo = 'Pagamento'), 0) as saldo_geral,
    coalesce(sum(m.valor) filter (where m.sessao_finalizada_em is null and m.tipo = 'Saída'), 0)
      - coalesce(sum(m.valor) filter (where m.sessao_finalizada_em is null and m.tipo in ('Entrada', 'Registro', 'Rebuy', 'Add-on') and not m.pago), 0)
      + coalesce(sum(m.valor) filter (where m.sessao_finalizada_em is null and m.tipo = 'Pagamento'), 0) as saldo_aberto,
    coalesce(sum(m.valor) filter (where m.tipo in ('Entrada', 'Registro', 'Rebuy', 'Add-on')), 0) as total_entrou,
    coalesce(sum(m.valor) filter (where m.tipo = 'Saída'), 0) as total_saiu,
    count(distinct m.sessao_finalizada_em) filter (
      where m.torneio_id is null and m.sessao_finalizada_em is not null and m.tipo <> 'Pagamento'
    ) as sessoes_cash,
    count(distinct m.torneio_id) as torneios,
    max(m.data) as ultima
  from public.jogadores j
  left join public.movimentacoes m on m.jogador_id = j.id
  group by j.id;

  create or replace view public.torneios_totais
  with (security_invoker = true) as
  select
    m.torneio_id,
    coalesce(sum(m.valor_prize), 0) as premio_entradas,
    count(distinct m.jogador_id) as jogadores
  from public.movimentacoes m
  where m.torneio_id is not null
  group by m.torneio_id;

  -- Só usuários logados (as regras de acesso das tabelas valem nas visões).
  revoke all on public.jogadores_resumo, public.torneios_totais from public, anon;
  grant select on public.jogadores_resumo, public.torneios_totais to authenticated;

end $mig$;

notify pgrst, 'reload schema';
