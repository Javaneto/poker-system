-- Rodar uma vez no Supabase: SQL Editor > New query > colar > Run.
--
-- Ranking:
--   torneio_resultados - colocação final de cada jogador em cada torneio
--                        (preenchida no Diretor, botão "Classificação")
--   rankings           - configuração de cada ranking (temporada)
--   ranking_torneios   - torneios que contam para cada ranking, com ajuste
--                        manual (+/-) no total de pontos daquele torneio
--   ranking_ajustes    - ajuste manual de pontos por jogador
--
-- Pontos de um torneio:
--   total = pontos_base + pontos_por_jogador x nº de jogadores + ajuste
--   cada posição recebe total x percentual da posição
--   todos os participantes recebem também pontos_participacao

create table if not exists public.torneio_resultados (
  id            bigint generated always as identity primary key,
  torneio_id    text   not null,
  jogador       text   not null,
  posicao       int    not null check (posicao > 0),
  eliminado_por text,
  criado_em     timestamptz not null default now(),
  unique (torneio_id, jogador)
);

create table if not exists public.rankings (
  id                  bigint generated always as identity primary key,
  nome                text    not null,
  data_inicio         date,
  data_fim            date,
  ativo               boolean not null default true,
  pontos_base         numeric not null default 100,
  pontos_por_jogador  numeric not null default 10,
  pontos_participacao numeric not null default 0,
  percentuais         jsonb   not null default '[30,20,15,10,8,6,5,3,2,1]'::jsonb,
  criado_em           timestamptz not null default now()
);

create table if not exists public.ranking_torneios (
  id            bigint generated always as identity primary key,
  ranking_id    bigint  not null references public.rankings(id) on delete cascade,
  torneio_id    text    not null,
  ajuste_pontos numeric not null default 0,
  unique (ranking_id, torneio_id)
);

create table if not exists public.ranking_ajustes (
  id          bigint generated always as identity primary key,
  ranking_id  bigint  not null references public.rankings(id) on delete cascade,
  jogador     text    not null,
  pontos      numeric not null,
  motivo      text,
  criado_em   timestamptz not null default now()
);

-- Acesso: só usuários logados.
do $$
declare t text;
begin
  foreach t in array array['torneio_resultados', 'rankings', 'ranking_torneios', 'ranking_ajustes'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('drop policy if exists "acesso autenticados" on public.%I', t);
    execute format('create policy "acesso autenticados" on public.%I for all to authenticated using (true) with check (true)', t);
  end loop;
end $$;

-- Atualização em tempo real nas páginas.
do $$
declare t text;
begin
  foreach t in array array['torneio_resultados', 'rankings', 'ranking_torneios', 'ranking_ajustes'] loop
    begin
      execute format('alter publication supabase_realtime add table public.%I', t);
    exception when duplicate_object then null;
    end;
  end loop;
end $$;
