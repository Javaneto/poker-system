-- Rodar uma vez no Supabase: SQL Editor > New query > colar > Run.
--
-- Torneio: montante de fichas de cada tipo de entrada (Buy-in, Rebuy,
-- Add-on...). Usado para calcular o Chip Count (total de fichas em jogo)
-- e o Avg Stack (Chip Count ÷ jogadores ainda no torneio) no Diretor e
-- na Tela da TV.

alter table public.torneio_valores
  add column if not exists fichas integer not null default 0 check (fichas >= 0);
