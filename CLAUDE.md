# CLAUDE.md — Sistema de Gestão de Clube de Poker (reconstrução)

Guia obrigatório para todas as sessões. O plano de execução está em `PLAN.md`;
siga a fase atual e marque `[x]` ao concluir cada tarefa.

## Contexto
- Reconstrução do zero do sistema legado (HTML/JS puro em `poker-system/`) como
  **SaaS multi-clube**. O legado é **referência de regras de negócio, não de código**:
  nunca copie arquivos, estrutura ou padrões dele.
- Referências de produto: ChipControl (gestão do clube, caixa, bar, relatórios) e
  AceKing TD (torneio, relógio, liga, ranking, estatísticas).
- Idioma: UI, mensagens e documentação em **português (pt-BR)**; código
  (identificadores, arquivos, commits) em **inglês**. Moeda BRL, fuso `America/Sao_Paulo`.

## Stack (decidida — não trocar sem perguntar)
- **Frontend:** Vite + React 18 + TypeScript (strict) + React Router.
- **UI:** Tailwind CSS + componentes próprios em `src/components/ui` (estilo shadcn/ui).
- **Dados no cliente:** TanStack Query (cache/servidor) + Zustand só para estado de UI.
- **Formulários/validação:** React Hook Form + Zod (schemas Zod são a fonte dos tipos de entrada).
- **Backend:** Supabase (Postgres, Auth, Realtime, Storage, Edge Functions quando preciso).
- **Testes:** Vitest + Testing Library (unitário/componente), Playwright (E2E), pgTAP ou
  testes SQL via Supabase CLI para RLS e funções.
- **Qualidade:** ESLint + Prettier; Husky + lint-staged no pre-commit.
- **Gerenciador:** pnpm. Node 20 LTS.
- **Deploy:** hospedagem estática (Vercel ou GitHub Pages) + projeto Supabase separado por ambiente (dev/prod).

## Comandos
```
pnpm install              # dependências
pnpm dev                  # servidor local (Vite)
pnpm build                # build de produção (tsc --noEmit + vite build)
pnpm lint                 # ESLint
pnpm typecheck            # tsc --noEmit
pnpm test                 # Vitest
pnpm test:e2e             # Playwright
supabase start            # banco local (Docker)
supabase db reset         # recria o banco local aplicando migrations + seed
supabase migration new <nome>
supabase gen types typescript --local > src/lib/database.types.ts
supabase test db          # testes de banco (RLS, funções)
```
Antes de dizer que uma tarefa terminou: `pnpm typecheck && pnpm lint && pnpm test` passando.

## Arquitetura
```
src/
  app/            # rotas, layout, providers (QueryClient, Auth, Club)
  features/<módulo>/
    api/          # queries/mutations (TanStack Query) — único lugar que chama o Supabase
    components/   # componentes do módulo
    domain/       # regras puras (cálculos), sem React nem Supabase, 100% testadas
    schemas.ts    # Zod
    routes.tsx
  components/ui/  # botões, modal, tabela, inputs (sem regra de negócio)
  lib/            # supabase client, database.types.ts, formatação, datas, dinheiro
supabase/
  migrations/     # SQL versionado (única forma de mudar o banco)
  seed.sql        # dados de desenvolvimento
  tests/          # testes de RLS e funções
scripts/migrate-legacy/  # importação do banco antigo
```
Módulos (`features/`): `auth`, `clubs`, `players`, `ledger` (conta do jogador),
`cash-register` (caixa do dia), `cash-game`, `tournaments`, `clock`, `blinds`,
`prizes`, `bar`, `rankings`, `reports`, `audit`, `settings`.

## Regras de arquitetura (obrigatórias)
1. **Multi-clube:** toda tabela de negócio tem `club_id uuid not null`. RLS ligado em
   **todas** as tabelas, filtrando por pertencer ao clube (`is_club_member(club_id)`).
   Nenhuma consulta confia em filtro feito só no cliente.
2. **Chaves:** `id uuid default gen_random_uuid()`. Relacionar sempre por id
   (`player_id`, `tournament_id`) — **nunca por nome** (erro do legado).
3. **Dinheiro:** colunas `bigint` em **centavos** (`amount_cents`). Nunca float.
   Formatação só na UI via `lib/money.ts`.
4. **Ledger imutável:** lançamentos financeiros nunca sofrem UPDATE/DELETE de valor.
   Desfazer = lançamento de **estorno** ligado ao original (`reverses_id`). Correções
   ficam auditáveis.
5. **Operações com mais de um passo** (fechar sessão, encerrar torneio, renomear,
   distribuir prêmio, avançar nível) são **funções Postgres (RPC) transacionais**,
   não sequências de chamadas no cliente.
6. **Relógio do torneio:** o estado fica no banco (`started_at`, `remaining_seconds`,
   `level_index`, flags de intervalo). O cliente só calcula a exibição. Avanço de nível
   via RPC idempotente com checagem de versão (evita duas telas avançarem juntas).
7. **Realtime:** assinaturas por `club_id`; ao receber evento, invalidar a query do
   TanStack Query (não recarregar tudo). Reconectar e revalidar ao voltar para a aba.
   Listas grandes sempre paginadas (o PostgREST limita 1000 linhas).
8. **Domínio puro:** cálculos (resultado do jogador, rake, premiação arredondada,
   pontos de ranking, tempo do relógio) vivem em `features/*/domain` como funções puras
   com testes unitários cobrindo os casos do `PLAN.md`.
9. **Auditoria:** gatilho genérico grava INSERT/UPDATE/DELETE em `audit_log`
   (antes/depois, usuário, clube). Toda ação sensível aparece no Log.
10. **Permissões por papel no clube:** `owner`, `manager`, `cashier`, `dealer`/`director`,
    checadas na RLS e na UI.
11. **Segredos:** só a `anon key` no frontend (via `.env`, `VITE_SUPABASE_*`).
    `service_role` apenas em Edge Functions/scripts, nunca no repositório.

## Padrões de código
- TypeScript strict; proibido `any` (use `unknown` + Zod). Tipos do banco gerados, não escritos à mão.
- Componentes funcionais, um por arquivo, `PascalCase.tsx`; hooks `useAlgo.ts`; demais `camelCase.ts`.
- Banco em `snake_case` inglês; TS em `camelCase` (converter na camada `api/`).
- Sem lógica de negócio em componentes: componente → hook (`api/`) → RPC/tabela.
- Erros: mostrar mensagem amigável em pt-BR (toast) e logar o detalhe; nunca falhar em silêncio.
- Acessibilidade e celular primeiro: layout testado em 375px, alvos de toque ≥ 40px,
  inputs com fonte ≥ 16px, modais como bottom sheet no celular.
- Telas públicas (TV do torneio, ranking público) sem dados pessoais.

## Convenções de trabalho
- Uma fase do `PLAN.md` por vez; tarefas pequenas, cada uma com teste.
- Mudança de banco = nova migration (nunca editar migration já aplicada) + regenerar tipos.
- Commits em inglês, Conventional Commits (`feat(tournaments): ...`), um assunto por commit.
- Branch por fase (`phase-3-players`); PR com checklist da fase.
- Na dúvida sobre regra de negócio, consultar a seção "Regras de negócio" do `PLAN.md`;
  se não estiver lá, **perguntar** antes de implementar.
