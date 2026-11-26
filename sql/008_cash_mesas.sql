-- Rodar uma vez no Supabase: SQL Editor > New query > colar > Run.
--
-- Mesas de Cash Game.
-- Cada mesa é criada como um torneio: tem jogadores sentados, compras e
-- devoluções de fichas, rake e caixinha recolhidos aos poucos (sangria) e um
-- fechamento que confere se as fichas bateram antes de encerrar.
--
-- Compras e devoluções continuam sendo gravadas em "movimentacoes"
-- (Entrada / Saída, modalidade Cash), agora com mesa_id. Assim o Em Aberto,
-- o Relatório e o Desfazer / Log seguem funcionando como antes.

create table if not exists public.cash_mesas (
  id            uuid primary key default gen_random_uuid(),
  nome          text        not null,
  status        text        not null default 'ativo' check (status in ('ativo', 'encerrado')),
  observacao    text,
  iniciado_em   timestamptz not null default now(),
  encerrado_em  timestamptz,
  criado_em     timestamptz not null default now()
);

create index if not exists cash_mesas_status_idx on public.cash_mesas (status, iniciado_em desc);

-- Quem está (ou esteve) sentado em cada mesa. Uma linha por jogador e mesa:
-- levantou_em vazio = sentado; ao voltar para a mesa, levantou_em volta a vazio.
create table if not exists public.cash_mesa_jogadores (
  id           uuid primary key default gen_random_uuid(),
  mesa_id      uuid        not null references public.cash_mesas (id) on delete cascade,
  jogador      text        not null,
  sentou_em    timestamptz not null default now(),
  levantou_em  timestamptz,
  unique (mesa_id, jogador)
);

-- Rake e caixinha retirados da mesa (sangria progressiva).
create table if not exists public.cash_mesa_recolhimentos (
  id          uuid primary key default gen_random_uuid(),
  mesa_id     uuid        not null references public.cash_mesas (id) on delete cascade,
  tipo        text        not null check (tipo in ('rake', 'caixinha')),
  valor       numeric     not null check (valor > 0),
  dealer      text,
  observacao  text,
  criado_em   timestamptz not null default now()
);

create index if not exists cash_mesa_recolhimentos_mesa_idx on public.cash_mesa_recolhimentos (mesa_id);

-- Compras e devoluções ligadas à mesa.
alter table public.movimentacoes
  add column if not exists mesa_id uuid references public.cash_mesas (id) on delete set null;

create index if not exists movimentacoes_mesa_idx on public.movimentacoes (mesa_id);

-- Só usuários logados leem e alteram (mesma regra do sql/007).
do $$
declare t text;
begin
  foreach t in array array['cash_mesas', 'cash_mesa_jogadores', 'cash_mesa_recolhimentos'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('drop policy if exists "acesso autenticados" on public.%I', t);
    execute format('create policy "acesso autenticados" on public.%I for all to authenticated using (true) with check (true)', t);
  end loop;
end $$;

-- Log automático (sql/002): rake e caixinha desfeitos ficam registrados.
drop trigger if exists log_cash_mesa_recolhimentos on public.cash_mesa_recolhimentos;
create trigger log_cash_mesa_recolhimentos
  after insert or update or delete on public.cash_mesa_recolhimentos
  for each row execute function public.registrar_log_alteracao();

drop trigger if exists log_cash_mesas on public.cash_mesas;
create trigger log_cash_mesas
  after insert or update or delete on public.cash_mesas
  for each row execute function public.registrar_log_alteracao();

-- Atualização em tempo real nas páginas.
do $$
declare t text;
begin
  foreach t in array array['cash_mesas', 'cash_mesa_jogadores', 'cash_mesa_recolhimentos'] loop
    begin
      execute format('alter publication supabase_realtime add table public.%I', t);
    exception when duplicate_object then null;
    end;
  end loop;
end $$;

notify pgrst, 'reload schema';
