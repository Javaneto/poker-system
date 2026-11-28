-- Rodar uma vez no Supabase: SQL Editor > New query > colar > Run.
--
-- ETAPA 2 da revisão do banco. Tudo num único bloco: ou aplica tudo, ou nada.
-- Pode ser rodado de novo sem problema.
--
--  1. O código do torneio passa a ser número em todas as tabelas
--     (classificação, torneios do ranking, ajustes de prêmio), ligado ao
--     torneio de verdade: excluir um torneio apaga junto a classificação,
--     o vínculo com o ranking e os ajustes de prêmio dele.
--  2. Não dá mais para excluir um torneio que tem movimentações (entradas,
--     pagamentos, prêmios). Antes elas perdiam o vínculo e passavam a
--     parecer cash nos relatórios. Para excluir um torneio de teste,
--     desfaça as movimentações dele primeiro.
--  3. Funções que usam o código do torneio foram atualizadas para o novo
--     formato (Ajustar Prêmio e Ranking público).
--  4. O Log passa a registrar também torneios (menos o relógio), valores
--     do torneio, classificação, rankings, ajustes de ranking, estruturas
--     de premiação/blinds e configurações.

do $mig$
declare
  v_tabela text;
begin

  -- -------------------------------------------------------------------------
  -- 1. torneio_id: texto -> número, com ligação ao torneio
  -- -------------------------------------------------------------------------
  foreach v_tabela in array array['torneio_resultados', 'ranking_torneios', 'torneio_premiacao_ajustes'] loop

    if (select data_type from information_schema.columns
         where table_schema = 'public' and table_name = v_tabela and column_name = 'torneio_id') = 'text' then

      -- Restos de torneios já excluídos (não têm mais a que se ligar).
      execute format(
        'delete from public.%I x where x.torneio_id !~ ''^[0-9]+$'' or not exists (select 1 from public.torneios t where t.id::text = x.torneio_id)',
        v_tabela);

      execute format('alter table public.%I alter column torneio_id type bigint using torneio_id::bigint', v_tabela);
    end if;

    execute format('alter table public.%I drop constraint if exists %I', v_tabela, v_tabela || '_torneio_id_fkey');
    execute format(
      'alter table public.%I add constraint %I foreign key (torneio_id) references public.torneios(id) on delete cascade',
      v_tabela, v_tabela || '_torneio_id_fkey');
  end loop;

  create index if not exists ranking_torneios_torneio_idx on public.ranking_torneios (torneio_id);

  -- -------------------------------------------------------------------------
  -- 2. Torneio com movimentações não pode ser excluído
  -- -------------------------------------------------------------------------
  alter table public.movimentacoes drop constraint if exists movimentacoes_torneio_id_fkey;
  alter table public.movimentacoes add constraint movimentacoes_torneio_id_fkey
    foreign key (torneio_id) references public.torneios(id) on delete restrict;

  -- -------------------------------------------------------------------------
  -- 3. Funções com o novo formato
  -- -------------------------------------------------------------------------
  create or replace function public.registrar_ajuste_premiacao(
    p_torneio_id       text,
    p_valor            numeric,
    p_observacao       text,
    p_alterar_manual   boolean default false,
    p_premiacao_manual jsonb   default null
  )
  returns bigint
  language plpgsql
  set search_path = public
  as $$
  declare
    v_id bigint;
  begin
    if p_valor is null or p_valor = 0 then
      raise exception 'Valor do ajuste inválido';
    end if;

    update torneios
       set ajuste_premiacao = coalesce(ajuste_premiacao, 0) + p_valor,
           premiacao_manual = case when p_alterar_manual then p_premiacao_manual else premiacao_manual end
     where id::text = p_torneio_id
       and coalesce(status, '') <> 'encerrado';

    if not found then
      raise exception 'Torneio não encontrado ou já encerrado';
    end if;

    insert into torneio_premiacao_ajustes (torneio_id, valor, observacao)
    values (p_torneio_id::bigint, p_valor, nullif(trim(p_observacao), ''))
    returning id into v_id;

    return v_id;
  end;
  $$;

  create or replace function public.desfazer_ajuste_premiacao(p_ajuste_id bigint)
  returns void
  language plpgsql
  set search_path = public
  as $$
  declare
    v_ajuste torneio_premiacao_ajustes%rowtype;
  begin
    delete from torneio_premiacao_ajustes where id = p_ajuste_id returning * into v_ajuste;

    if not found then
      raise exception 'Ajuste não encontrado';
    end if;

    update torneios
       set ajuste_premiacao = coalesce(ajuste_premiacao, 0) - v_ajuste.valor
     where id = v_ajuste.torneio_id
       and coalesce(status, '') <> 'encerrado';

    if not found then
      raise exception 'Torneio não encontrado ou já encerrado';
    end if;
  end;
  $$;

  -- Ranking público: devolve torneio_id como texto, igual a antes.
  create or replace function public.ranking_publico(p_token uuid)
  returns jsonb
  language sql
  stable
  security definer
  set search_path = public
  as $$
    select jsonb_build_object(
      'ranking', jsonb_build_object(
        'nome', r.nome,
        'data_inicio', r.data_inicio,
        'data_fim', r.data_fim,
        'ativo', r.ativo,
        'pontos_base', r.pontos_base,
        'pontos_por_jogador', r.pontos_por_jogador,
        'pontos_participacao', r.pontos_participacao,
        'participacao_tipo', r.participacao_tipo,
        'percentuais', r.percentuais
      ),
      'vinculos', coalesce((
        select jsonb_agg(jsonb_build_object('torneio_id', v.torneio_id::text, 'ajuste_pontos', v.ajuste_pontos))
        from ranking_torneios v
        where v.ranking_id = r.id
      ), '[]'::jsonb),
      'resultados', coalesce((
        select jsonb_agg(jsonb_build_object('torneio_id', tr.torneio_id::text, 'jogador', tr.jogador, 'posicao', tr.posicao))
        from torneio_resultados tr
        where tr.torneio_id in (select v.torneio_id from ranking_torneios v where v.ranking_id = r.id)
      ), '[]'::jsonb),
      'ajustes', coalesce((
        select jsonb_agg(jsonb_build_object('jogador', a.jogador, 'pontos', a.pontos))
        from ranking_ajustes a
        where a.ranking_id = r.id
      ), '[]'::jsonb),
      'torneios', coalesce((
        select jsonb_agg(jsonb_build_object('id', t.id::text, 'nome', t.nome, 'criado_em', t.criado_em))
        from torneios t
        where t.id in (select v.torneio_id from ranking_torneios v where v.ranking_id = r.id)
      ), '[]'::jsonb)
    )
    from rankings r
    where p_token is not null and r.token_publico = p_token;
  $$;

  revoke execute on function public.registrar_ajuste_premiacao(text, numeric, text, boolean, jsonb) from public, anon;
  revoke execute on function public.desfazer_ajuste_premiacao(bigint) from public, anon;
  revoke execute on function public.ranking_publico(uuid) from public;
  grant execute on function public.registrar_ajuste_premiacao(text, numeric, text, boolean, jsonb) to authenticated;
  grant execute on function public.desfazer_ajuste_premiacao(bigint) to authenticated;
  grant execute on function public.ranking_publico(uuid) to anon, authenticated;

  -- -------------------------------------------------------------------------
  -- 4. Log de mais tabelas (gatilho do sql/002)
  -- -------------------------------------------------------------------------
  foreach v_tabela in array array['torneio_valores', 'torneio_resultados', 'rankings', 'ranking_torneios',
                                   'ranking_ajustes', 'premiacao_estruturas', 'estruturas_blinds', 'configuracoes'] loop
    execute format('drop trigger if exists %I on public.%I', 'log_' || v_tabela, v_tabela);
    execute format(
      'create trigger %I after insert or update or delete on public.%I for each row execute function public.registrar_log_alteracao()',
      'log_' || v_tabela, v_tabela);
  end loop;

  -- Torneios: o relógio grava a cada play/pausa/nível; essas mudanças não
  -- entram no Log (só o resto: nome, status, estruturas, prêmio...).
  drop trigger if exists log_torneios on public.torneios;
  drop trigger if exists log_torneios_alteracao on public.torneios;

  create trigger log_torneios
    after insert or delete on public.torneios
    for each row execute function public.registrar_log_alteracao();

  create trigger log_torneios_alteracao
    after update on public.torneios
    for each row
    when (
      (to_jsonb(old) - array['relogio_nivel_atual', 'relogio_segundos_restantes', 'relogio_iniciado_em', 'relogio_rodando',
                             'relogio_em_intervalo', 'relogio_intervalo_avanca_nivel', 'relogio_segundos_pre_intervalo',
                             'intervalo_manual_minutos', 'tempo_decorrido_segundos'])
      is distinct from
      (to_jsonb(new) - array['relogio_nivel_atual', 'relogio_segundos_restantes', 'relogio_iniciado_em', 'relogio_rodando',
                             'relogio_em_intervalo', 'relogio_intervalo_avanca_nivel', 'relogio_segundos_pre_intervalo',
                             'intervalo_manual_minutos', 'tempo_decorrido_segundos'])
    )
    execute function public.registrar_log_alteracao();

end $mig$;

notify pgrst, 'reload schema';
