-- Rodar uma vez no Supabase: SQL Editor > New query > colar > Run.
--
-- ETAPA 1 da revisão do banco (análise de 28/11/2026). Tudo roda numa única
-- transação: se qualquer passo falhar, nada é alterado.
--
--  1. Corrige nomes antigos de jogadores renomeados que ficaram na
--     classificação dos torneios, nos ajustes do ranking, nas mesas de cash
--     e em 3 nomes antigos das movimentações (confirmados pelo clube).
--  2. Renomear jogador passa a atualizar o nome em TODAS as tabelas,
--     automaticamente (gatilho no banco), venha a mudança de onde vier.
--  3. Jogador precisa de nome, e não pode haver dois com o mesmo nome
--     (sem diferenciar maiúsculas/minúsculas).
--  4. movimentacoes.data deixa de ser texto e vira data/hora de verdade.
--  5. Regras de dados válidos: movimentação com jogador, tipo e valor;
--     tipos conhecidos; só Pagamento pode ser negativo; status de torneio.
--  6. Índices nas buscas mais usadas (em aberto, por torneio, por jogador).
--  7. Segurança: visitante sem login não tem nenhuma permissão nas tabelas
--     (as regras de acesso já bloqueavam; agora fica fechado em duas
--     camadas). O Ranking público continua funcionando.
--
-- Pode ser rodado de novo sem problema.
--
-- Tudo fica dentro de UM bloco (do $mig$ ... $mig$): o SQL Editor do
-- Supabase executa cada comando separado, e um bloco único garante que ou
-- tudo é aplicado, ou nada.

do $mig$
declare
  v_conflitos text;
begin

-- ---------------------------------------------------------------------------
-- 1. Nomes antigos -> nome atual do cadastro
-- ---------------------------------------------------------------------------
-- Tirado do histórico de renomes (Log) já resolvendo as cadeias
-- (ex.: Nicolas DJ -> Nicolas -> Nicolas R. Oliveira). Nomes sem nenhuma
-- linha para corrigir são simplesmente ignorados.

create temporary table if not exists _renomes (antigo text primary key, atual text not null) on commit drop;
truncate _renomes;

insert into _renomes (antigo, atual) values
  ('Dim Fernando',                 'Fernando Mendonça'),
  ('Kato Kayan',                   'Kayan Henrique'),
  ('Marão',                        'Mario Cesar Aratani'),
  ('Amorim João',                  'João Amorim'),
  ('Paulinha',                     'Ana Paula Gonçalves'),
  ('Xande Alexandre',              'Alexandre'),
  ('Junior Hamilton',              'Hamilton Piantamar Jr'),
  ('Wilian',                       'Wilian de S. Bento'),
  ('William',                      'Wilian de S. Bento'),
  ('Nicolas DJ',                   'Nicolas R. Oliveira'),
  ('Nicolas',                      'Nicolas R. Oliveira'),
  ('Marcelo Nogueira Valentin',    'Marcelo N. Valentin'),
  ('Marcelo Valentin',             'Marcelo N. Valentin'),
  ('Marcelo N Valentin',           'Marcelo N. Valentin'),
  ('Pretin Eliton',                'Eliton Ricardo'),
  ('Dr Lucas Nogueira',            'Lucas Nogueira'),
  ('Denise',                       'Denise Santos'),
  ('Leo Monteiro',                 'Leonardo Monteiro'),
  ('Tião Sebastião',               'Sebastião'),
  ('Turcão Tiago',                 'Tiago'),
  ('Lukinha Barbosa',              'Lucas Jorge Barbosa'),
  ('Lucas Barbosa',                'Lucas Jorge Barbosa'),
  ('Jefferson',                    'Jefferson Ko'),
  ('Fernando Taceli (Texas Club)', 'Fernando Taceli'),
  ('Fernando Texas',               'Fernando Taceli'),
  ('Minotti Alexander',            'Alexander'),
  ('Croc Leo Rocha',               'Leonardo Rocha'),
  ('Dr Aloisio',                   'Aloisio'),
  ('Caixa Diogo',                  'Diogo'),
  ('Caião',                        'Caio Mendes'),
  ('Bob - Rodrigo',                'Rodrigo Evangelista'),
  ('Balão Alan',                   'Alan Oliveira'),
  ('Vitin Vitor Hugo',             'Vitor Hugo'),
  ('Vitinho Vitor Renan',          'Vitor Renan'),
  ('Sergin',                       'Serginho');

-- Só corrige um nome antigo se ele NÃO for um jogador cadastrado hoje
-- (ex.: se alguém novo se chamar "Nicolas", não mexe) e se o nome atual
-- existir no cadastro.
delete from _renomes r
 where exists (select 1 from jogadores j where j.nome = r.antigo)
    or not exists (select 1 from jogadores j where j.nome = r.atual);

-- Mesma pessoa duas vezes no mesmo torneio / mesa (nome antigo e novo):
-- não dá para juntar sozinho. Para tudo e avisa.
  select string_agg(format('torneio %s: %s', torneio_id, nome), '; ')
    into v_conflitos
    from (
      select a.torneio_id, coalesce(r.atual, a.jogador) as nome
        from torneio_resultados a
        left join _renomes r on r.antigo = a.jogador
       group by 1, 2
      having count(*) > 1
    ) x;

  if v_conflitos is not null then
    raise exception 'Jogador com nome antigo e novo na mesma classificação: %', v_conflitos;
  end if;

  select string_agg(format('mesa %s: %s', mesa_id, nome), '; ')
    into v_conflitos
    from (
      select a.mesa_id, coalesce(r.atual, a.jogador) as nome
        from cash_mesa_jogadores a
        left join _renomes r on r.antigo = a.jogador
       group by 1, 2
      having count(*) > 1
    ) x;

  if v_conflitos is not null then
    raise exception 'Jogador com nome antigo e novo na mesma mesa: %', v_conflitos;
  end if;

update movimentacoes m      set jogador = r.atual       from _renomes r where m.jogador = r.antigo;
update torneio_resultados t set jogador = r.atual       from _renomes r where t.jogador = r.antigo;
update torneio_resultados t set eliminado_por = r.atual from _renomes r where t.eliminado_por = r.antigo;
update ranking_ajustes a    set jogador = r.atual       from _renomes r where a.jogador = r.antigo;
update cash_mesa_jogadores c set jogador = r.atual      from _renomes r where c.jogador = r.antigo;

-- ---------------------------------------------------------------------------
-- 2. Renomear no cadastro atualiza o nome em todas as tabelas
-- ---------------------------------------------------------------------------

create or replace function public.propagar_renome_jogador()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if new.nome is distinct from old.nome and old.nome is not null then
    update movimentacoes       set jogador = new.nome       where jogador = old.nome;
    update torneio_resultados  set jogador = new.nome       where jogador = old.nome;
    update torneio_resultados  set eliminado_por = new.nome where eliminado_por = old.nome;
    update ranking_ajustes     set jogador = new.nome       where jogador = old.nome;
    update cash_mesa_jogadores set jogador = new.nome       where jogador = old.nome;
  end if;
  return new;
end;
$$;

drop trigger if exists propagar_renome_jogador on public.jogadores;
create trigger propagar_renome_jogador
  after update of nome on public.jogadores
  for each row execute function public.propagar_renome_jogador();

-- ---------------------------------------------------------------------------
-- 3. Nome do jogador: obrigatório e único
-- ---------------------------------------------------------------------------

update jogadores set nome = btrim(nome) where nome <> btrim(nome);

alter table public.jogadores alter column nome set not null;

alter table public.jogadores drop constraint if exists jogadores_nome_preenchido;
alter table public.jogadores add constraint jogadores_nome_preenchido check (btrim(nome) <> '');

create unique index if not exists jogadores_nome_unico on public.jogadores (lower(btrim(nome)));

-- ---------------------------------------------------------------------------
-- 4. movimentacoes.data: texto -> data/hora
-- ---------------------------------------------------------------------------
-- Só converte se ainda for texto (permite rodar o arquivo de novo).

  if (select data_type from information_schema.columns
       where table_schema = 'public' and table_name = 'movimentacoes' and column_name = 'data') = 'text' then
    update movimentacoes set data = now()::text where data is null or btrim(data) = '';
    alter table public.movimentacoes alter column data type timestamptz using data::timestamptz;
  end if;

alter table public.movimentacoes alter column data set default now();
alter table public.movimentacoes alter column data set not null;

-- ---------------------------------------------------------------------------
-- 5. Regras de dados válidos
-- ---------------------------------------------------------------------------

alter table public.movimentacoes alter column jogador set not null;
alter table public.movimentacoes alter column tipo set not null;
alter table public.movimentacoes alter column valor set not null;

alter table public.movimentacoes drop constraint if exists movimentacoes_tipo_valido;
alter table public.movimentacoes add constraint movimentacoes_tipo_valido
  check (tipo in ('Entrada', 'Saída', 'Registro', 'Rebuy', 'Add-on', 'Pagamento'));

-- Pagamento negativo = cobrança / clube pagou. Os demais nunca são negativos.
alter table public.movimentacoes drop constraint if exists movimentacoes_valor_valido;
alter table public.movimentacoes add constraint movimentacoes_valor_valido
  check (tipo = 'Pagamento' or valor >= 0);

alter table public.movimentacoes drop constraint if exists movimentacoes_prize_rake_validos;
alter table public.movimentacoes add constraint movimentacoes_prize_rake_validos
  check (coalesce(valor_prize, 0) >= 0 and coalesce(valor_rake, 0) >= 0);

alter table public.torneios drop constraint if exists torneios_status_valido;
alter table public.torneios add constraint torneios_status_valido
  check (status in ('aberto', 'encerrado'));

-- ---------------------------------------------------------------------------
-- 6. Índices
-- ---------------------------------------------------------------------------

create index if not exists movimentacoes_em_aberto_idx on public.movimentacoes (id) where sessao_finalizada_em is null;
create index if not exists movimentacoes_torneio_idx   on public.movimentacoes (torneio_id) where torneio_id is not null;
create index if not exists movimentacoes_jogador_idx   on public.movimentacoes (jogador);
create index if not exists torneio_resultados_jogador_idx on public.torneio_resultados (jogador);
create index if not exists ranking_ajustes_ranking_idx on public.ranking_ajustes (ranking_id);

-- ---------------------------------------------------------------------------
-- 7. Segurança: nada para visitante sem login
-- ---------------------------------------------------------------------------

revoke all on all tables    in schema public from anon;
revoke all on all sequences in schema public from anon;
alter default privileges in schema public revoke all on tables    from anon;
alter default privileges in schema public revoke all on sequences from anon;

-- Funções do sistema: só usuários logados (o padrão do Postgres libera
-- para todos). O Ranking público (ranking_publico) continua liberado.
revoke execute on function public.registrar_ajuste_premiacao(text, numeric, text, boolean, jsonb) from public, anon;
revoke execute on function public.desfazer_ajuste_premiacao(bigint) from public, anon;
revoke execute on function public.encerrar_torneio_com_premios(text, jsonb) from public, anon;
revoke execute on function public.propagar_renome_jogador() from public, anon;
revoke execute on function public.registrar_log_alteracao() from public, anon;
grant execute on function public.registrar_ajuste_premiacao(text, numeric, text, boolean, jsonb) to authenticated;
grant execute on function public.desfazer_ajuste_premiacao(bigint) to authenticated;
grant execute on function public.encerrar_torneio_com_premios(text, jsonb) to authenticated;
grant execute on function public.ranking_publico(uuid) to anon, authenticated;

end $mig$;

notify pgrst, 'reload schema';
