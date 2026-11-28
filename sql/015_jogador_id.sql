-- Rodar uma vez no Supabase: SQL Editor > New query > colar > Run.
--
-- ETAPA 3 da revisão do banco: ligação pelo CÓDIGO do jogador, não pelo nome.
-- Tudo num único bloco: ou aplica tudo, ou nada. Pode ser rodado de novo.
--
--  1. movimentacoes, torneio_resultados (jogador e eliminado_por),
--     ranking_ajustes e cash_mesa_jogadores ganham jogador_id, ligado ao
--     cadastro de jogadores. Preenchido agora a partir do nome.
--  2. O nome continua gravado ao lado (as telas usam), mas vira um espelho
--     do cadastro, mantido pelo banco:
--       - gravou com jogador_id  -> o nome é preenchido pelo cadastro;
--       - gravou só com o nome   -> o banco acha o código pelo nome
--         (nome que não existe no cadastro é recusado: não nasce mais
--         histórico "solto");
--       - renomeou no cadastro   -> o nome muda em todo o histórico pelo
--         código.
--  3. Jogador com qualquer histórico (movimentação, classificação, ranking
--     ou mesa) não pode ser excluído; use "Inativar".
--
-- O preenchimento inicial não é registrado no Log (seriam milhares de
-- linhas iguais); o Log continua normal para todo o resto.

do $mig$
declare
  v_tabela text;
  v_faltando text;
begin

  -- -------------------------------------------------------------------------
  -- 1. Colunas jogador_id
  -- -------------------------------------------------------------------------
  alter table public.movimentacoes       add column if not exists jogador_id bigint;
  alter table public.torneio_resultados  add column if not exists jogador_id bigint;
  alter table public.torneio_resultados  add column if not exists eliminado_por_id bigint;
  alter table public.ranking_ajustes     add column if not exists jogador_id bigint;
  alter table public.cash_mesa_jogadores add column if not exists jogador_id bigint;

  -- Todo nome precisa existir no cadastro (a Etapa 1 já corrigiu os antigos).
  select string_agg(distinct x.jogador, ', ') into v_faltando
    from (
      select jogador from movimentacoes
      union all select jogador from torneio_resultados
      union all select eliminado_por from torneio_resultados where eliminado_por is not null
      union all select jogador from ranking_ajustes
      union all select jogador from cash_mesa_jogadores
    ) x
   where not exists (select 1 from jogadores j where j.nome = x.jogador);

  if v_faltando is not null then
    raise exception 'Nomes sem cadastro (cadastre ou corrija antes): %', v_faltando;
  end if;

  -- Preenchimento inicial, sem gerar milhares de linhas no Log.
  alter table public.movimentacoes disable trigger log_movimentacoes;
  alter table public.torneio_resultados disable trigger log_torneio_resultados;
  alter table public.ranking_ajustes disable trigger log_ranking_ajustes;

  update movimentacoes m set jogador_id = j.id
    from jogadores j where j.nome = m.jogador and m.jogador_id is distinct from j.id;
  update torneio_resultados t set jogador_id = j.id
    from jogadores j where j.nome = t.jogador and t.jogador_id is distinct from j.id;
  update torneio_resultados t set eliminado_por_id = j.id
    from jogadores j where j.nome = t.eliminado_por and t.eliminado_por_id is distinct from j.id;
  update ranking_ajustes a set jogador_id = j.id
    from jogadores j where j.nome = a.jogador and a.jogador_id is distinct from j.id;
  update cash_mesa_jogadores c set jogador_id = j.id
    from jogadores j where j.nome = c.jogador and c.jogador_id is distinct from j.id;

  alter table public.movimentacoes enable trigger log_movimentacoes;
  alter table public.torneio_resultados enable trigger log_torneio_resultados;
  alter table public.ranking_ajustes enable trigger log_ranking_ajustes;

  -- Obrigatório e ligado ao cadastro (excluir jogador com histórico: bloqueado).
  foreach v_tabela in array array['movimentacoes', 'torneio_resultados', 'ranking_ajustes', 'cash_mesa_jogadores'] loop
    execute format('alter table public.%I alter column jogador_id set not null', v_tabela);
    execute format('alter table public.%I drop constraint if exists %I', v_tabela, v_tabela || '_jogador_id_fkey');
    execute format('alter table public.%I add constraint %I foreign key (jogador_id) references public.jogadores(id) on delete restrict',
                   v_tabela, v_tabela || '_jogador_id_fkey');
    execute format('create index if not exists %I on public.%I (jogador_id)', v_tabela || '_jogador_id_idx', v_tabela);
  end loop;

  alter table public.torneio_resultados drop constraint if exists torneio_resultados_eliminado_por_id_fkey;
  alter table public.torneio_resultados add constraint torneio_resultados_eliminado_por_id_fkey
    foreign key (eliminado_por_id) references public.jogadores(id) on delete restrict;

  -- Mesmo jogador uma vez por classificação / mesa (agora pelo código).
  create unique index if not exists torneio_resultados_torneio_jogador_id_key on public.torneio_resultados (torneio_id, jogador_id);
  create unique index if not exists cash_mesa_jogadores_mesa_jogador_id_key on public.cash_mesa_jogadores (mesa_id, jogador_id);

  -- -------------------------------------------------------------------------
  -- 2. Nome como espelho do cadastro
  -- -------------------------------------------------------------------------
  create or replace function public.sincronizar_jogador()
  returns trigger
  language plpgsql
  set search_path = public
  as $$
  declare
    v_nome text;
  begin
    -- Trocou só o nome (ex.: tela antiga): acha o código pelo nome novo.
    if tg_op = 'UPDATE' and new.jogador is distinct from old.jogador
       and new.jogador_id is not distinct from old.jogador_id then
      new.jogador_id := null;
    end if;

    if new.jogador_id is null then
      select id into new.jogador_id from jogadores where nome = btrim(new.jogador);
      if new.jogador_id is null then
        raise exception 'Jogador "%" não encontrado no cadastro', new.jogador
          using errcode = '23503';
      end if;
    end if;

    select nome into v_nome from jogadores where id = new.jogador_id;
    if v_nome is null then
      raise exception 'Jogador % não encontrado no cadastro', new.jogador_id using errcode = '23503';
    end if;
    new.jogador := v_nome;

    return new;
  end;
  $$;

  create or replace function public.sincronizar_eliminado_por()
  returns trigger
  language plpgsql
  set search_path = public
  as $$
  begin
    if tg_op = 'UPDATE' and new.eliminado_por is distinct from old.eliminado_por
       and new.eliminado_por_id is not distinct from old.eliminado_por_id then
      new.eliminado_por_id := null;
    end if;

    if new.eliminado_por is null and new.eliminado_por_id is null then
      return new;
    end if;

    if new.eliminado_por_id is null then
      select id into new.eliminado_por_id from jogadores where nome = btrim(new.eliminado_por);
      if new.eliminado_por_id is null then
        raise exception 'Jogador "%" não encontrado no cadastro', new.eliminado_por using errcode = '23503';
      end if;
    end if;

    select nome into new.eliminado_por from jogadores where id = new.eliminado_por_id;
    return new;
  end;
  $$;

  foreach v_tabela in array array['movimentacoes', 'torneio_resultados', 'ranking_ajustes', 'cash_mesa_jogadores'] loop
    execute format('drop trigger if exists sincronizar_jogador on public.%I', v_tabela);
    execute format('create trigger sincronizar_jogador before insert or update of jogador, jogador_id on public.%I for each row execute function public.sincronizar_jogador()', v_tabela);
  end loop;

  drop trigger if exists sincronizar_eliminado_por on public.torneio_resultados;
  create trigger sincronizar_eliminado_por
    before insert or update of eliminado_por, eliminado_por_id on public.torneio_resultados
    for each row execute function public.sincronizar_eliminado_por();

  -- Renomear no cadastro: atualiza o espelho do nome pelo código.
  create or replace function public.propagar_renome_jogador()
  returns trigger
  language plpgsql
  set search_path = public
  as $$
  begin
    if new.nome is distinct from old.nome then
      update movimentacoes       set jogador = new.nome       where jogador_id = new.id;
      update torneio_resultados  set jogador = new.nome       where jogador_id = new.id;
      update torneio_resultados  set eliminado_por = new.nome where eliminado_por_id = new.id;
      update ranking_ajustes     set jogador = new.nome       where jogador_id = new.id;
      update cash_mesa_jogadores set jogador = new.nome       where jogador_id = new.id;
    end if;
    return new;
  end;
  $$;

  revoke execute on function public.sincronizar_jogador() from public, anon;
  revoke execute on function public.sincronizar_eliminado_por() from public, anon;
  revoke execute on function public.propagar_renome_jogador() from public, anon;

end $mig$;

notify pgrst, 'reload schema';
