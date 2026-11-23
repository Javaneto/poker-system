-- Rodar uma vez no Supabase: SQL Editor > New query > colar > Run.
-- Adiciona o campo de observação usado em "Registrar Pagamento".
alter table public.movimentacoes
  add column if not exists observacao text;
