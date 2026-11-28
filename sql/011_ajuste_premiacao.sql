-- Rodar uma vez no Supabase: SQL Editor > New query > colar > Run.
--
-- Diretor > Ajustar Prêmio:
--   * histórico de cada ajuste (+/-) do prêmio total, com observação;
--   * premiação por posição editada à mão (valor e texto opcional, ex.:
--     "Bilhete" + R$ 100). Vazia = segue a estrutura de premiação;
--   * ao encerrar o torneio, os prêmios são lançados no Em Aberto de cada
--     jogador premiado (abre a comanda se ele não tiver uma aberta).

-- Premiação manual: lista na ordem das posições, ex.:
--   [{"valor": 500, "texto": null}, {"valor": 100, "texto": "Bilhete"}]
alter table public.torneios
  add column if not exists premiacao_manual jsonb;

-- Quando os prêmios foram lançados no Em Aberto (evita pagar duas vezes).
alter table public.torneios
  add column if not exists premios_pagos_em timestamptz;

-- Histórico dos ajustes do prêmio total.
create table if not exists public.torneio_premiacao_ajustes (
  id          bigint generated always as identity primary key,
  torneio_id  text        not null,
  valor       numeric     not null check (valor <> 0),
  observacao  text,
  criado_em   timestamptz not null default now()
);

create index if not exists torneio_premiacao_ajustes_torneio_idx
  on public.torneio_premiacao_ajustes (torneio_id, criado_em);

alter table public.torneio_premiacao_ajustes enable row level security;
drop policy if exists "acesso autenticados" on public.torneio_premiacao_ajustes;
create policy "acesso autenticados" on public.torneio_premiacao_ajustes
  for all to authenticated using (true) with check (true);

-- Log automático (sql/002).
drop trigger if exists log_torneio_premiacao_ajustes on public.torneio_premiacao_ajustes;
create trigger log_torneio_premiacao_ajustes
  after insert or update or delete on public.torneio_premiacao_ajustes
  for each row execute function public.registrar_log_alteracao();

-- Ajuste do prêmio total: grava o histórico e soma no torneio na mesma
-- transação (duas telas ajustando juntas não perdem valor).
-- p_alterar_manual = true troca também a premiação manual (ex.: "premiar a
-- próxima posição" com o valor adicionado).
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
  values (p_torneio_id, p_valor, nullif(trim(p_observacao), ''))
  returning id into v_id;

  return v_id;
end;
$$;

-- Desfaz um ajuste: apaga do histórico (fica no Log) e tira do torneio.
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
   where id::text = v_ajuste.torneio_id
     and coalesce(status, '') <> 'encerrado';

  if not found then
    raise exception 'Torneio não encontrado ou já encerrado';
  end if;
end;
$$;

-- Encerra o torneio e lança os prêmios no Em Aberto, tudo junto.
-- p_pagamentos: linhas de movimentacoes (jogador, tipo, valor, ...) já
-- montadas pelo Diretor. Só paga uma vez (premios_pagos_em).
create or replace function public.encerrar_torneio_com_premios(
  p_torneio_id text,
  p_pagamentos jsonb default '[]'::jsonb
)
returns integer
language plpgsql
set search_path = public
as $$
declare
  v_qtd integer := 0;
begin
  update torneios
     set status = 'encerrado',
         premios_pagos_em = now()
   where id::text = p_torneio_id
     and coalesce(status, '') <> 'encerrado'
     and premios_pagos_em is null;

  if not found then
    raise exception 'Torneio não encontrado ou já encerrado';
  end if;

  insert into movimentacoes
    (jogador, tipo, valor, modalidade, tipo_registro, torneio_id, pago, data, cpf, telefone, observacao)
  select m.jogador, m.tipo, m.valor, m.modalidade, m.tipo_registro, m.torneio_id,
         coalesce(m.pago, false), coalesce(m.data, now()), m.cpf, m.telefone, m.observacao
    from jsonb_populate_recordset(null::movimentacoes, coalesce(p_pagamentos, '[]'::jsonb)) m
   where m.valor > 0;

  get diagnostics v_qtd = row_count;

  return v_qtd;
end;
$$;

grant execute on function public.registrar_ajuste_premiacao(text, numeric, text, boolean, jsonb) to authenticated;
grant execute on function public.desfazer_ajuste_premiacao(bigint) to authenticated;
grant execute on function public.encerrar_torneio_com_premios(text, jsonb) to authenticated;

-- Atualização em tempo real nas páginas.
do $$
begin
  alter publication supabase_realtime add table public.torneio_premiacao_ajustes;
exception when duplicate_object then null;
end $$;

notify pgrst, 'reload schema';
