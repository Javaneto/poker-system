-- Rodar uma vez no Supabase: SQL Editor > New query > colar > Run.
--
-- Cash Game: permite registrar retirada de fichas para o Jackpot,
-- além de rake e caixinha.

alter table public.cash_mesa_recolhimentos
  drop constraint if exists cash_mesa_recolhimentos_tipo_check;

alter table public.cash_mesa_recolhimentos
  add constraint cash_mesa_recolhimentos_tipo_check
  check (tipo in ('rake', 'caixinha', 'jackpot'));
