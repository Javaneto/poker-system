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
// - recarrega ao voltar para a aba, ao reconectar a internet e a cada
//   30 s como garantia (se algum aviso do Realtime se perder);
// - mostra um indicador "Ao vivo" / "Reconectando..." no canto da tela.

function iniciarRealtimeRobusto({ nome, tabelas, aoMudar, intervaloSeguranca = 30000 }) {

  let canal = null;
  let tentativaReconexao = null;
  let debounce = null;

  function avisarMudanca() {
    clearTimeout(debounce);
    debounce = setTimeout(() => {
      console.log('Recarregando dados via Realtime');
      aoMudar();
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

  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') aoMudar();
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

const centralHistorico = {
  aba: 'abertas',
  opcoes: {},
  limiteSessoes: 30,
  limiteLog: 100
};

function abrirCentralHistorico(opcoes = {}) {

  centralHistorico.opcoes = opcoes;
  centralHistorico.limiteSessoes = 30;
  centralHistorico.limiteLog = 100;

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
  return (document.getElementById('chBusca')?.value || '').trim().toLowerCase();
}

function movCombinaBusca(mov, termo) {

  if (!termo) return true;

  return [mov.jogador, mov.tipo, mov.tipo_registro, mov.modalidade, mov.observacao]
    .filter(Boolean)
    .some(t => String(t).toLowerCase().includes(termo));
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
    client.from('movimentacoes').select('*').is('sessao_finalizada_em', null).order('id', { ascending: false })
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

async function renderizarSessoesCentral(conteudo) {

  const termo = textoBuscaCentral();

  // Busca as movimentações finalizadas mais recentes e agrupa por sessão
  // (jogador + horário de finalização), como no histórico do cash game.
  const { data, error } = await client
    .from('movimentacoes')
    .select('*')
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

async function renderizarLogCentral(conteudo) {

  const termo = textoBuscaCentral();

  const { data, error } = await client
    .from('log_alteracoes')
    .select('*')
    .order('id', { ascending: false })
    .limit(centralHistorico.limiteLog);

  if (error) {
    if (/log_alteracoes/.test(error.message || '')) {
      conteudo.innerHTML = '<p class="ch-vazio">O Log ainda não foi ativado. Rode o arquivo <strong>sql/002_log_movimentacoes.sql</strong> no Supabase.</p>';
      return;
    }
    throw error;
  }

  const itens = (data || []).filter(item => {
    const mov = item.dados_depois || item.dados_antes || {};
    return !termo
      || movCombinaBusca(mov, termo)
      || (mov.nome && mov.nome.toLowerCase().includes(termo))
      || (item.usuario_email || '').toLowerCase().includes(termo);
  });

  if (itens.length === 0) {
    conteudo.innerHTML = '<p class="ch-vazio">Nenhum registro no Log.</p>';
    return;
  }

  conteudo.innerHTML = `
    <p class="ch-dica">Últimos ${itens.length} registros. Itens desfeitos podem ser restaurados.</p>
    ${itens.map(item => {
      const dados = item.dados_depois || item.dados_antes || {};
      const ehMov = item.tabela === 'movimentacoes';
      const ehRecolhimento = item.tabela === 'cash_mesa_recolhimentos';
      const titulo = ehMov
        ? escapeHtml(dados.jogador || '-')
        : ehRecolhimento
          ? (dados.tipo === 'rake' ? 'Rake' : 'Caixinha') + ' do Cash'
          : item.tabela === 'cash_mesas'
            ? `Mesa: ${escapeHtml(dados.nome || '-')}`
            : `Jogador: ${escapeHtml(dados.nome || '-')}`;
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
    ${(data || []).length >= centralHistorico.limiteLog ? '<div style="text-align:center;margin-top:12px;"><button class="btn-gray" onclick="centralHistorico.limiteLog += 100; renderizarAbaCentralHistorico();">Ver mais</button></div>' : ''}
  `;
}

async function aposAlteracaoCentral() {

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
