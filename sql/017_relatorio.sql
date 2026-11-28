-- Rodar uma vez no Supabase: SQL Editor > New query > colar > Run.
--
-- Economia de tráfego (Rodada 3): o Relatório e a aba "Sessões finalizadas"
-- do Desfazer / Log baixavam todas as movimentações (cerca de 1 MB) só para
-- somar e agrupar. Agora o banco devolve os totais e as sessões prontas.
-- Não altera nenhum dado. Pode ser rodado de novo.
--
-- Mesmas contas das telas (js/comum.js, calcularResultadoMovimentacoes):
--   entradas  = Entrada, Registro, Rebuy, Add-on
--   resultado = Saídas − entradas não pagas + Pagamentos

do $mig$
begin

  -- Uma linha por sessão finalizada (jogador + horário de fechamento).
  -- ultimo_id = maior id da sessão: ordenar por ele dá a mesma ordem de antes.
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
      + coalesce(sum(m.valor) filter (where m.tipo = 'Pagamento'), 0) as resultado
  from public.movimentacoes m
  where m.sessao_finalizada_em is not null
  group by m.jogador, m.jogador_id, m.sessao_finalizada_em;

  -- Números do Resumo do Relatório a partir de p_inicio (null = tudo).
  create or replace function public.relatorio_resumo(p_inicio timestamptz default null)
  returns jsonb
  language sql
  stable
  security invoker
  set search_path = public
  as $fn$
    with mov as (
      select * from public.movimentacoes
      where p_inicio is null or data >= p_inicio
    ),
    rec as (
      select * from public.cash_mesa_recolhimentos
      where p_inicio is null or criado_em >= p_inicio
    )
    select jsonb_build_object(
      'cash_entradas',     (select coalesce(sum(valor), 0) from mov where torneio_id is null and tipo in ('Entrada', 'Registro', 'Rebuy', 'Add-on')),
      'cash_entradas_qtd', (select count(*) from mov where torneio_id is null and tipo in ('Entrada', 'Registro', 'Rebuy', 'Add-on')),
      'cash_saidas',       (select coalesce(sum(valor), 0) from mov where torneio_id is null and tipo = 'Saída'),
      'cash_saidas_qtd',   (select count(*) from mov where torneio_id is null and tipo = 'Saída'),
      'torneio_entradas',     (select coalesce(sum(valor), 0) from mov where torneio_id is not null and tipo in ('Entrada', 'Registro', 'Rebuy', 'Add-on')),
      'torneio_entradas_qtd', (select count(*) from mov where torneio_id is not null and tipo in ('Entrada', 'Registro', 'Rebuy', 'Add-on')),
      'pagamentos',     (select coalesce(sum(valor), 0) from mov where tipo = 'Pagamento'),
      'pagamentos_qtd', (select count(*) from mov where tipo = 'Pagamento'),
      'jogadores',      (select count(distinct jogador) from mov),
      'sessoes', (
        select count(*) from (
          select distinct jogador, sessao_finalizada_em
          from public.movimentacoes
          where sessao_finalizada_em is not null
            and (p_inicio is null or sessao_finalizada_em >= p_inicio)
        ) s
      ),
      'rake',     (select coalesce(sum(valor), 0) from rec where tipo = 'rake'),
      'caixinha', (select coalesce(sum(valor), 0) from rec where tipo = 'caixinha'),
      'jackpot',  (select coalesce(sum(valor), 0) from rec where tipo = 'jackpot'),
      'recolhido', (select coalesce(sum(valor), 0) from rec)
    );
  $fn$;

  -- Só usuários logados (as regras de acesso das tabelas valem aqui também).
  revoke all on public.relatorio_sessoes from public, anon;
  grant select on public.relatorio_sessoes to authenticated;
  revoke all on function public.relatorio_resumo(timestamptz) from public, anon;
  grant execute on function public.relatorio_resumo(timestamptz) to authenticated;

  -- Acelera o filtro por período.
  create index if not exists movimentacoes_data_idx on public.movimentacoes (data);
  create index if not exists movimentacoes_sessao_idx on public.movimentacoes (sessao_finalizada_em)
    where sessao_finalizada_em is not null;

end $mig$;

notify pgrst, 'reload schema';
