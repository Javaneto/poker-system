# PLAN.md — Reconstrução do sistema de gestão de clube de poker

Decisões tomadas: **Vite + React + TypeScript + Supabase**, **multi-clube desde o início**,
**banco novo com migração dos dados do legado**, **conta única do jogador + Caixa do Dia**.
Regras de arquitetura e comandos: ver `CLAUDE.md`.

---

## Regras de negócio (extraídas do legado + referências)

### Jogador
- Cadastro: nome (único no clube, sem diferenciar maiúsculas), apelido, telefone, CPF
  (único no clube quando informado), e-mail, data de nascimento, observação, ativo.
- Inativo não aparece nas buscas de cash/torneio, mas mantém histórico. Jogador com
  lançamentos não pode ser excluído, só inativado.
- Renomear não pode quebrar o histórico (no novo modelo é automático: tudo liga por `player_id`).

### Conta do jogador (ledger unificado — cash + torneio + bar juntos)
Tipos de lançamento e efeito no **resultado** (positivo = clube deve ao jogador;
negativo = jogador deve ao clube):
| Tipo | Origem | Efeito |
|---|---|---|
| `buy_in` (Entrada cash) | ficha comprada no cash | se **não pago na hora**: −valor; se pago na hora: 0 (só registra) |
| `tournament_entry` (Registro/Rebuy/Add-on) | torneio | igual ao acima (pago na hora ou fiado) |
| `cash_out` (Saída) | jogador devolve fichas no cash | +valor |
| `payment_in` (Pagamento) | jogador paga o que deve | +valor (abate dívida) |
| `payout` (prêmio/pagamento ao jogador) | clube paga o jogador | −valor (abate crédito) |
| `bar_charge` | comanda fechada como fiado | −valor |
| `reversal` | estorno de qualquer lançamento | inverso do original |
- Legado: resultado = Saídas − (Entradas não pagas − Pagamentos). Reproduzir e testar
  com os mesmos números antes de migrar.
- **Sessão:** lançamentos ficam "em aberto" até "Finalizar sessão" (por jogador ou
  "Finalizar todos"). Finalizar agrupa os lançamentos com o mesmo carimbo de sessão.
  Sessão com resultado < 0 = pendente (fiado); = 0 = realizado; > 0 = crédito.
- Uma sessão finalizada pode ser **reaberta** (correção de fechamento) — auditado.
- "Finalizar todos" precisa operar sobre o estado atual do banco (RPC), não sobre a lista da tela.
- Pagamento pode ter **observação**. Recibo imprimível em impressora térmica 80 mm.

### Caixa do Dia (novo, do ChipControl)
- Abrir caixa (valor inicial), registrar sangria (retirada) e suprimento (reforço),
  fechar caixa com valor contado → diferença.
- Todo lançamento com dinheiro real tem `payment_method` (dinheiro, PIX, cartão, fiado…)
  e fica vinculado à sessão de caixa aberta. Fiado não entra no caixa.
- Só pode haver um caixa aberto por clube.

### Cash game
- Mesa com nome, botton/blinds, limite de jogadores (opcional), status aberta/encerrada.
- Lançamentos de rake e capilé (gorjeta dos dealers) e despesas da mesa.
- Conferência: compras − devoluções − rake − capilé = fichas na mesa; só encerra com 0
  e sem jogadores sentados.

### Torneio
- Nome padrão sequencial "<Clube> #N". Status: agendado → aberto → em andamento → encerrado.
- Encerrado: não aceita lançamentos nem mudança de configuração; o diretor **permanece**
  na tela do torneio; pode ser excluído só se não tiver lançamentos.
- **Tipos de entrada** (ativáveis por clube): Buy-in, Buy-in Free, Rebuy, Duplo, Triplo,
  Add-on, Bounty (K.O.). Duplo/Triplo geram variantes de Buy-in e de Rebuy.
  Cada tipo: valor total, rake, fichas, valor para o prêmio = total − rake (− bounty).
- **Buy-in Free** pode ter valor zero; ativação é explícita (não depende do valor).
- Bounty: valor descontado do prêmio a cada Registro/Rebuy.
- Jogador só se registra uma vez por torneio; Rebuy e Add-on só para registrados.
- Limites (do AceKing): nível máximo para inscrição e rebuy ("inscrições até o nível N"),
  máximo de rebuys por jogador, mínimo de 2 jogadores para iniciar.
- Ao lançar Add-on, mostrar **Total a pagar = resultado em aberto do jogador + add-on**.
- Ajuste manual do prêmio (+/−) registrado e auditado. Prêmio garantido (GTD) opcional.
- Classificação final (posição) usada no ranking.

### Relógio e blinds
- Estrutura de blinds: lista de níveis {sb, bb, ante, duração (min), intervalo após (min)}.
  Editor sugere o próximo nível (BB×2, SB=BB/2, ante=BB) e valida (SB<BB, crescente, sem zeros).
- Estado no torneio: nível atual, segundos restantes, iniciado em, rodando, em intervalo,
  intervalo avança nível?, segundos antes do intervalo, tempo decorrido acumulado.
- Restante = base − (agora − iniciado_em) quando rodando. Ao zerar: se há intervalo após
  o nível → entra em intervalo e depois avança; senão avança direto.
- Intervalo manual pausa o nível e retoma de onde parou. Intervalo automático a cada X níveis
  (opcional) e "pausar após intervalo".
- Tela pública (TV): nível, relógio, blinds atuais, próximos blinds/ante, tempo até o
  intervalo, entradas, média de fichas, bounty, prêmio total, prêmios por posição,
  tela cheia, layout em pé/deitado.

### Premiação
- Estruturas por % de posição (ex.: 50/30/20). Valores arredondados para múltiplo
  configurável: arredonda para cima se a fração ≥ 0,6 da unidade, carregando a sobra
  para a próxima posição; a sobra final é somada à **última** posição paga
  (assim a soma dos prêmios é sempre igual ao prêmio total).
- Modelos prontos (do AceKing): Winner Takes All, 50-30-20, 60-30-10, Double Up etc.,
  % máxima de posições pagas.

### Rake e relatórios
- Rake por lançamento de torneio (`rake_cents`) e por mesa de cash; rake acumulado sempre visível.
- Relatório do torneio: arrecadado, rake (% do arrecadado), prêmio, bounty, não pago,
  por tipo e por jogador, conferência rake + prêmio + bounty = arrecadado, PDF.
- Relatórios do clube por período, módulo e forma de pagamento; fiado em aberto; sessões de caixa.

### Ranking (definido pelo cliente)
- Pontos do torneio: `total = base + por_jogador × nº_jogadores + ajuste_manual_do_torneio`.
- Distribuição por % da posição (configurável) + pontos de participação (opcional).
- Ajuste manual por jogador (+/−, com motivo). Vários rankings (temporadas).
- Desempate: pontos → vitórias → melhor colocação → nome. Pódio, tela cheia/TV, link público.

### Bar (do ChipControl)
- Produtos (categoria, preço, custo, estoque, mínimo, margem), comandas por jogador;
  ao fechar: recebe no caixa ou vira fiado na conta do jogador. Baixa de estoque.

### Auditoria
- Log de toda inclusão/alteração/estorno com usuário e data; filtros; "restaurar" =
  novo lançamento, nunca reescrever o passado.

### Problemas do legado que **não** devem se repetir
- Nome do jogador como chave em lançamentos (CPF/telefone duplicados em cada linha).
- `DELETE` físico para desfazer (perda de histórico).
- Páginas HTML gigantes com lógica duplicada entre arquivos.
- Operações de vários passos no cliente sem transação.
- Consultas sem paginação (limite de 1000 linhas escondia dados).
- `configuracoes.id = 1` global e "torneio atual" único (não serve para multi-clube).
- Valores em `numeric`/float e strings mágicas de tipo (`'Saída'`, `'Buy-in Duplo'`).
- Relógio avançado por qualquer tela aberta sem controle de concorrência.

---

## Fase 0 — Decisões e preparação
- [ ] Criar repositório novo (ex.: `poker-club-app`) e copiar `CLAUDE.md` e `PLAN.md`.
- [ ] Criar projetos Supabase `dev` e `prod` (novos, separados do legado).
- [ ] Exportar o esquema e uma cópia dos dados do banco legado para `scripts/migrate-legacy/fixtures/`.
- [ ] Levantar com o cliente os números de 3 sessões reais (cash e torneio) para usar como casos de teste.

## Fase 1 — Setup do projeto
- [ ] Vite + React + TS strict + pnpm; aliases `@/`.
- [ ] Tailwind + tema (tokens de cor, modo escuro) + componentes base em `components/ui` (Button, Input, Select, Modal/BottomSheet, Table, Toast, Tabs, Badge).
- [ ] ESLint, Prettier, Husky + lint-staged.
- [ ] Vitest + Testing Library; Playwright com 1 teste de fumaça.
- [ ] Supabase CLI (`supabase init`), `.env.example` com `VITE_SUPABASE_URL`/`VITE_SUPABASE_ANON_KEY`.
- [ ] `lib/supabase.ts`, `lib/money.ts` (centavos ↔ BRL), `lib/dates.ts` (fuso São Paulo).
- [ ] CI (GitHub Actions): typecheck, lint, test, build em cada PR.
- [ ] Deploy de preview automático.

## Fase 2 — Banco de dados base e multi-clube
- [ ] Migration: `clubs`, `club_members (club_id, user_id, role)`, `profiles`.
- [ ] Funções `is_club_member(club_id)`, `has_club_role(club_id, roles[])`.
- [ ] Gatilho genérico `audit_log` (tabela, operação, antes/depois, user, club).
- [ ] Política RLS padrão aplicada a todas as tabelas; teste pgTAP que falha se alguma tabela ficar sem RLS.
- [ ] `club_settings` (moeda, fuso, tipos de entrada ativos, impressora, PIX).
- [ ] Seed de desenvolvimento (1 clube, 3 usuários com papéis, 20 jogadores).
- [ ] Geração de tipos e teste de RLS: membro do clube A não lê dados do clube B.

## Fase 3 — Autenticação e clubes
- [ ] Login/logout com e-mail e senha (Supabase Auth), recuperação de senha.
- [ ] Criar clube (onboarding) e trocar de clube ativo.
- [ ] Convidar membro e definir papel; tela de usuários do clube.
- [ ] Rotas protegidas por sessão e por papel; layout com menu lateral (desktop) e inferior/gaveta (celular).
- [ ] 2FA opcional (TOTP do Supabase).

## Fase 4 — Jogadores
- [ ] Migration `players` (+ índices únicos por clube em nome normalizado e CPF).
- [ ] Lista com busca (nome, apelido, telefone, CPF), filtros (em jogo, devendo, crédito, inativos), ordenação, paginação.
- [ ] Cadastro/edição com validação Zod; inativar/reativar; excluir só sem lançamentos (RPC).
- [ ] Ficha do jogador: dados, saldo geral, saldo em aberto, histórico paginado.
- [ ] Aniversariantes dos próximos 30 dias.
- [ ] Testes de componentes e de RLS.

## Fase 5 — Conta do jogador (ledger) e sessões
- [ ] Migration `ledger_entries` (player_id, kind enum, amount_cents, paid_upfront, payment_method, cash_session_id, tournament_id, table_id, session_id, reverses_id, note, created_by).
- [ ] `player_sessions` (aberta/finalizada, finalizada em/por, reaberta).
- [ ] `domain/result.ts`: cálculo do resultado com testes reproduzindo o legado.
- [ ] RPCs: `record_entry`, `record_payment`, `record_cash_out`, `reverse_entry`, `close_player_session`, `close_all_sessions`, `reopen_session` (transacionais, auditadas).
- [ ] Tela "Movimentações em aberto" (todos os jogadores, cash + torneio) em tempo real, com busca.
- [ ] Histórico de sessões finalizadas com status (pendente/realizado/crédito).
- [ ] Registrar pagamento com observação; recibo térmico 80 mm.
- [ ] Central "Desfazer / Log": em aberto, sessões finalizadas (reabrir), log com filtros.

## Fase 6 — Caixa do Dia
- [ ] Migration `cash_sessions`, `cash_movements` (sangria, suprimento), `payment_methods` por clube.
- [ ] RPCs `open_cash_session`, `withdraw`, `deposit`, `close_cash_session` (valor contado, diferença).
- [ ] Vincular lançamentos com dinheiro real ao caixa aberto; bloquear se não houver caixa aberto (configurável).
- [ ] Tela do caixa: saldo esperado, movimentações da sessão, histórico de sessões, exportar PDF.

## Fase 7 — Cash game
- [ ] Migration `cash_tables` (+ rake, capilé, despesas como lançamentos da mesa).
- [ ] Abrir mesa, sentar jogador, compras/devoluções (usam o ledger), tempo de mesa.
- [ ] Conferência de fichas e encerramento (só com 0 e sem jogadores).
- [ ] Tela de mesa otimizada para celular.

## Fase 8 — Torneios: cadastro e inscrições
- [ ] Migrations `tournaments`, `tournament_entry_types` (tipo enum, valor, rake, fichas, bounty, ativo), `tournament_entries` (ligadas ao ledger), `tournament_tables`.
- [ ] Criar torneio em etapas (informações → tipos de entrada → blinds → premiação) com nome sequencial; perfis de configuração reaproveitáveis.
- [ ] Inscrição/rebuy/add-on com validações (já registrado, só registrados, nível limite, máximo de rebuys, Buy-in Free sem valor).
- [ ] Total a pagar no add-on; bounty; ajuste de prêmio; prêmio garantido.
- [ ] Encerrar (RPC) mantendo o diretor na tela; excluir só sem lançamentos.

## Fase 9 — Blinds, relógio e tela pública
- [ ] Migration `blind_structures` (níveis em tabela própria `blind_levels`).
- [ ] Editor de estrutura com sugestão automática e validação.
- [ ] `domain/clock.ts`: restante, decorrido, próximo intervalo (testes com tempo fixo).
- [ ] RPCs `clock_start`, `clock_pause`, `clock_advance` (idempotente com versão), `clock_break_start/end`, `clock_edit`.
- [ ] Painel do diretor (relógio + ações + estatísticas: jogadores, entradas, média de fichas, prêmio, rake acumulado).
- [ ] Mini relógio fixo no celular.
- [ ] Tela pública/TV por código ou link (sem login, só dados do torneio): tela cheia, layout em pé/deitado, voz opcional na troca de nível.

## Fase 10 — Premiação e classificação
- [ ] `prize_structures` (percentuais) + modelos prontos.
- [ ] `domain/prizes.ts`: arredondamento com sobra (regra do legado) — testes com casos reais.
- [ ] Publicar premiação no timer; distribuir prêmios (lança `payout` no ledger).
- [ ] Classificação final (posição) com validação de posições repetidas.
- [ ] Checklist de fechamento (prêmios pagos, nada pendente, rake conferido) antes de encerrar.

## Fase 11 — Rake e relatórios
- [ ] Relatório do torneio (totais, por tipo, por jogador, conferência) + PDF.
- [ ] Relatórios do clube: por período, módulo, forma de pagamento; fiado em aberto; sessões de caixa; rake por mês.
- [ ] Dashboard inicial: torneios ativos, mesas abertas, comandas, caixa, fiado, aniversariantes.

## Fase 12 — Ranking
- [ ] Migrations `rankings`, `ranking_tournaments (ajuste)`, `ranking_adjustments`.
- [ ] `domain/ranking.ts` com a fórmula do cliente e desempate — testes.
- [ ] Tela de ranking: configurar (prévia de pontos), vincular torneios, ajustes, pódio, detalhe por jogador, tela cheia.
- [ ] Link público somente leitura (sem dados pessoais).
- [ ] Estatísticas do jogador (jogos, vitórias, ITM, rebuys, lucro).

## Fase 13 — Bar
- [ ] Migrations `products`, `product_categories`, `bar_tabs`, `bar_tab_items`, `stock_movements`.
- [ ] Catálogo com estoque mínimo e margem; comanda por jogador; fechar (caixa ou fiado no ledger).
- [ ] Relatório do bar.

## Fase 14 — Migração do legado e corte
- [ ] Script `scripts/migrate-legacy`: jogadores (deduplicar por nome/CPF) → `players`.
- [ ] Movimentações → `ledger_entries` mapeando tipos (`Entrada`, `Saída`, `Pagamento`, `Registro`, `Rebuy`, `Add-on`, `pago`, `sessao_finalizada_em` → sessões); valores para centavos.
- [ ] Torneios, valores, estruturas de blinds/premiação, classificações e rankings.
- [ ] Relatório de conferência: saldo de cada jogador no legado = saldo no novo (diferença zero).
- [ ] Ensaio de migração em `dev`, validação com o cliente, migração final em `prod`, legado em modo somente leitura.

## Fase 15 — Polimento e SaaS
- [ ] Testes E2E dos fluxos críticos (cash completo, torneio completo, fechamento de caixa).
- [ ] Revisão de acessibilidade e celular (375px) em todas as telas.
- [ ] Planos/cobrança e onboarding de novos clubes (se for vender).
- [ ] Backup, monitoramento de erros e documentação de uso.
