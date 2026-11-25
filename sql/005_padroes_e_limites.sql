-- Rodar uma vez no Supabase: SQL Editor > New query > colar > Run.
--
-- Estruturas de Torneio (padrões) e limites por jogador:
--   configuracoes.padrao_torneio - o que vem pré-selecionado ao criar um torneio:
--       { premiacao_estrutura_id, arredondamento_premiacao,
--         estrutura_blinds_id, limite_rebuy, limite_addon }
--   torneios.limite_rebuy        - máximo de rebuys por jogador (vazio = sem limite)
--   torneios.limite_addon        - máximo de add-ons por jogador (vazio = sem limite)

alter table public.configuracoes
  add column if not exists padrao_torneio jsonb not null default '{}'::jsonb;

alter table public.torneios
  add column if not exists limite_rebuy int check (limite_rebuy is null or limite_rebuy >= 0),
  add column if not exists limite_addon int check (limite_addon is null or limite_addon >= 0);

-- Faz a API do Supabase enxergar as colunas novas na hora.
notify pgrst, 'reload schema';
