-- Rodar uma vez no Supabase: SQL Editor > New query > colar > Run.
--
-- Corrige o "Erro ao encerrar torneio" (sql/011): a função completava
-- data e pago com coalesce(..., now()) / coalesce(..., false). Se a coluna
-- da tabela antiga de movimentações não for exatamente desse tipo (ex.:
-- data guardada como texto), o Postgres recusa a conta e nada é encerrado.
-- Agora os valores vão como o Diretor manda (ele sempre envia data e pago),
-- convertidos pelo próprio tipo de cada coluna da tabela.

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

  if jsonb_typeof(p_pagamentos) = 'array' and jsonb_array_length(p_pagamentos) > 0 then

    insert into movimentacoes
      (jogador, tipo, valor, modalidade, tipo_registro, torneio_id, pago, data, cpf, telefone, observacao)
    select m.jogador, m.tipo, m.valor, m.modalidade, m.tipo_registro, m.torneio_id,
           m.pago, m.data, m.cpf, m.telefone, m.observacao
      from jsonb_populate_recordset(null::movimentacoes, p_pagamentos) m
     where m.valor > 0;

    get diagnostics v_qtd = row_count;
  end if;

  return v_qtd;
end;
$$;

grant execute on function public.encerrar_torneio_com_premios(text, jsonb) to authenticated;

notify pgrst, 'reload schema';
