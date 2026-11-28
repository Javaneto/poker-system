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

// Colunas de movimentacoes que as telas usam. Economia de tráfego: fica de
// fora a cópia antiga de nome/cpf/telefone gravada em cada lançamento
// (o cadastro do jogador é a fonte desses dados).
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

function iniciarRealtimeRobusto({ nome, tabelas, aoMudar, intervaloSeguranca = 300000 }) {

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

    if (canal) {
      client.removeChannel(canal);
    }

    const este = client.channel(`${nome}-${Date.now()}`);
    canal = este;

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
        aoMudar();
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
  sessoesView: null,  // sql/017 (visão relatorio_sessoes): null = ainda não sabe
  jogadores: null,    // id/nome para a busca nas sessões (só com o sql/017)
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
  document.getElementById('chFiltroTorneio').checked = temFiltro;
  document.getElementById('chFiltroTorneioTexto').textContent = opcoes.mesaId ? 'Só este Cash' : 'Só este torneio';
  document.getElementById('chFiltroTorneioWrapper').classList.toggle('oculto', !temFiltro);
  document.getElementById('chBusca').value = '';

  document.getElementById('modalCentralHistorico').classList.add('aberto');

  trocarAbaCentralHistorico('abertas');
}

function fecharCentralHistorico() {
  document.getElementById('modalCentralHistorico')?.classList.remove('aberto');
}

function garantirModalCentralHistorico() {

  if (document.getElementById('modalCentralHistorico')) return;

  const div = document.createElement('div');

  div.id = 'modalCentralHistorico';
  div.className = 'modal-overlay';
  div.innerHTML = `
    <div class="modal-box modal-grande">
      <div class="topbar" style="margin-bottom:10px;">
        <h2 style="margin:0;">Histórico / Log</h2>
      </div>

      <div class="abas">
        <button class="aba" data-aba="abertas" onclick="trocarAbaCentralHistorico('abertas')">Em aberto</button>
        <button class="aba" data-aba="sessoes" onclick="trocarAbaCentralHistorico('sessoes')">Sessões finalizadas</button>
        <button class="aba" data-aba="log" onclick="trocarAbaCentralHistorico('log')">Log</button>
      </div>

      <div class="ch-filtros">
        <div class="pesquisa-wrapper" style="flex:1;margin-bottom:0;">
          <input type="text" id="chBusca" placeholder="Filtrar por jogador, tipo, observação..." autocomplete="off" style="margin-bottom:0;">
        </div>
        <label id="chFiltroTorneioWrapper" class="ch-check">
          <input type="checkbox" id="chFiltroTorneio"> <span id="chFiltroTorneioTexto">Só este torneio</span>
        </label>
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

  document.getElementById('chFiltroTorneio').addEventListener('change', renderizarAbaCentralHistorico);

  div.addEventListener('click', e => {
    if (e.target === div) fecharCentralHistorico();
  });
}

function trocarAbaCentralHistorico(aba) {

  centralHistorico.aba = aba;

  // Log sempre atualizado ao abrir a aba (só a primeira página do período).
  if (aba === 'log') centralHistorico.log = null;

  document.querySelectorAll('#modalCentralHistorico .aba').forEach(b => {
    b.classList.toggle('ativa', b.dataset.aba === aba);
  });

  document.getElementById('chFiltroTorneioWrapper').classList.toggle(
    'oculto',
    aba !== 'abertas' || !(centralHistorico.opcoes.torneioId || centralHistorico.opcoes.mesaId)
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

  conteudo.innerHTML = '<p class="ch-vazio">Carregando...</p>';

  try {
    if (centralHistorico.aba === 'abertas') await renderizarAbertasCentral(conteudo);
    if (centralHistorico.aba === 'sessoes') await renderizarSessoesCentral(conteudo);
    if (centralHistorico.aba === 'log') await renderizarLogCentral(conteudo);
  } catch (erro) {
    console.error(erro);
    conteudo.innerHTML = `<p class="ch-vazio negativo">Erro ao carregar: ${escapeHtml(erro.message || String(erro))}</p>`;
  }
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

  const filtroMarcado = document.getElementById('chFiltroTorneio').checked;
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
    conteudo.innerHTML = '<p class="ch-vazio">Nenhuma movimentação em aberto.</p>';
    return;
  }

  conteudo.innerHTML = `
    <p class="ch-dica">${abertas.length} movimentação(ões) em aberto. Desfazer remove a movimentação; ela fica guardada no Log e pode ser restaurada.</p>
    ${abertas.map(mov => `
      <div class="linha-desfazer">
        <div class="linha-desfazer-info">
          <strong>${escapeHtml(mov.jogador)}</strong>
          ${htmlDetalhesMov(mov)}${somenteTorneio && mov.torneio_id == null ? ' · <em class="ch-obs">sem vínculo com o torneio (pode ser do cash)</em>' : ''}<br>
          <span class="ch-data">${formatarDataHora(mov.data)}</span>
        </div>
        <div class="linha-desfazer-valor">
          <strong>${formatarMoeda(mov.valor)}</strong>
          <button class="btn-red" onclick="desfazerMovCentral(${mov.id})">Desfazer</button>
        </div>
      </div>
    `).join('')}
  `;
}

// Com o sql/017: uma linha pronta por sessão (visão relatorio_sessoes); os
// itens só são buscados ao tocar em "Itens" ou "Reabrir".
async function renderizarSessoesDaVisao(conteudo, termo) {

  let consulta = client
    .from('relatorio_sessoes')
    .select('jogador,sessao_finalizada_em,entrada,saida,resultado,itens');

  if (termo) {
    if (!centralHistorico.jogadores) {
      const { data: jogadoresDB, error: erroJogadores } = await client.from('jogadores').select('id,nome');
      if (erroJogadores) throw erroJogadores;
      centralHistorico.jogadores = jogadoresDB || [];
    }
    const ids = centralHistorico.jogadores.filter(j => normalizarBusca(j.nome).includes(termo)).map(j => j.id);
    if (ids.length === 0) {
      conteudo.innerHTML = '<p class="ch-vazio">Nenhuma sessão finalizada encontrada.</p>';
      return true;
    }
    consulta = consulta.in('jogador_id', ids);
  }

  const { data, error } = await consulta
    .order('ultimo_id', { ascending: false })
    .range(0, centralHistorico.limiteSessoes);

  if (error) {
    if (/relatorio_sessoes/.test(error.message || '') || ['PGRST205', '42P01'].includes(error.code)) return false;
    throw error;
  }

  const temMais = (data || []).length > centralHistorico.limiteSessoes;
  const sessoes = (data || []).slice(0, centralHistorico.limiteSessoes);
  centralHistorico.sessoes = sessoes;

  if (sessoes.length === 0) {
    conteudo.innerHTML = '<p class="ch-vazio">Nenhuma sessão finalizada encontrada.</p>';
    return true;
  }

  conteudo.innerHTML = `
    <p class="ch-dica">Reabrir devolve a sessão para "Movimentações em Aberto" para corrigir o fechamento.</p>
    ${sessoes.map((s, i) => {
      const resultado = Number(s.resultado);
      const classe = resultado >= 0 ? 'positivo' : 'negativo';
      const sinal = resultado >= 0 ? '+' : '-';

      return `
        <div class="ch-sessao">
          <div class="linha-desfazer" style="border-bottom:none;">
            <div class="linha-desfazer-info">
              <strong>${escapeHtml(s.jogador)}</strong>
              Entrou ${formatarMoeda(s.entrada)} · Saiu ${formatarMoeda(s.saida)} · ${Number(s.itens)} item(ns)<br>
              <span class="ch-data">Finalizada em ${formatarDataHora(s.sessao_finalizada_em)}</span>
            </div>
            <div class="linha-desfazer-valor">
              <strong class="${classe}">${sinal} ${formatarMoeda(Math.abs(resultado))}</strong>
              <button class="btn-gray" onclick="alternarItensSessaoCentral(${i})">Itens</button>
              <button class="btn-blue" onclick="reabrirSessaoDaVisaoCentral(${i})">Reabrir</button>
            </div>
          </div>
          <div id="chItens${i}" class="ch-itens oculto"></div>
        </div>
      `;
    }).join('')}
    ${temMais ? '<div style="text-align:center;margin-top:12px;"><button class="btn-gray" onclick="centralHistorico.limiteSessoes += 30; renderizarAbaCentralHistorico();">Ver mais</button></div>' : ''}
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

  if (!div.classList.contains('oculto')) {
    div.classList.add('oculto');
    return;
  }

  div.innerHTML = '<p class="ch-vazio">Carregando...</p>';
  div.classList.remove('oculto');

  try {
    const movs = await buscarItensSessaoCentral(sessao);
    div.innerHTML = movs.map(mov => `
      <div class="linha-desfazer">
        <div class="linha-desfazer-info">
          ${htmlDetalhesMov(mov)}<br>
          <span class="ch-data">${formatarDataHora(mov.data)}</span>
        </div>
        <div class="linha-desfazer-valor">
          <strong>${formatarMoeda(mov.valor)}</strong>
          <button class="btn-red" onclick="desfazerMovCentral(${mov.id}, true)">Desfazer</button>
        </div>
      </div>
    `).join('') || '<p class="ch-vazio">Sessão sem itens.</p>';
  } catch (erro) {
    console.error(erro);
    div.innerHTML = '<p class="ch-vazio negativo">Erro ao carregar os itens. Tente de novo.</p>';
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

  const termo = textoBuscaCentral();

  if (centralHistorico.sessoesView !== false) {
    const usouVisao = await renderizarSessoesDaVisao(conteudo, termo);
    centralHistorico.sessoesView = usouVisao;
    if (usouVisao) return;
  }

  // Sem o sql/017: busca as movimentações finalizadas mais recentes e agrupa
  // por sessão (jogador + horário de finalização), como no histórico do cash.
  const { data, error } = await client
    .from('movimentacoes')
    .select(COLUNAS_MOV)
    .not('sessao_finalizada_em', 'is', null)
    .order('sessao_finalizada_em', { ascending: false })
    .order('id', { ascending: false })
    .limit(centralHistorico.limiteSessoes * 15 + 1);

  if (error) throw error;

  const limiteLinhas = centralHistorico.limiteSessoes * 15;
  const grupos = new Map();

  (data || []).forEach(mov => {
    const chave = `${mov.jogador}||${mov.sessao_finalizada_em}`;
    if (!grupos.has(chave)) grupos.set(chave, []);
    grupos.get(chave).push(mov);
  });

  // Se a consulta bateu no limite, a sessão mais antiga pode estar
  // incompleta: descarta para não mostrar resultado errado nem reabrir
  // só parte dela (ela aparece completa no "Ver mais").
  const consultaCortada = (data || []).length > limiteLinhas;
  const todosGrupos = Array.from(grupos.values());
  if (consultaCortada && todosGrupos.length > 1) todosGrupos.pop();

  let sessoes = todosGrupos
    .filter(movs => !termo || movs.some(m => movCombinaBusca(m, termo)));

  const temMais = consultaCortada || sessoes.length > centralHistorico.limiteSessoes;

  sessoes = sessoes.slice(0, centralHistorico.limiteSessoes);

  if (sessoes.length === 0) {
    conteudo.innerHTML = '<p class="ch-vazio">Nenhuma sessão finalizada encontrada.</p>';
    return;
  }

  conteudo.innerHTML = `
    <p class="ch-dica">Reabrir devolve a sessão para "Movimentações em Aberto" para corrigir o fechamento.</p>
    ${sessoes.map((movs, i) => {
      const { entrada, saida, resultado } = calcularResultadoMovimentacoes(movs);
      const classe = resultado >= 0 ? 'positivo' : 'negativo';
      const sinal = resultado >= 0 ? '+' : '-';
      const ids = movs.map(m => m.id).join(',');

      return `
        <div class="ch-sessao">
          <div class="linha-desfazer" style="border-bottom:none;">
            <div class="linha-desfazer-info">
              <strong>${escapeHtml(movs[0].jogador)}</strong>
              Entrou ${formatarMoeda(entrada)} · Saiu ${formatarMoeda(saida)} · ${movs.length} item(ns)<br>
              <span class="ch-data">Finalizada em ${formatarDataHora(movs[0].sessao_finalizada_em)}</span>
            </div>
            <div class="linha-desfazer-valor">
              <strong class="${classe}">${sinal} ${formatarMoeda(Math.abs(resultado))}</strong>
              <button class="btn-gray" onclick="document.getElementById('chItens${i}').classList.toggle('oculto')">Itens</button>
              <button class="btn-blue" onclick="reabrirSessaoCentral('${ids}')">Reabrir</button>
            </div>
          </div>
          <div id="chItens${i}" class="ch-itens oculto">
            ${movs.map(mov => `
              <div class="linha-desfazer">
                <div class="linha-desfazer-info">
                  ${htmlDetalhesMov(mov)}<br>
                  <span class="ch-data">${formatarDataHora(mov.data)}</span>
                </div>
                <div class="linha-desfazer-valor">
                  <strong>${formatarMoeda(mov.valor)}</strong>
                  <button class="btn-red" onclick="desfazerMovCentral(${mov.id}, true)">Desfazer</button>
                </div>
              </div>
            `).join('')}
          </div>
        </div>
      `;
    }).join('')}
    ${temMais ? '<div style="text-align:center;margin-top:12px;"><button class="btn-gray" onclick="centralHistorico.limiteSessoes += 30; renderizarAbaCentralHistorico();">Ver mais</button></div>' : ''}
  `;
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
        conteudo.innerHTML = '<p class="ch-vazio">O Log ainda não foi ativado. Rode o arquivo <strong>sql/002_log_movimentacoes.sql</strong> no Supabase.</p>';
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
      ${PERIODOS_LOG.map(([valor, rotulo]) => `<button type="button" class="aba${centralHistorico.periodoLog === valor ? ' ativa' : ''}" aria-pressed="${centralHistorico.periodoLog === valor}" onclick="trocarPeriodoLogCentral('${valor}')">${rotulo}</button>`).join('')}
    </div>
  `;

  const botaoMais = !estado.fim
    ? '<div style="text-align:center;margin-top:12px;"><button class="btn-gray" onclick="verMaisLogCentral(this)">Ver mais</button></div>'
    : centralHistorico.periodoLog !== 'tudo'
      ? '<p class="ch-dica" style="text-align:center;margin-top:12px;">Para ver registros mais antigos, escolha um período maior.</p>'
      : '';

  if (itens.length === 0) {
    conteudo.innerHTML = `${periodos}<p class="ch-vazio">${termo && !estado.fim ? 'Nada encontrado nos registros já carregados. Toque em "Ver mais" para procurar nos mais antigos.' : 'Nenhum registro no Log neste período.'}</p>${botaoMais}`;
    return;
  }

  conteudo.innerHTML = `
    ${periodos}
    <p class="ch-dica">${itens.length} registro(s)${estado.fim ? '' : ' (os mais recentes)'}. Itens desfeitos podem ser restaurados.</p>
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

      return `
        <div class="linha-desfazer">
          <div class="linha-desfazer-info">
            <span class="ch-badge ch-badge-${item.operacao.toLowerCase()}">${NOMES_OPERACAO_LOG[item.operacao] || item.operacao}</span>
            <strong>${titulo}</strong>
            ${detalhe}${alteracao ? `<br>${alteracao}` : ''}<br>
            <span class="ch-data">${formatarDataHora(item.criado_em)}${item.usuario_email ? ' · ' + escapeHtml(item.usuario_email) : ''}</span>
          </div>
          <div class="linha-desfazer-valor">
            ${ehMov || ehRecolhimento ? `<strong>${formatarMoeda(dados.valor)}</strong>` : ''}
            ${podeRestaurar ? `<button class="btn-green" onclick="restaurarMovCentral(${item.id})">Restaurar</button>` : ''}
          </div>
        </div>
      `;
    }).join('')}
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
