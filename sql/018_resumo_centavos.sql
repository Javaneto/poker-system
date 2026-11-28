-- Rodar uma vez no Supabase: SQL Editor > New query > colar > Run.
--
-- Ajuste do Resumo do Relatório (sql/017): cada lançamento é arredondado
-- para centavos antes de somar, como a tela fazia antes. Assim lançamentos
-- com milésimos (ex.: R$ 0,001) contam R$ 0,00, igual à conta antiga.
-- Não altera nenhum dado. Pode ser rodado de novo.

do $mig$
begin

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
      'cash_entradas',     (select coalesce(sum(round(valor, 2)), 0) from mov where torneio_id is null and tipo in ('Entrada', 'Registro', 'Rebuy', 'Add-on')),
      'cash_entradas_qtd', (select count(*) from mov where torneio_id is null and tipo in ('Entrada', 'Registro', 'Rebuy', 'Add-on')),
      'cash_saidas',       (select coalesce(sum(round(valor, 2)), 0) from mov where torneio_id is null and tipo = 'Saída'),
      'cash_saidas_qtd',   (select count(*) from mov where torneio_id is null and tipo = 'Saída'),
      'torneio_entradas',     (select coalesce(sum(round(valor, 2)), 0) from mov where torneio_id is not null and tipo in ('Entrada', 'Registro', 'Rebuy', 'Add-on')),
      'torneio_entradas_qtd', (select count(*) from mov where torneio_id is not null and tipo in ('Entrada', 'Registro', 'Rebuy', 'Add-on')),
      'pagamentos',     (select coalesce(sum(round(valor, 2)), 0) from mov where tipo = 'Pagamento'),
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
      'rake',     (select coalesce(sum(round(valor, 2)), 0) from rec where tipo = 'rake'),
      'caixinha', (select coalesce(sum(round(valor, 2)), 0) from rec where tipo = 'caixinha'),
      'jackpot',  (select coalesce(sum(round(valor, 2)), 0) from rec where tipo = 'jackpot'),
      'recolhido', (select coalesce(sum(round(valor, 2)), 0) from rec)
    );
  $fn$;

  revoke all on function public.relatorio_resumo(timestamptz) from public, anon;
  grant execute on function public.relatorio_resumo(timestamptz) to authenticated;

end $mig$;

notify pgrst, 'reload schema';
