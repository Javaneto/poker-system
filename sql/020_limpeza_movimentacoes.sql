-- Rodar uma vez no Supabase: SQL Editor > New query > colar > Run.
--
-- Limpeza: remove de movimentacoes três colunas que não são mais usadas.
--   nome      — vazia em todas as linhas
--   cpf       — cópia antiga do cadastro do jogador (não é mais gravada)
--   telefone  — idem
-- Antes de remover, copia para o cadastro (jogadores) o CPF/telefone que só
-- existia na cópia (o lançamento mais recente de cada jogador). Nenhum valor,
-- tipo, data ou sessão de movimentação é alterado. Pode ser rodado de novo.

do $mig$
begin

  if exists (select 1 from information_schema.columns
             where table_schema = 'public' and table_name = 'movimentacoes' and column_name = 'cpf') then
    update public.jogadores j
       set cpf = x.cpf
      from (select distinct on (jogador_id) jogador_id, cpf
              from public.movimentacoes
             where coalesce(cpf, '') <> '' and jogador_id is not null
             order by jogador_id, data desc nulls last, id desc) x
     where x.jogador_id = j.id
       and coalesce(j.cpf, '') = '';
  end if;

  if exists (select 1 from information_schema.columns
             where table_schema = 'public' and table_name = 'movimentacoes' and column_name = 'telefone') then
    update public.jogadores j
       set telefone = x.telefone
      from (select distinct on (jogador_id) jogador_id, telefone
              from public.movimentacoes
             where coalesce(telefone, '') <> '' and jogador_id is not null
             order by jogador_id, data desc nulls last, id desc) x
     where x.jogador_id = j.id
       and coalesce(j.telefone, '') = '';
  end if;

  alter table public.movimentacoes
    drop column if exists nome,
    drop column if exists cpf,
    drop column if exists telefone;

end $mig$;

notify pgrst, 'reload schema';
