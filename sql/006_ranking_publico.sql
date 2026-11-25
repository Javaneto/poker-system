-- Rodar uma vez no Supabase: SQL Editor > New query > colar > Run.
--
-- 1) Pontos por participar em pontos fixos ou em % do total do torneio.
-- 2) Link público do Ranking (só leitura, sem login).
--
-- Segurança do link público:
--   - As tabelas continuam fechadas: só usuários logados leem/escrevem (RLS).
--   - Quem abre o link só consegue chamar a função ranking_publico(token),
--     que devolve UM ranking, e só se o token (código secreto e aleatório do
--     link) bater. Sem o link certo não há como descobrir os outros.
--   - A função devolve apenas o necessário para o placar: nome do ranking,
--     regras de pontos, nome dos torneios e nome/colocação dos jogadores.
--     Nada de CPF, telefone, valores em dinheiro ou motivo de ajustes.
--   - Desativar o link apaga o token: o link antigo para de funcionar na hora.

alter table public.rankings
  add column if not exists participacao_tipo text not null default 'pontos'
    check (participacao_tipo in ('pontos', 'percentual')),
  add column if not exists token_publico uuid unique;

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
      select jsonb_agg(jsonb_build_object('torneio_id', v.torneio_id, 'ajuste_pontos', v.ajuste_pontos))
      from ranking_torneios v
      where v.ranking_id = r.id
    ), '[]'::jsonb),
    'resultados', coalesce((
      select jsonb_agg(jsonb_build_object('torneio_id', tr.torneio_id, 'jogador', tr.jogador, 'posicao', tr.posicao))
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
      where t.id::text in (select v.torneio_id from ranking_torneios v where v.ranking_id = r.id)
    ), '[]'::jsonb)
  )
  from rankings r
  where p_token is not null and r.token_publico = p_token;
$$;

revoke all on function public.ranking_publico(uuid) from public;
grant execute on function public.ranking_publico(uuid) to anon, authenticated;

-- Faz a API do Supabase enxergar as mudanças na hora.
notify pgrst, 'reload schema';
