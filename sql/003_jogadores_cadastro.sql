-- Rodar uma vez no Supabase: SQL Editor > New query > colar > Run.
-- Campos novos para a área "Jogadores" (gerenciar cadastro).

alter table public.jogadores
  add column if not exists ativo boolean not null default true,
  add column if not exists apelido text,
  add column if not exists email text,
  add column if not exists data_nascimento date,
  add column if not exists observacao text,
  add column if not exists criado_em timestamptz default now();
