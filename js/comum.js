/*
 * Funções compartilhadas entre as páginas (cash game, diretor, jogadores).
 *
 * Usa as variáveis/funções globais que cada página já define:
 *   client, escapeHtml, mostrarAlerta, mostrarConfirm
 */

// ---------------------------------------------------------------------------
// Consultas sem o limite de 1000 linhas do Supabase
// ---------------------------------------------------------------------------

// montarConsulta: () => client.from(...).select(...)... (sem .range)
// Busca página por página até acabar. Sempre ordene a consulta por um
// campo único (ex.: id) para a paginação não pular nem repetir linhas.
async function buscarTodas(montarConsulta, tamanhoPagina = 1000) {

  const todas = [];
  let inicio = 0;

  while (true) {

    const { data, error } = await montarConsulta().range(inicio, inicio + tamanhoPagina - 1);

    if (error) throw error;

    todas.push(...(data || []));

    if (!data || data.length < tamanhoPagina) break;

    inicio += tamanhoPagina;
  }

  return todas;
}

// Colunas de movimentacoes que as telas usam (economia de tráfego).
// CPF e telefone ficam só no cadastro do jogador (sql/020 removeu as cópias).
const COLUNAS_MOV = 'id,jogador,jogador_id,tipo,tipo_registro,modalidade,valor,valor_prize,valor_rake,pago,data,sessao_finalizada_em,torneio_id,mesa_id,observacao';

// ---------------------------------------------------------------------------
// Recarga serializada: nunca duas cargas ao mesmo tempo
// ---------------------------------------------------------------------------
// Sem isso, duas cargas disparadas quase juntas (ex.: Realtime + clique)
// podem terminar fora de ordem e a mais antiga sobrescreve a mais nova,
// deixando a tela com valores velhos. Aqui, se chegar um pedido durante
// uma carga, roda mais uma vez no fim: a última carga é sempre a mais nova.

const estadoCargasSeriais = {};

function executarSerial(chave, funcao) {

  const estado = estadoCargasSeriais[chave] || (estadoCargasSeriais[chave] = {
    emAndamento: null,
    pendente: false
  });

  if (estado.emAndamento) {
    estado.pendente = true;
    return estado.emAndamento;
  }

  estado.emAndamento = (async () => {
    try {
      do {
        estado.pendente = false;
        try {
          await funcao();
        } catch (erro) {
          console.error('Erro ao carregar dados:', erro);
          atualizarIndicadorAoVivo('erro');
        }
      } while (estado.pendente);
    } finally {
      estado.emAndamento = null;
    }
  })();

  return estado.emAndamento;
}

// ---------------------------------------------------------------------------
// Realtime robusto
// ---------------------------------------------------------------------------
// - reconecta sozinho se o canal cair (erro, timeout, fechado);
// - recarrega ao voltar para a aba e ao reconectar a internet;
// - com a aba escondida não recarrega nada: guarda que houve mudança e
//   recarrega uma vez só quando a aba voltar (economia de tráfego);
// - garantia (aviso do Realtime perdido): recarga a cada 5 min, só com a aba
//   visível. Antes era a cada 30 s e gastava a maior parte do plano gratuito;
// - mostra um indicador "Ao vivo" / "Reconectando..." no canto da tela.

// Devolve { primeiraCarga }: promessa resolvida quando a carga completa da
// primeira conexão termina. A página pode esperar por ela em vez de fazer a
// sua própria carga inicial (senão busca tudo duas vezes ao abrir).
function iniciarRealtimeRobusto({ nome, tabelas, aoMudar, intervaloSeguranca = 300000 }) {

  let avisarPrimeiraCarga = null;
  const primeiraCarga = new Promise(resolve => { avisarPrimeiraCarga = resolve; });

  let canal = null;
  let tentativaReconexao = null;
  let debounce = null;
  let mudouEscondida = false;
  let tabelasMudadas = new Set();

  // aoMudar(tabelas): tabelas = Set com o que mudou (aviso do Realtime);
  // sem argumento = recarregar tudo (conexão, volta à aba, garantia).
  function avisarMudanca(evento) {
    if (document.visibilityState !== 'visible') {
      mudouEscondida = true;
      return;
    }
    if (evento?.table) tabelasMudadas.add(evento.table);
    clearTimeout(debounce);
    debounce = setTimeout(() => {
      console.log('Recarregando dados via Realtime');
      const tabelas = tabelasMudadas;
      tabelasMudadas = new Set();
      aoMudar(tabelas.size ? tabelas : undefined);
    }, 250);
  }

  function conectar() {

    clearTimeout(tentativaReconexao);

    // O canal novo vira o atual ANTES de remover o antigo: removeChannel avisa
    // CLOSED na hora, e se o antigo ainda fosse o atual esse aviso parecia uma
    // queda e agendava outra reconexão — um ciclo sem fim que recarregava
    // tudo a cada 3 s.
    const anterior = canal;
    const este = client.channel(`${nome}-${Date.now()}`);
    canal = este;

    if (anterior) client.removeChannel(anterior);

    tabelas.forEach(tabela => {
      canal.on('postgres_changes', { event: '*', schema: 'public', table: tabela }, avisarMudanca);
    });

    canal.subscribe(status => {

      // Canal antigo (removido ao reconectar) avisa CLOSED: ignorar,
      // senão cada reconexão agenda outra e entra em ciclo.
      if (este !== canal) return;

      console.log('Status do canal Realtime:', status);

      if (status === 'SUBSCRIBED') {
        atualizarIndicadorAoVivo('ok');
        // Recarrega ao (re)conectar: pega o que mudou enquanto estava fora.
        const carga = aoMudar();
        if (avisarPrimeiraCarga) {
          const avisar = avisarPrimeiraCarga;
          avisarPrimeiraCarga = null;
          Promise.resolve(carga).then(() => avisar(true), () => avisar(true));
        }
        return;
      }

      if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT' || status === 'CLOSED') {
        atualizarIndicadorAoVivo('reconectando');
        clearTimeout(tentativaReconexao);
        tentativaReconexao = setTimeout(conectar, 3000);
      }
    });
  }

  conectar();

  let escondidaDesde = 0;

  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState !== 'visible') {
      escondidaDesde = Date.now();
      return;
    }
    // Recarrega se algo mudou enquanto escondida ou se ficou fora mais de
    // 1 min (o Realtime pode ter caído sem avisar). Troca rápida de aba não.
    if (mudouEscondida || Date.now() - escondidaDesde > 60000) {
      mudouEscondida = false;
      aoMudar();
    }
  });

  window.addEventListener('online', () => {
    atualizarIndicadorAoVivo('reconectando');
    conectar();
  });

  window.addEventListener('offline', () => atualizarIndicadorAoVivo('offline'));

  setInterval(() => {
    if (document.visibilityState === 'visible') aoMudar();
  }, intervaloSeguranca);

  return { primeiraCarga };
}

function atualizarIndicadorAoVivo(estado) {

  let el = document.getElementById('indicadorAoVivo');

  if (!el) {
    el = document.createElement('div');
    el.id = 'indicadorAoVivo';
    el.className = 'indicador-ao-vivo';
    document.body.appendChild(el);
  }

  const textos = {
    ok: 'Ao vivo',
    reconectando: 'Reconectando...',
    offline: 'Sem internet',
    erro: 'Erro ao atualizar'
  };

  el.dataset.estado = estado;
  el.textContent = textos[estado] || estado;
  el.title = estado === 'ok'
    ? 'Os dados desta página atualizam sozinhos'
    : 'Os dados podem estar desatualizados até reconectar';
}

// ---------------------------------------------------------------------------
// Formatação
// ---------------------------------------------------------------------------

function formatarDataHora(valor) {

  if (!valor) return '-';

  return new Date(valor).toLocaleString('pt-BR', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit'
  });
}

function formatarMoeda(valor) {
  return Number(valor || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

// Texto para busca: minúsculo e sem acentos/til/cedilha ("Caião" → "caiao").
function normalizarBusca(texto) {
  return String(texto ?? '').normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();
}

// Busca de jogador usada no Cash Game, Diretor e Jogadores: nome, apelido, CPF ou
// telefone (CPF/telefone comparam só os dígitos, a partir de 3 dígitos).
// Ignora acentos e til: "Caiao" encontra "Caião".
function jogadorCombinaBusca(jogador, termo) {
  const t = normalizarBusca(termo).trim();
  if (!t) return true;
  if (normalizarBusca(jogador.nome).includes(t)) return true;
  if (normalizarBusca(jogador.apelido).includes(t)) return true;
  const digitos = t.replace(/\D/g, '');
  if (digitos.length < 3) return false;
  return String(jogador.cpf || '').replace(/\D/g, '').includes(digitos)
    || String(jogador.telefone || '').replace(/\D/g, '').includes(digitos);
}

// Ordem da busca: quem começa com o termo (nome ou apelido) vem primeiro.
function compararBuscaJogador(a, b, termo) {
  const t = normalizarBusca(termo).trim();
  const comeca = j => normalizarBusca(j.nome).startsWith(t) || normalizarBusca(j.apelido).startsWith(t);
  if (t && comeca(a) !== comeca(b)) return comeca(a) ? -1 : 1;
  return String(a.nome).localeCompare(String(b.nome));
}

// Mesmo cálculo de resultado usado nas páginas de cash game e diretor.
function calcularResultadoMovimentacoes(movs) {

  let entrada = 0;
  let entradaParaSaldo = 0;
  let saida = 0;
  let temPagamento = false;

  movs.forEach(mov => {

    if (mov.tipo === 'Entrada' || mov.tipo === 'Registro' || mov.tipo === 'Rebuy' || mov.tipo === 'Add-on') {
      entrada += Number(mov.valor);
      if (!mov.pago) entradaParaSaldo += Number(mov.valor);
    }

    if (mov.tipo === 'Saída') saida += Number(mov.valor);

    if (mov.tipo === 'Pagamento') {
      entradaParaSaldo -= Number(mov.valor);
      temPagamento = true;
    }
  });

  return { entrada, saida, temPagamento, resultado: saida - entradaParaSaldo };
}

// ---------------------------------------------------------------------------
// Ranking: pontos por torneio
// ---------------------------------------------------------------------------
// total = pontos_base + pontos_por_jogador × nº de jogadores + ajuste do torneio
// posição N recebe total × percentuais[N-1] / 100 (arredondado)
// todo participante recebe ainda pontos_participacao (fixos ou % do total)

function calcularPontosTorneio(ranking, qtdJogadores, ajuste = 0) {

  const total = Math.max(
    Number(ranking.pontos_base || 0)
      + Number(ranking.pontos_por_jogador || 0) * qtdJogadores
      + Number(ajuste || 0),
    0
  );

  const percentuais = Array.isArray(ranking.percentuais) ? ranking.percentuais : [];

  // Participação: pontos fixos, ou % do total do torneio (participacao_tipo = 'percentual').
  const participacao = ranking.participacao_tipo === 'percentual'
    ? Math.round(total * Number(ranking.pontos_participacao || 0) / 100)
    : Number(ranking.pontos_participacao || 0);

  return {
    total,
    porPosicao: percentuais.map(p => Math.round(total * Number(p || 0) / 100)),
    participacao
  };
}

// resultados: linhas de torneio_resultados (de todos os torneios do ranking)
// vinculos:   linhas de ranking_torneios do ranking
// ajustes:    linhas de ranking_ajustes do ranking
function montarClassificacaoRanking(ranking, vinculos, resultados, ajustes) {

  const porJogador = new Map();

  function linha(nome) {
    if (!porJogador.has(nome)) {
      porJogador.set(nome, {
        jogador: nome,
        pontos: 0,
        pontosTorneios: 0,
        pontosAjuste: 0,
        torneios: 0,
        vitorias: 0,
        premiados: 0,
        melhor: null,
        detalhes: []
      });
    }
    return porJogador.get(nome);
  }

  vinculos.forEach(v => {

    const doTorneio = resultados.filter(r => String(r.torneio_id) === String(v.torneio_id));

    if (doTorneio.length === 0) return;

    const calc = calcularPontosTorneio(ranking, doTorneio.length, v.ajuste_pontos);

    doTorneio.forEach(r => {

      const pontosPosicao = calc.porPosicao[r.posicao - 1] || 0;
      const pontos = pontosPosicao + calc.participacao;
      const l = linha(r.jogador);

      l.pontos += pontos;
      l.pontosTorneios += pontos;
      l.torneios += 1;
      if (r.posicao === 1) l.vitorias += 1;
      if (pontosPosicao > 0) l.premiados += 1;
      l.melhor = l.melhor === null ? r.posicao : Math.min(l.melhor, r.posicao);
      l.detalhes.push({ torneio_id: v.torneio_id, posicao: r.posicao, pontos, jogadores: doTorneio.length });
    });
  });

  ajustes.forEach(a => {
    const l = linha(a.jogador);
    l.pontos += Number(a.pontos || 0);
    l.pontosAjuste += Number(a.pontos || 0);
  });

  return Array.from(porJogador.values()).sort((a, b) =>
    b.pontos - a.pontos
    || b.vitorias - a.vitorias
    || (a.melhor ?? 999) - (b.melhor ?? 999)
    || a.jogador.localeCompare(b.jogador)
  );
}

// ---------------------------------------------------------------------------
// Central de Histórico / Log (Desfazer completo)
// ---------------------------------------------------------------------------
// Abas:
//   Em aberto  — desfazer qualquer movimentação ainda em aberto
//   Sessões    — sessões finalizadas: ver itens, reabrir sessão, desfazer item
//   Log        — tudo que foi incluído/alterado/desfeito, com quem e quando;
//                o que foi desfeito pode ser restaurado
//
// opcoes:
//   torneioId  — se informado, a aba "Em aberto" começa filtrada no torneio
//   mesaId     — idem para uma mesa de Cash Game ("Só este Cash")
//   aoAlterar  — chamada depois de qualquer alteração (para recarregar a página)

// Economia de tráfego: o Log abre só com o período escolhido (padrão: 7 dias)
// e em páginas de 30; "Ver mais" busca só a página seguinte. A busca filtra o
// que já veio, sem baixar de novo.
const TAMANHO_PAGINA_LOG = 30;
const PERIODOS_LOG = [['hoje', 'Hoje'], ['7', '7 dias'], ['30', '30 dias'], ['tudo', 'Tudo']];

const centralHistorico = {
  aba: 'abertas',
  opcoes: {},
  limiteSessoes: 30,
  periodoLog: '7',
  log: null,          // { itens, fim } do período atual; null = buscar de novo
  jogadores: null,    // id/nome para a busca nas sessões
  sessoes: []
};

function inicioPeriodoLog(periodo) {
  if (periodo === 'tudo') return null;
  const inicio = new Date();
  inicio.setHours(0, 0, 0, 0);
  if (periodo !== 'hoje') inicio.setDate(inicio.getDate() - (Number(periodo) - 1));
  return inicio;
}

function abrirCentralHistorico(opcoes = {}) {

  centralHistorico.opcoes = opcoes;
  centralHistorico.limiteSessoes = 30;
  centralHistorico.log = null;
  centralHistorico.jogadores = null;

  garantirModalCentralHistorico();

  const temFiltro = !!(opcoes.torneioId || opcoes.mesaId);
  definirFiltroCentral(temFiltro);
  document.getElementById('chFiltroTorneioTexto').textContent = opcoes.mesaId ? 'Só este Cash' : 'Só este torneio';
  document.getElementById('chFiltroTorneio').classList.toggle('oculto', !temFiltro);
  document.getElementById('chBusca').value = '';

  document.getElementById('modalCentralHistorico').classList.add('aberto');

  trocarAbaCentralHistorico('abertas');
}

function fecharCentralHistorico() {
  document.getElementById('modalCentralHistorico')?.classList.remove('aberto');
}

// Interruptor "Só este torneio / Só este Cash" (role="switch").
function filtroCentralLigado() {
  const chave = document.getElementById('chFiltroTorneio');
  return !!chave && !chave.classList.contains('oculto') && chave.getAttribute('aria-checked') === 'true';
}

function definirFiltroCentral(ligado) {
  document.getElementById('chFiltroTorneio')?.setAttribute('aria-checked', ligado ? 'true' : 'false');
}

// Coluna e valor do filtro ligado (torneio ou mesa), ou null.
function filtroAtivoCentral() {
  if (!filtroCentralLigado()) return null;
  const { mesaId, torneioId } = centralHistorico.opcoes;
  if (mesaId) return { coluna: 'mesa_id', valor: mesaId };
  if (torneioId) return { coluna: 'torneio_id', valor: torneioId };
  return null;
}

const ICONE_CH = {
  historico: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 12a9 9 0 1 0 3-6.7L3 8"/><path d="M3 3v5h5M12 7v5l3 2"/></svg>',
  fechar: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" aria-hidden="true"><path d="M18 6L6 18M6 6l12 12"/></svg>',
  busca: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="11" cy="11" r="7"/><path d="M20 20l-3.5-3.5"/></svg>',
  relogio: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></svg>',
  vazio: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M22 12h-6l-2 3h-4l-2-3H2"/><path d="M5.5 5.1L2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.5-6.9A2 2 0 0 0 16.8 4H7.2a2 2 0 0 0-1.7 1.1z"/></svg>',
  erro: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M12 8v5M12 16h.01"/></svg>'
};

function htmlVazioCentral(texto, erro = false) {
  return `<div class="ch-vazio${erro ? ' negativo' : ''}"><span class="ch-vazio-ico">${erro ? ICONE_CH.erro : ICONE_CH.vazio}</span><p>${texto}</p></div>`;
}

function htmlCarregandoCentral(qtd = 3) {
  return `<div class="ch-carregando" role="status" aria-label="Carregando">${'<div class="ch-esqueleto"><span></span><span></span><span></span></div>'.repeat(qtd)}</div>`;
}

function htmlDataCentral(texto) {
  return `<span class="ch-data">${ICONE_CH.relogio}<span>${texto}</span></span>`;
}

// Cartão padrão do modal (movimentação, sessão ou registro do Log).
function htmlItemCentral({ topo = '', titulo = '', detalhe = '', data = '', valor = '', classeValor = '', acoes = '' }) {
  return `
    <div class="ch-item">
      <div class="ch-item-info">
        ${topo}
        ${titulo ? `<strong class="ch-item-titulo">${titulo}</strong>` : ''}
        ${detalhe ? `<div class="ch-item-detalhe">${detalhe}</div>` : ''}
        ${data ? htmlDataCentral(data) : ''}
      </div>
      ${valor || acoes ? `
        <div class="ch-item-lado">
          ${valor ? `<strong class="ch-valor ${classeValor}">${valor}</strong>` : ''}
          ${acoes ? `<div class="ch-acoes">${acoes}</div>` : ''}
        </div>` : ''}
    </div>
  `;
}

function htmlVerMaisCentral(onclick) {
  return `<div class="ch-mais"><button type="button" class="ch-btn" onclick="${onclick}">Ver mais</button></div>`;
}

function garantirModalCentralHistorico() {

  if (document.getElementById('modalCentralHistorico')) return;

  const div = document.createElement('div');

  div.id = 'modalCentralHistorico';
  div.className = 'modal-overlay';
  div.innerHTML = `
    <div class="modal-box modal-grande ch-modal" role="dialog" aria-modal="true" aria-labelledby="chTitulo">
      <div class="ch-cabecalho">
        <span class="ch-cabecalho-ico">${ICONE_CH.historico}</span>
        <div class="ch-cabecalho-texto">
          <h2 id="chTitulo">Histórico / Log</h2>
          <p>Desfazer, reabrir sessões e restaurar</p>
        </div>
        <!-- O X automático do menu.js fica escondido: este é o X do cabeçalho; o Esc continua pelo menu.js. -->
        <button type="button" class="ch-fechar" title="Fechar" aria-label="Fechar" onclick="fecharCentralHistorico()">${ICONE_CH.fechar}</button>
      </div>

      <div class="ch-filtros">
        <div class="ch-abas" role="tablist" aria-label="Seções do histórico">
          <button type="button" class="ch-aba" role="tab" data-aba="abertas" onclick="trocarAbaCentralHistorico('abertas')">Em aberto</button>
          <button type="button" class="ch-aba" role="tab" data-aba="sessoes" onclick="trocarAbaCentralHistorico('sessoes')">Sessões finalizadas</button>
          <button type="button" class="ch-aba" role="tab" data-aba="log" onclick="trocarAbaCentralHistorico('log')">Log</button>
        </div>
        <label class="ch-busca">
          <span class="ch-busca-ico">${ICONE_CH.busca}</span>
          <input type="search" id="chBusca" placeholder="Buscar jogador, tipo, obs." autocomplete="off" aria-label="Filtrar">
        </label>
        <button type="button" id="chFiltroTorneio" class="ch-switch" role="switch" aria-checked="false">
          <span class="ch-switch-trilho" aria-hidden="true"><span class="ch-switch-bolinha"></span></span>
          <span id="chFiltroTorneioTexto">Só este torneio</span>
        </button>
      </div>

      <div id="chConteudo" class="ch-conteudo"></div>
    </div>
  `;

  document.body.appendChild(div);

  let debounceBusca = null;

  document.getElementById('chBusca').addEventListener('input', () => {
    clearTimeout(debounceBusca);
    debounceBusca = setTimeout(renderizarAbaCentralHistorico, 200);
  });

  document.getElementById('chFiltroTorneio').addEventListener('click', () => {
    definirFiltroCentral(!filtroCentralLigado());
    centralHistorico.limiteSessoes = 30;
    renderizarAbaCentralHistorico();
  });

  div.addEventListener('click', e => {
    if (e.target === div) fecharCentralHistorico();
  });
}

function trocarAbaCentralHistorico(aba) {

  centralHistorico.aba = aba;

  // Log sempre atualizado ao abrir a aba (só a primeira página do período).
  if (aba === 'log') centralHistorico.log = null;

  document.querySelectorAll('#modalCentralHistorico .ch-aba').forEach(b => {
    b.classList.toggle('ativa', b.dataset.aba === aba);
    b.setAttribute('aria-selected', b.dataset.aba === aba ? 'true' : 'false');
  });

  // O filtro vale para "Em aberto" e "Sessões finalizadas" (o Log é geral).
  document.getElementById('chFiltroTorneio').classList.toggle(
    'oculto',
    aba === 'log' || !(centralHistorico.opcoes.torneioId || centralHistorico.opcoes.mesaId)
  );

  renderizarAbaCentralHistorico();
}

function textoBuscaCentral() {
  return normalizarBusca(document.getElementById('chBusca')?.value || '').trim();
}

function movCombinaBusca(mov, termo) {

  if (!termo) return true;

  return [mov.jogador, mov.tipo, mov.tipo_registro, mov.modalidade, mov.observacao]
    .filter(Boolean)
    .some(t => normalizarBusca(t).includes(termo));
}

async function renderizarAbaCentralHistorico() {

  const conteudo = document.getElementById('chConteudo');

  if (!conteudo) return;

  conteudo.innerHTML = htmlCarregandoCentral();
  conteudo.setAttribute('aria-busy', 'true');

  try {
    if (centralHistorico.aba === 'abertas') await renderizarAbertasCentral(conteudo);
    if (centralHistorico.aba === 'sessoes') await renderizarSessoesCentral(conteudo);
    if (centralHistorico.aba === 'log') await renderizarLogCentral(conteudo);
  } catch (erro) {
    console.error(erro);
    conteudo.innerHTML = htmlVazioCentral(`Erro ao carregar: ${escapeHtml(erro.message || String(erro))}`, true);
  }

  conteudo.removeAttribute('aria-busy');
}

function htmlDetalhesMov(mov) {

  const partes = [escapeHtml(mov.tipo)];

  if (mov.tipo_registro && mov.tipo_registro !== mov.tipo) partes.push(escapeHtml(mov.tipo_registro));
  if (mov.modalidade) partes.push(escapeHtml(mov.modalidade));
  if (mov.pago) partes.push('<span class="positivo">pago</span>');

  let html = partes.join(' · ');

  if (Number(mov.valor_rake) > 0) html += ` · rake ${formatarMoeda(mov.valor_rake)}`;
  if (mov.observacao) html += `<br><em class="ch-obs">Obs: ${escapeHtml(mov.observacao)}</em>`;

  return html;
}

async function renderizarAbertasCentral(conteudo) {

  const filtroMarcado = filtroCentralLigado();
  const somenteTorneio = filtroMarcado && !centralHistorico.opcoes.mesaId && centralHistorico.opcoes.torneioId;
  const somenteMesa = filtroMarcado && centralHistorico.opcoes.mesaId;
  const termo = textoBuscaCentral();

  let abertas = await buscarTodas(() =>
    client.from('movimentacoes').select(COLUNAS_MOV).is('sessao_finalizada_em', null).order('id', { ascending: false })
  );

  if (somenteMesa) {
    const mesaId = String(centralHistorico.opcoes.mesaId);
    abertas = abertas.filter(m => m.mesa_id != null && String(m.mesa_id) === mesaId);
  }

  if (somenteTorneio) {
    // Pagamentos feitos no Diretor passam a levar torneio_id. Os antigos
    // foram gravados sem vínculo: mostramos os pagamentos sem torneio dos
    // jogadores deste torneio, marcados como "sem vínculo" para conferência.
    const torneioId = String(centralHistorico.opcoes.torneioId);
    const doTorneio = m => m.torneio_id != null && String(m.torneio_id) === torneioId;
    const jogadoresTorneio = new Set(abertas.filter(doTorneio).map(m => m.jogador));

    abertas = abertas.filter(m =>
      doTorneio(m)
      || (m.tipo === 'Pagamento' && m.torneio_id == null && jogadoresTorneio.has(m.jogador))
    );
  }

  abertas = abertas.filter(m => movCombinaBusca(m, termo));

  if (abertas.length === 0) {
    conteudo.innerHTML = htmlVazioCentral('Nenhuma movimentação em aberto.');
    return;
  }

  conteudo.innerHTML = `
    <p class="ch-dica"><strong>${abertas.length}</strong> movimentação(ões) em aberto. Desfazer remove a movimentação; ela fica guardada no Log e pode ser restaurada.</p>
    <div class="ch-lista">
      ${abertas.map(mov => htmlItemCentral({
        titulo: escapeHtml(mov.jogador),
        detalhe: htmlDetalhesMov(mov) + (somenteTorneio && mov.torneio_id == null ? ' · <em class="ch-obs">sem vínculo com o torneio (pode ser do cash)</em>' : ''),
        data: formatarDataHora(mov.data),
        valor: formatarMoeda(mov.valor),
        acoes: `<button type="button" class="ch-btn ch-btn-perigo" onclick="desfazerMovCentral(${mov.id})">Desfazer</button>`
      })).join('')}
    </div>
  `;
}

// Filtro "Só este torneio / Só este Cash" nas sessões finalizadas: busca só
// jogador + horário das sessões que têm movimentação do torneio (torneio_id)
// ou da mesa (mesa_id) — consulta pequena, sem baixar as movimentações.
// Devolve null sem filtro; senão { chaves (ordem da mais recente), temMais }.
async function sessoesFiltradasCentral() {

  const filtro = filtroAtivoCentral();

  if (!filtro) return null;

  const linhas = await buscarTodas(() =>
    client
      .from('movimentacoes')
      .select('jogador,sessao_finalizada_em')
      .eq(filtro.coluna, filtro.valor)
      .not('sessao_finalizada_em', 'is', null)
      .order('id', { ascending: false })
  );

  const chaves = [];
  const vistas = new Set();

  linhas.forEach(m => {
    const chave = `${m.jogador}||${m.sessao_finalizada_em}`;
    if (vistas.has(chave)) return;
    vistas.add(chave);
    chaves.push({ chave, jogador: m.jogador, sessao_finalizada_em: m.sessao_finalizada_em });
  });

  return {
    chaves: chaves.slice(0, centralHistorico.limiteSessoes),
    temMais: chaves.length > centralHistorico.limiteSessoes
  };
}

function htmlItensSessaoCentral(movs) {
  return movs.map(mov => htmlItemCentral({
    detalhe: htmlDetalhesMov(mov),
    data: formatarDataHora(mov.data),
    valor: formatarMoeda(mov.valor),
    acoes: `<button type="button" class="ch-btn ch-btn-perigo" onclick="desfazerMovCentral(${mov.id}, true)">Desfazer</button>`
  })).join('') || htmlVazioCentral('Sessão sem itens.');
}

function htmlSessaoCentral({ i, jogador, entrada, saida, itens, finalizada, resultado, acaoItens, acaoReabrir }) {
  const classe = resultado >= 0 ? 'positivo' : 'negativo';
  const sinal = resultado >= 0 ? '+' : '-';

  return `
    <div class="ch-sessao">
      ${htmlItemCentral({
        titulo: escapeHtml(jogador),
        detalhe: `Entrou ${formatarMoeda(entrada)} · Saiu ${formatarMoeda(saida)} · ${itens} item(ns)`,
        data: `Finalizada em ${formatarDataHora(finalizada)}`,
        valor: `${sinal} ${formatarMoeda(Math.abs(resultado))}`,
        classeValor: classe,
        acoes: `
          <button type="button" class="ch-btn" aria-expanded="false" aria-controls="chItens${i}" onclick="${acaoItens}">Itens</button>
          <button type="button" class="ch-btn ch-btn-azul" onclick="${acaoReabrir}">Reabrir</button>
        `
      })}
      <div id="chItens${i}" class="ch-itens oculto"></div>
    </div>
  `;
}

function alternarExpansaoItensCentral(i) {
  const div = document.getElementById('chItens' + i);
  if (!div) return false;
  const abrir = div.classList.contains('oculto');
  div.classList.toggle('oculto', !abrir);
  document.querySelector(`[aria-controls="chItens${i}"]`)?.setAttribute('aria-expanded', abrir ? 'true' : 'false');
  return abrir;
}

// Uma linha pronta por sessão (visão relatorio_sessoes, sql/017); os itens
// só são buscados ao tocar em "Itens" ou "Reabrir".
async function renderizarSessoesDaVisao(conteudo, termo, filtradas) {

  const VAZIO = htmlVazioCentral('Nenhuma sessão finalizada encontrada.');

  let consulta = client
    .from('relatorio_sessoes')
    .select('jogador,sessao_finalizada_em,entrada,saida,resultado,itens');

  if (filtradas) {
    if (filtradas.chaves.length === 0) {
      conteudo.innerHTML = VAZIO;
      return true;
    }
    const tempos = Array.from(new Set(filtradas.chaves.map(c => c.sessao_finalizada_em)));
    consulta = consulta.in('sessao_finalizada_em', tempos);
  }

  if (termo) {
    if (!centralHistorico.jogadores) {
      const { data: jogadoresDB, error: erroJogadores } = await client.from('jogadores').select('id,nome');
      if (erroJogadores) throw erroJogadores;
      centralHistorico.jogadores = jogadoresDB || [];
    }
    const ids = centralHistorico.jogadores.filter(j => normalizarBusca(j.nome).includes(termo)).map(j => j.id);
    if (ids.length === 0) {
      conteudo.innerHTML = VAZIO;
      return true;
    }
    consulta = consulta.in('jogador_id', ids);
  }

  const { data, error } = await consulta
    .order('ultimo_id', { ascending: false })
    .range(0, filtradas ? 999 : centralHistorico.limiteSessoes);

  if (error) throw error;

  let sessoes;
  let temMais;

  if (filtradas) {
    // O "in" por horário pode trazer sessões de outros jogadores fechadas no
    // mesmo instante: fica só o par jogador + horário do torneio/mesa.
    const validas = new Set(filtradas.chaves.map(c => c.chave));
    sessoes = (data || []).filter(s => validas.has(`${s.jogador}||${s.sessao_finalizada_em}`));
    temMais = filtradas.temMais;
  } else {
    temMais = (data || []).length > centralHistorico.limiteSessoes;
    sessoes = (data || []).slice(0, centralHistorico.limiteSessoes);
  }

  centralHistorico.sessoes = sessoes;

  if (sessoes.length === 0) {
    conteudo.innerHTML = VAZIO;
    return true;
  }

  conteudo.innerHTML = `
    <p class="ch-dica">Reabrir devolve a sessão para "Movimentações em Aberto" para corrigir o fechamento.</p>
    <div class="ch-lista">
      ${sessoes.map((s, i) => htmlSessaoCentral({
        i,
        jogador: s.jogador,
        entrada: s.entrada,
        saida: s.saida,
        itens: Number(s.itens),
        finalizada: s.sessao_finalizada_em,
        resultado: Number(s.resultado),
        acaoItens: `alternarItensSessaoCentral(${i})`,
        acaoReabrir: `reabrirSessaoDaVisaoCentral(${i})`
      })).join('')}
    </div>
    ${temMais ? htmlVerMaisCentral('centralHistorico.limiteSessoes += 30; renderizarAbaCentralHistorico();') : ''}
  `;

  return true;
}

async function buscarItensSessaoCentral(sessao) {

  const { data, error } = await client
    .from('movimentacoes')
    .select(COLUNAS_MOV)
    .eq('jogador', sessao.jogador)
    .eq('sessao_finalizada_em', sessao.sessao_finalizada_em)
    .order('id', { ascending: false });

  if (error) throw error;

  return data || [];
}

async function alternarItensSessaoCentral(i) {

  const div = document.getElementById('chItens' + i);
  const sessao = centralHistorico.sessoes[i];

  if (!div || !sessao) return;

  if (!alternarExpansaoItensCentral(i)) return;

  div.innerHTML = htmlCarregandoCentral(1);

  try {
    const movs = await buscarItensSessaoCentral(sessao);
    div.innerHTML = htmlItensSessaoCentral(movs);
  } catch (erro) {
    console.error(erro);
    div.innerHTML = htmlVazioCentral('Erro ao carregar os itens. Tente de novo.', true);
  }
}

async function reabrirSessaoDaVisaoCentral(i) {

  const sessao = centralHistorico.sessoes[i];

  if (!sessao) return;

  let movs;
  try {
    movs = await buscarItensSessaoCentral(sessao);
  } catch (erro) {
    console.error(erro);
    await mostrarAlerta('Erro ao carregar a sessão. Tente de novo.');
    return;
  }

  if (movs.length === 0) return;

  await reabrirSessaoCentral(movs.map(m => m.id).join(','));
}

async function renderizarSessoesCentral(conteudo) {
  const filtradas = await sessoesFiltradasCentral();
  await renderizarSessoesDaVisao(conteudo, textoBuscaCentral(), filtradas);
}

const NOMES_OPERACAO_LOG = {
  INSERT: 'Incluída',
  UPDATE: 'Alterada',
  DELETE: 'Desfeita / excluída'
};

function descreverAlteracaoLog(item) {

  const antes = item.dados_antes || {};
  const depois = item.dados_depois || {};

  if (item.operacao !== 'UPDATE') return '';

  if (!antes.sessao_finalizada_em && depois.sessao_finalizada_em) return 'Sessão finalizada';
  if (antes.sessao_finalizada_em && !depois.sessao_finalizada_em) return 'Sessão reaberta';
  if (!antes.pago && depois.pago) return 'Marcada como paga';

  const mudou = Object.keys(depois).filter(k => JSON.stringify(antes[k]) !== JSON.stringify(depois[k]));

  return mudou.length ? `Campos: ${mudou.map(escapeHtml).join(', ')}` : '';
}

// Título no Log para tabelas que não são movimentações (sql/014 passou a
// registrar torneios, classificação, ranking, estruturas e configurações).
function tituloLogOutraTabela(tabela, dados) {
  const e = v => escapeHtml(v ?? '-');
  switch (tabela) {
    case 'cash_mesas': return `Mesa: ${e(dados.nome)}`;
    case 'jogadores': return `Jogador: ${e(dados.nome)}`;
    case 'torneios': return `Torneio: ${e(dados.nome)}`;
    case 'torneio_valores': return `Valor do torneio: ${e(dados.tipo)}`;
    case 'torneio_resultados': return `Classificação: ${e(dados.jogador)}${dados.posicao ? ` (${Number(dados.posicao)}º)` : ''}`;
    case 'torneio_premiacao_ajustes': return `Ajuste de prêmio: ${formatarMoeda(dados.valor)}${dados.observacao ? ` (${e(dados.observacao)})` : ''}`;
    case 'rankings': return `Ranking: ${e(dados.nome)}`;
    case 'ranking_torneios': return 'Torneio no ranking';
    case 'ranking_ajustes': return `Ajuste de ranking: ${e(dados.jogador)} (${Number(dados.pontos) > 0 ? '+' : ''}${Number(dados.pontos) || 0} pts)`;
    case 'premiacao_estruturas': return `Estrutura de premiação: ${e(dados.nome)}`;
    case 'estruturas_blinds': return `Estrutura de blinds: ${e(dados.nome)}`;
    case 'configuracoes': return 'Configurações';
    default: return e(tabela);
  }
}

// Busca a próxima página do Log no período escolhido (só o que falta).
async function buscarPaginaLogCentral() {

  const estado = centralHistorico.log || (centralHistorico.log = { itens: [], fim: false });
  const inicio = inicioPeriodoLog(centralHistorico.periodoLog);
  const de = estado.itens.length;

  let consulta = client
    .from('log_alteracoes')
    .select('id,tabela,operacao,dados_antes,dados_depois,usuario_email,criado_em');

  if (inicio) consulta = consulta.gte('criado_em', inicio.toISOString());

  const { data, error } = await consulta
    .order('id', { ascending: false })
    .range(de, de + TAMANHO_PAGINA_LOG - 1);

  if (error) {
    centralHistorico.log = null;
    throw error;
  }

  estado.itens.push(...(data || []));
  estado.fim = (data || []).length < TAMANHO_PAGINA_LOG;
}

function trocarPeriodoLogCentral(periodo) {
  centralHistorico.periodoLog = periodo;
  centralHistorico.log = null;
  renderizarAbaCentralHistorico();
}

async function verMaisLogCentral(botao) {
  if (botao) {
    botao.disabled = true;
    botao.textContent = 'Carregando...';
  }
  try {
    await buscarPaginaLogCentral();
  } catch (erro) {
    console.error(erro);
    await mostrarAlerta('Erro ao carregar mais registros do Log. Tente de novo.');
  }
  renderizarAbaCentralHistorico();
}

async function renderizarLogCentral(conteudo) {

  const termo = textoBuscaCentral();

  if (!centralHistorico.log) {
    try {
      await buscarPaginaLogCentral();
    } catch (error) {
      if (/log_alteracoes/.test(error.message || '')) {
        conteudo.innerHTML = htmlVazioCentral('O Log ainda não foi ativado. Rode o arquivo <strong>sql/002_log_movimentacoes.sql</strong> no Supabase.');
        return;
      }
      throw error;
    }
  }

  const estado = centralHistorico.log;

  const itens = estado.itens.filter(item => {
    const mov = item.dados_depois || item.dados_antes || {};
    return !termo
      || movCombinaBusca(mov, termo)
      || (mov.nome && normalizarBusca(mov.nome).includes(termo))
      || normalizarBusca(item.usuario_email).includes(termo);
  });

  const periodos = `
    <div class="ch-periodos" role="group" aria-label="Período do Log">
      ${PERIODOS_LOG.map(([valor, rotulo]) => `<button type="button" class="ch-chip${centralHistorico.periodoLog === valor ? ' ativa' : ''}" aria-pressed="${centralHistorico.periodoLog === valor}" onclick="trocarPeriodoLogCentral('${valor}')">${rotulo}</button>`).join('')}
    </div>
  `;

  const botaoMais = !estado.fim
    ? htmlVerMaisCentral('verMaisLogCentral(this)')
    : centralHistorico.periodoLog !== 'tudo'
      ? '<p class="ch-dica ch-dica-centro">Para ver registros mais antigos, escolha um período maior.</p>'
      : '';

  if (itens.length === 0) {
    conteudo.innerHTML = `${periodos}${htmlVazioCentral(termo && !estado.fim ? 'Nada encontrado nos registros já carregados. Toque em "Ver mais" para procurar nos mais antigos.' : 'Nenhum registro no Log neste período.')}${botaoMais}`;
    return;
  }

  conteudo.innerHTML = `
    ${periodos}
    <p class="ch-dica"><strong>${itens.length}</strong> registro(s)${estado.fim ? '' : ' (os mais recentes)'}. Itens desfeitos podem ser restaurados.</p>
    <div class="ch-lista">
    ${itens.map(item => {
      const dados = item.dados_depois || item.dados_antes || {};
      const ehMov = item.tabela === 'movimentacoes';
      const ehRecolhimento = item.tabela === 'cash_mesa_recolhimentos';
      const titulo = ehMov
        ? escapeHtml(dados.jogador || '-')
        : ehRecolhimento
          ? ({ rake: 'Rake', caixinha: 'Caixinha', jackpot: 'Jackpot' }[dados.tipo] || 'Retirada') + ' do Cash'
          : tituloLogOutraTabela(item.tabela, dados);
      const detalhe = ehMov
        ? htmlDetalhesMov(dados)
        : ehRecolhimento
          ? [dados.dealer ? `Dealer: ${escapeHtml(dados.dealer)}` : '', dados.observacao ? `<em class="ch-obs">Obs: ${escapeHtml(dados.observacao)}</em>` : ''].filter(Boolean).join(' · ')
          : '';
      const alteracao = descreverAlteracaoLog(item);
      const podeRestaurar = item.operacao === 'DELETE' && ehMov;

      return htmlItemCentral({
        topo: `<span class="ch-badge ch-badge-${item.operacao.toLowerCase()}">${NOMES_OPERACAO_LOG[item.operacao] || item.operacao}</span>`,
        titulo,
        detalhe: detalhe + (alteracao ? `${detalhe ? '<br>' : ''}${alteracao}` : ''),
        data: formatarDataHora(item.criado_em) + (item.usuario_email ? ' · ' + escapeHtml(item.usuario_email) : ''),
        valor: ehMov || ehRecolhimento ? formatarMoeda(dados.valor) : '',
        acoes: podeRestaurar ? `<button type="button" class="ch-btn ch-btn-verde" onclick="restaurarMovCentral(${item.id})">Restaurar</button>` : ''
      });
    }).join('')}
    </div>
    ${botaoMais}
  `;
}

async function aposAlteracaoCentral() {

  centralHistorico.log = null;

  await renderizarAbaCentralHistorico();

  if (typeof centralHistorico.opcoes.aoAlterar === 'function') {
    await centralHistorico.opcoes.aoAlterar();
  }
}

async function desfazerMovCentral(id, finalizada = false) {

  const aviso = finalizada
    ? 'Desfazer esta movimentação de uma sessão já finalizada? O resultado dessa sessão no histórico vai mudar. Ela fica guardada no Log e pode ser restaurada.'
    : 'Desfazer esta movimentação? Ela fica guardada no Log e pode ser restaurada.';

  if (!await mostrarConfirm(aviso)) return;

  const { error } = await client.from('movimentacoes').delete().eq('id', id);

  if (error) {
    await mostrarAlerta('Erro ao desfazer movimentação');
    console.error(error);
    return;
  }

  console.log('Movimentação desfeita:', id);

  await aposAlteracaoCentral();
}

async function reabrirSessaoCentral(idsTexto) {

  const ids = idsTexto.split(',').map(Number);

  if (!await mostrarConfirm(`Reabrir esta sessão? ${ids.length} movimentação(ões) voltam para "Movimentações em Aberto".`)) return;

  const { error } = await client
    .from('movimentacoes')
    .update({ sessao_finalizada_em: null })
    .in('id', ids);

  if (error) {
    await mostrarAlerta('Erro ao reabrir sessão');
    console.error(error);
    return;
  }

  console.log('Sessão reaberta:', ids);

  await aposAlteracaoCentral();
}

async function restaurarMovCentral(idLog) {

  const { data: item, error: erroLog } = await client
    .from('log_alteracoes')
    .select('*')
    .eq('id', idLog)
    .single();

  if (erroLog || !item?.dados_antes) {
    await mostrarAlerta('Registro do Log não encontrado');
    return;
  }

  const dados = { ...item.dados_antes };

  // Registros antigos do Log trazem colunas que não existem mais
  // (removidas no sql/020); sem isso o Restaurar daria erro.
  ['nome', 'cpf', 'telefone'].forEach(coluna => delete dados[coluna]);

  if (!await mostrarConfirm(`Restaurar ${dados.tipo} de ${formatarMoeda(dados.valor)} de ${dados.jogador}?`)) return;

  if (dados.id != null) {
    const { data: existente } = await client.from('movimentacoes').select('id').eq('id', dados.id).maybeSingle();
    if (existente) {
      await mostrarAlerta('Esta movimentação já foi restaurada.');
      return;
    }
  }

  // Volta com o mesmo id, para manter o histórico ligado. Se o id já
  // existir (restaurada por outro aparelho), não grava de novo.
  let { error } = await client.from('movimentacoes').insert([dados]);

  if (error && error.code === '23505') {
    await mostrarAlerta('Esta movimentação já foi restaurada.');
    await aposAlteracaoCentral();
    return;
  }

  if (error && dados.id != null) {
    delete dados.id;
    ({ error } = await client.from('movimentacoes').insert([dados]));
  }

  if (error) {
    await mostrarAlerta('Erro ao restaurar movimentação');
    console.error(error);
    return;
  }

  console.log('Movimentação restaurada do log:', idLog);

  await aposAlteracaoCentral();
}
