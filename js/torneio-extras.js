/*
 * Diretor: Relatório do torneio (rake acumulado e detalhado) e
 * Classificação final (colocações usadas no Ranking).
 *
 * Usa globais do diretor.html: client, torneioAtual, movimentacoesTorneio,
 * valoresTorneio, NOMES_BUYIN, adminLiberado, escapeHtml, mostrarAlerta,
 * mostrarConfirm.
 */

function criarModalExtras(id, conteudoHtml, larguraMax = 820) {

  let el = document.getElementById(id);

  if (el) return el;

  el = document.createElement('div');
  el.id = id;
  el.className = 'modal-overlay';
  el.innerHTML = `<div class="modal-box" style="max-width:${larguraMax}px;">${conteudoHtml}</div>`;
  el.addEventListener('click', e => { if (e.target === el) el.classList.remove('aberto'); });

  document.body.appendChild(el);

  return el;
}

const TIPOS_ENTRADA_TORNEIO = ['Entrada', 'Registro', 'Rebuy', 'Add-on'];

// ---------------------------------------------------------------------------
// Rake acumulado e totais
// ---------------------------------------------------------------------------

function calcularTotaisTorneio(movs) {

  const entradas = movs.filter(m => TIPOS_ENTRADA_TORNEIO.includes(m.tipo));

  const totais = {
    arrecadado: 0,
    rake: 0,
    prize: 0,
    bounty: 0,
    naoPago: 0,
    qtdEntradas: 0,
    qtdAddons: 0,
    porTipo: new Map(),
    porJogador: new Map()
  };

  entradas.forEach(m => {

    const valor = Number(m.valor || 0);
    const rake = Number(m.valor_rake || 0);
    const prize = Number(m.valor_prize || 0);
    const bounty = Math.max(valor - rake - prize, 0);
    const tipo = m.tipo_registro || m.tipo;

    totais.arrecadado += valor;
    totais.rake += rake;
    totais.prize += prize;
    totais.bounty += bounty;
    if (!m.pago) totais.naoPago += valor;

    if (tipo === 'Add-on' || m.tipo === 'Add-on') totais.qtdAddons += 1;
    else totais.qtdEntradas += 1;

    const t = totais.porTipo.get(tipo) || { qtd: 0, valor: 0, rake: 0, prize: 0, bounty: 0 };
    t.qtd += 1; t.valor += valor; t.rake += rake; t.prize += prize; t.bounty += bounty;
    totais.porTipo.set(tipo, t);

    const j = totais.porJogador.get(m.jogador) || { qtd: 0, valor: 0, rake: 0, naoPago: 0 };
    j.qtd += 1; j.valor += valor; j.rake += rake; if (!m.pago) j.naoPago += valor;
    totais.porJogador.set(m.jogador, j);
  });

  return totais;
}

function atualizarRakeAcumulado() {

  const el = document.getElementById('statRakeAcumulado');

  if (!el || !torneioAtual) return;

  const { rake } = calcularTotaisTorneio(movimentacoesTorneio);

  el.textContent = formatarMoeda(rake);
}

// ---------------------------------------------------------------------------
// Relatório do torneio
// ---------------------------------------------------------------------------

function abrirRelatorioTorneio() {

  if (!torneioAtual) return;

  const modal = criarModalExtras('modalRelatorioTorneio', `
    <div class="topbar" style="margin-bottom:8px;">
      <h2 style="margin:0;" id="relTitulo">Relatório do Torneio</h2>
      <div style="display:flex;gap:8px;">
        <button class="btn-gray" onclick="imprimirRelatorioTorneio()">Imprimir / PDF</button>
      </div>
    </div>
    <div id="relConteudo"></div>
  `);

  renderizarRelatorioTorneio();

  modal.classList.add('aberto');
}

function renderizarRelatorioTorneio() {

  const conteudo = document.getElementById('relConteudo');

  if (!conteudo || !torneioAtual) return;

  const tot = calcularTotaisTorneio(movimentacoesTorneio);
  const ajuste = Number(torneioAtual.ajuste_premiacao || 0);
  const premioTotal = tot.prize + ajuste;
  const jogadores = new Set(movimentacoesTorneio.filter(m => NOMES_BUYIN.includes(m.tipo_registro)).map(m => m.jogador)).size;
  const pctRake = tot.arrecadado > 0 ? (tot.rake / tot.arrecadado * 100) : 0;

  document.getElementById('relTitulo').textContent = `Relatório — ${torneioAtual.nome}`;

  const linhasTipo = Array.from(tot.porTipo.entries())
    .sort((a, b) => b[1].valor - a[1].valor)
    .map(([tipo, t]) => `
      <tr>
        <td>${escapeHtml(tipo)}</td>
        <td>${t.qtd}</td>
        <td>${formatarMoeda(t.valor)}</td>
        <td>${formatarMoeda(t.rake)}</td>
        <td>${formatarMoeda(t.prize)}</td>
        <td>${t.bounty > 0 ? formatarMoeda(t.bounty) : '-'}</td>
      </tr>
    `).join('');

  const linhasJogador = Array.from(tot.porJogador.entries())
    .sort((a, b) => b[1].valor - a[1].valor || a[0].localeCompare(b[0]))
    .map(([nome, j]) => `
      <tr>
        <td>${escapeHtml(nome)}</td>
        <td>${j.qtd}</td>
        <td>${formatarMoeda(j.valor)}</td>
        <td>${formatarMoeda(j.rake)}</td>
        <td class="${j.naoPago > 0 ? 'negativo' : ''}">${j.naoPago > 0 ? formatarMoeda(j.naoPago) : 'Pago'}</td>
      </tr>
    `).join('');

  conteudo.innerHTML = `
    <p class="ch-dica" style="margin-bottom:12px;">
      ${escapeHtml(torneioAtual.status === 'encerrado' ? 'Torneio encerrado' : 'Torneio em andamento')}
      · gerado em ${formatarDataHora(new Date())}
    </p>

    <div class="rel-kpis">
      <div class="rel-kpi"><span>Arrecadado</span><strong>${formatarMoeda(tot.arrecadado)}</strong></div>
      <div class="rel-kpi rel-kpi-destaque"><span>Rake acumulado</span><strong>${formatarMoeda(tot.rake)}</strong><em>${pctRake.toFixed(1)}% do arrecadado</em></div>
      <div class="rel-kpi"><span>Prêmio total</span><strong>${formatarMoeda(premioTotal)}</strong>${ajuste ? `<em>inclui ajuste de ${formatarMoeda(ajuste)}</em>` : ''}</div>
      <div class="rel-kpi"><span>Bounty</span><strong>${formatarMoeda(tot.bounty)}</strong></div>
      <div class="rel-kpi"><span>Jogadores</span><strong>${jogadores}</strong></div>
      <div class="rel-kpi"><span>Entradas / Add-ons</span><strong>${tot.qtdEntradas} / ${tot.qtdAddons}</strong></div>
      <div class="rel-kpi"><span>Não pago (em aberto)</span><strong class="${tot.naoPago > 0 ? 'negativo' : ''}">${formatarMoeda(tot.naoPago)}</strong></div>
      <div class="rel-kpi"><span>Conferência</span><strong style="font-size:13px;">${formatarMoeda(tot.rake)} + ${formatarMoeda(tot.prize)} + ${formatarMoeda(tot.bounty)} = ${formatarMoeda(tot.rake + tot.prize + tot.bounty)}</strong><em>${Math.abs(tot.rake + tot.prize + tot.bounty - tot.arrecadado) < 0.01 ? 'bate com o arrecadado ✓' : 'diferente do arrecadado'}</em></div>
    </div>

    <h3>Por tipo de entrada</h3>
    <div class="tabela-rolavel">
      <table>
        <thead><tr><th>Tipo</th><th>Qtd</th><th>Valor</th><th>Rake</th><th>Prêmio</th><th>Bounty</th></tr></thead>
        <tbody>${linhasTipo || '<tr><td colspan="6" style="color:var(--apagado);">Nenhuma entrada.</td></tr>'}</tbody>
        ${linhasTipo ? `<tfoot><tr><th>Total</th><th>${tot.qtdEntradas + tot.qtdAddons}</th><th>${formatarMoeda(tot.arrecadado)}</th><th>${formatarMoeda(tot.rake)}</th><th>${formatarMoeda(tot.prize)}</th><th>${formatarMoeda(tot.bounty)}</th></tr></tfoot>` : ''}
      </table>
    </div>

    <h3 style="margin-top:18px;">Por jogador</h3>
    <div class="tabela-rolavel">
      <table>
        <thead><tr><th>Jogador</th><th>Entradas</th><th>Total</th><th>Rake gerado</th><th>Situação</th></tr></thead>
        <tbody>${linhasJogador || '<tr><td colspan="5" style="color:var(--apagado);">Nenhum jogador.</td></tr>'}</tbody>
      </table>
    </div>
  `;
}

function imprimirRelatorioTorneio() {

  const conteudo = document.getElementById('relConteudo');
  const titulo = document.getElementById('relTitulo').textContent;
  const janela = window.open('', '_blank');

  if (!janela) {
    mostrarAlerta('O navegador bloqueou a janela de impressão. Permita pop-ups para este site.');
    return;
  }

  janela.document.write(`
    <!DOCTYPE html><html lang="pt-BR"><head><meta charset="UTF-8">
    <title>${escapeHtml(titulo)}</title>
    <link rel="stylesheet" href="${location.href.replace(/[^/]*$/, '')}styles.css">
    <style>
      body { background: white; padding: 16px; }
      .rel-kpis { display: grid; grid-template-columns: repeat(4, 1fr); gap: 8px; margin-bottom: 14px; }
      .rel-kpi { border: 1px solid #ddd; border-radius: 8px; padding: 8px; }
      .rel-kpi span { display: block; font-size: 11px; color: #666; text-transform: uppercase; }
      .rel-kpi em { display: block; font-size: 11px; color: #666; }
      table { display: table !important; }
      th, td { padding: 6px; font-size: 12px; white-space: normal !important; }
    </style></head>
    <body><h1>${escapeHtml(titulo)}</h1>${conteudo.innerHTML}</body></html>
  `);

  janela.document.close();
  janela.onload = () => { janela.focus(); janela.print(); };
}

// ---------------------------------------------------------------------------
// Celular: mini relógio fixo no topo quando o relógio sai da tela
// ---------------------------------------------------------------------------

(function iniciarMiniRelogio() {

  function montar() {

    const card = document.getElementById('cardRelogio');
    const contador = document.getElementById('relogioContador');

    if (!card || !contador || !('IntersectionObserver' in window)) return;

    const barra = document.createElement('div');
    barra.id = 'miniRelogio';
    barra.className = 'mini-relogio';
    barra.innerHTML = '<span class="mini-nivel"></span><strong class="mini-tempo"></strong><span class="mini-blinds"></span>';
    barra.onclick = () => card.scrollIntoView({ behavior: 'smooth', block: 'start' });
    document.body.appendChild(barra);

    let fora = false;

    new IntersectionObserver(entradas => {
      fora = !entradas[0].isIntersecting;
      atualizar();
    }, { threshold: 0 }).observe(card);

    function atualizar() {

      const temRelogio = !document.getElementById('relogioTorneio')?.classList.contains('oculto');
      const celular = window.matchMedia('(max-width: 768px)').matches;

      barra.classList.toggle('visivel', fora && temRelogio && celular);

      if (!barra.classList.contains('visivel')) return;

      barra.querySelector('.mini-nivel').textContent = 'Nível ' + (document.getElementById('relogioNivelNumero')?.textContent || '-');
      barra.querySelector('.mini-tempo').textContent = contador.textContent.trim();
      barra.querySelector('.mini-blinds').textContent = document.getElementById('relogioBlindsAtual')?.textContent.trim() || '';
      barra.classList.toggle('intervalo', contador.classList.contains('relogio-contador-intervalo'));
    }

    setInterval(atualizar, 500);
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', montar);
  else montar();
})();

// ---------------------------------------------------------------------------
// Classificação final (para o Ranking)
// ---------------------------------------------------------------------------

let classificacaoTorneioAtual = [];
let rankingsClassificacao = [];

function formatarPontosClassif(valor) {
  return Number(valor || 0).toLocaleString('pt-BR', { maximumFractionDigits: 0 });
}

// Texto do total de pontos do torneio num ranking (colocações + ajuste).
function textoTotalRankingClassif(item) {
  const qtd = classificacaoTorneioAtual.filter(c => c.posicao).length;
  if (!qtd) return 'Informe as colocações para ver os pontos';
  const calc = calcularPontosTorneio(item.ranking, qtd, item.ajuste);
  const campeao = (calc.porPosicao[0] || 0) + calc.participacao;
  return `${qtd} classificados · <b>${formatarPontosClassif(calc.total)} pts</b> no total · campeão ${formatarPontosClassif(campeao)} pts`;
}

// Pontos do torneio em cada ranking: vincular e ajustar sem ir em Rankings.
function renderizarPontosClassificacao() {

  const el = document.getElementById('classifPontos');

  if (!el) return;

  el.innerHTML = rankingsClassificacao.length === 0 ? '' : `
    <h3>Pontos no Ranking</h3>
    ${rankingsClassificacao.map((item, i) => `
      <div class="classif-ranking">
        <label class="classif-ranking-info">
          <input type="checkbox" ${item.conta ? 'checked' : ''} onchange="rankingsClassificacao[${i}].conta = this.checked">
          <span>
            <strong>${escapeHtml(item.ranking.nome)}</strong>
            <span class="classif-ranking-total" data-i="${i}">${textoTotalRankingClassif(item)}</span>
          </span>
        </label>
        <input type="number" step="1" class="classif-ajuste" value="${item.ajuste || ''}" placeholder="Ajuste ±"
          title="Pontos a mais ou a menos no total deste torneio"
          oninput="rankingsClassificacao[${i}].ajuste = Number(this.value) || 0; atualizarTotaisRankingClassif()">
      </div>
    `).join('')}
  `;
}

// Atualiza só os textos dos totais (sem redesenhar, para não perder o foco do campo).
function atualizarTotaisRankingClassif() {
  rankingsClassificacao.forEach((item, i) => {
    const alvo = document.querySelector(`#classifPontos .classif-ranking-total[data-i="${i}"]`);
    if (alvo) alvo.innerHTML = textoTotalRankingClassif(item);
  });
}

async function abrirClassificacaoTorneio() {

  if (!torneioAtual) return;

  const modal = criarModalExtras('modalClassificacaoTorneio', `
    <h2 style="margin-bottom:4px;">Classificação final</h2>
    <p class="ch-dica" style="margin-bottom:12px;">
      Informe a colocação de cada jogador (1 = campeão). É usada para calcular os pontos do Ranking.
      Deixe em branco quem não deve contar.
    </p>
    <div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:10px;">
      <button class="btn-gray" onclick="numerarClassificacaoPelaOrdem()">Preenchimento Automático</button>
      <button class="btn-gray" onclick="limparClassificacao()">Limpar</button>
    </div>
    <div id="classifLista" style="max-height:45vh;overflow-y:auto;"></div>
    <div id="classifPontos" class="classif-pontos"></div>
    <div class="modal-acoes" style="margin-top:14px;">
      <button class="btn-gray" onclick="document.getElementById('modalClassificacaoTorneio').classList.remove('aberto')">Cancelar</button>
      <button class="btn-green" id="btnSalvarClassificacao" onclick="salvarClassificacaoTorneio()">Salvar classificação</button>
    </div>
  `, 560);

  const lista = document.getElementById('classifLista');

  lista.innerHTML = '<p class="ch-vazio">Carregando...</p>';
  document.getElementById('classifPontos').innerHTML = '';
  modal.classList.add('aberto');

  const torneioIdAtual = String(torneioAtual.id);

  const [{ data, error }, rk, vc] = await Promise.all([
    client.from('torneio_resultados').select('*').eq('torneio_id', torneioIdAtual),
    client.from('rankings').select('*').order('id'),
    client.from('ranking_torneios').select('*').eq('torneio_id', torneioIdAtual)
  ]);

  // Rankings ativos e os que já contam este torneio: dá para vincular e
  // ajustar os pontos do torneio aqui mesmo, sem ir em Rankings.
  const vinculosDoTorneio = new Map((vc.data || []).map(v => [v.ranking_id, v]));

  rankingsClassificacao = (rk.error || vc.error) ? [] : (rk.data || [])
    .filter(r => r.ativo || vinculosDoTorneio.has(r.id))
    .map(r => ({
      ranking: r,
      conta: vinculosDoTorneio.has(r.id),
      ajuste: Number(vinculosDoTorneio.get(r.id)?.ajuste_pontos) || 0
    }));

  if (error) {
    lista.innerHTML = /torneio_resultados/.test(error.message || '')
      ? '<p class="ch-vazio">A classificação ainda não foi ativada. Rode o arquivo <strong>sql/004_ranking.sql</strong> no Supabase.</p>'
      : `<p class="ch-vazio negativo">Erro: ${escapeHtml(error.message)}</p>`;
    return;
  }

  const salvos = new Map((data || []).map(r => [r.jogador, r]));

  const registrados = Array.from(new Set(
    movimentacoesTorneio.filter(m => NOMES_BUYIN.includes(m.tipo_registro)).map(m => m.jogador)
  ));

  // Inclui quem já tem resultado salvo mesmo que não esteja mais registrado.
  salvos.forEach((_, nome) => { if (!registrados.includes(nome)) registrados.push(nome); });

  classificacaoTorneioAtual = registrados
    .map(nome => ({ jogador: nome, posicao: salvos.get(nome)?.posicao || '', eliminado_por: salvos.get(nome)?.eliminado_por || '' }))
    .sort((a, b) => (a.posicao || 999) - (b.posicao || 999) || a.jogador.localeCompare(b.jogador));

  renderizarClassificacao();
}

function renderizarClassificacao() {

  const lista = document.getElementById('classifLista');
  const nomes = classificacaoTorneioAtual.map(c => c.jogador);

  renderizarPontosClassificacao();

  if (classificacaoTorneioAtual.length === 0) {
    lista.innerHTML = '<p class="ch-vazio">Nenhum jogador registrado neste torneio.</p>';
    return;
  }

  lista.innerHTML = classificacaoTorneioAtual.map((c, i) => `
    <div class="classif-linha">
      <input type="number" min="1" class="classif-pos" value="${c.posicao}" placeholder="Pos." data-i="${i}" oninput="classificacaoTorneioAtual[${i}].posicao = this.value ? Number(this.value) : ''; atualizarTotaisRankingClassif()">
      <strong class="classif-nome">${escapeHtml(c.jogador)}</strong>
      <select class="classif-elim" data-i="${i}" onchange="classificacaoTorneioAtual[${i}].eliminado_por = this.value" title="Eliminado por">
        <option value="">Eliminado por...</option>
        ${nomes.filter(n => n !== c.jogador).map(n => `<option value="${escapeHtml(n)}" ${n === c.eliminado_por ? 'selected' : ''}>${escapeHtml(n)}</option>`).join('')}
      </select>
    </div>
  `).join('');
}

// Preenche só as posições vazias, na ordem da lista, com as colocações ainda livres
// (as já informadas são mantidas e nunca repetidas).
function numerarClassificacaoPelaOrdem() {
  const usadas = new Set(classificacaoTorneioAtual.map(c => Number(c.posicao)).filter(p => p > 0));
  let proxima = 1;
  classificacaoTorneioAtual.forEach(c => {
    if (c.posicao) return;
    while (usadas.has(proxima)) proxima++;
    c.posicao = proxima;
    usadas.add(proxima);
  });
  renderizarClassificacao();
}

function limparClassificacao() {
  classificacaoTorneioAtual.forEach(c => { c.posicao = ''; c.eliminado_por = ''; });
  renderizarClassificacao();
}

async function salvarClassificacaoTorneio() {

  if (!adminLiberado || !torneioAtual) return;

  const comPosicao = classificacaoTorneioAtual.filter(c => c.posicao);

  const posicoes = comPosicao.map(c => c.posicao);
  const repetidas = posicoes.filter((p, i) => posicoes.indexOf(p) !== i);

  if (repetidas.length > 0) {
    await mostrarAlerta(`Há colocações repetidas: ${Array.from(new Set(repetidas)).join(', ')}º. Cada posição deve ter um jogador só.`);
    return;
  }

  const btn = document.getElementById('btnSalvarClassificacao');
  btn.classList.add('disabled');

  try {

    const torneioId = String(torneioAtual.id);

    const { error: erroApagar } = await client.from('torneio_resultados').delete().eq('torneio_id', torneioId);

    if (erroApagar) throw erroApagar;

    if (comPosicao.length > 0) {

      const { error: erroInserir } = await client.from('torneio_resultados').insert(
        comPosicao.map(c => ({
          torneio_id: torneioId,
          jogador: c.jogador,
          posicao: c.posicao,
          eliminado_por: c.eliminado_por || null
        }))
      );

      if (erroInserir) throw erroInserir;
    }

    // Vínculo com cada ranking e o ajuste de pontos do torneio.
    const contam = rankingsClassificacao.filter(r => r.conta);
    const naoContam = rankingsClassificacao.filter(r => !r.conta).map(r => r.ranking.id);

    if (contam.length > 0) {
      const { error: erroVinculo } = await client.from('ranking_torneios').upsert(
        contam.map(r => ({ ranking_id: r.ranking.id, torneio_id: torneioId, ajuste_pontos: r.ajuste || 0 })),
        { onConflict: 'ranking_id,torneio_id' }
      );
      if (erroVinculo) throw erroVinculo;
    }

    if (naoContam.length > 0) {
      const { error: erroDesvincular } = await client.from('ranking_torneios')
        .delete().eq('torneio_id', torneioId).in('ranking_id', naoContam);
      if (erroDesvincular) throw erroDesvincular;
    }

    document.getElementById('modalClassificacaoTorneio').classList.remove('aberto');
    await mostrarAlerta(contam.length > 0
      ? `Classificação salva (${comPosicao.length} jogador(es)). Conta no Ranking: ${contam.map(r => r.ranking.nome).join(', ')}.`
      : `Classificação salva (${comPosicao.length} jogador(es)). Marque um ranking em "Pontos no Ranking" para este torneio contar.`);

  } catch (erro) {
    console.error(erro);
    await mostrarAlerta('Erro ao salvar a classificação: ' + (erro.message || erro));
  } finally {
    btn.classList.remove('disabled');
  }
}

// ---------------------------------------------------------------------------
// Eliminação pelo nome do jogador (menu de contexto na tabela do Diretor)
// ---------------------------------------------------------------------------
// Cada eliminação grava a pior colocação ainda livre em torneio_resultados
// (de N até 2). Quando sobra um jogador só, ele recebe a 1ª colocação.
// Posições digitadas na Classificação também contam como eliminação.

async function carregarResultadosTorneio() {

  if (!torneioAtual) { resultadosTorneio = []; return; }

  const { data, error } = await client
    .from('torneio_resultados')
    .select('*')
    .eq('torneio_id', String(torneioAtual.id));

  if (error) {
    console.error(error);
    resultadosTorneio = [];
    return;
  }

  resultadosTorneio = data || [];
}

function fecharMenuJogadorTorneio() {
  document.getElementById('menuJogadorTorneio')?.remove();
}

function abrirMenuJogadorTorneio(botao) {

  fecharMenuJogadorTorneio();

  if (!adminLiberado || !torneioAtual) return;

  const nome = botao.dataset.nome;
  const registrados = tsJogadoresRegistrados(movimentacoesTorneio);
  const resultado = resultadosTorneio.find(r => r.jogador === nome);
  const posicao = Number(resultado?.posicao) || 0;
  const proxima = tsProximaPosicaoEliminacao(registrados.length, resultadosTorneio);
  const registrado = registrados.includes(nome);

  let opcoes;

  if (posicao) {
    opcoes = `<button type="button" class="menu-ctx-item" data-acao="desfazer">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 7v6h6"/><path d="M21 17a9 9 0 0 0-15-6.7L3 13"/></svg>
      <span>Desfazer ${posicao === 1 ? 'campeão' : 'eliminação'} (${posicao}º)</span>
    </button>`;
  } else if (!registrado) {
    opcoes = '<div class="menu-ctx-vazio">Jogador sem registro (Buy-in) neste torneio.</div>';
  } else if (!proxima) {
    opcoes = '<div class="menu-ctx-vazio">Todas as colocações já foram preenchidas.</div>';
  } else {
    opcoes = `<button type="button" class="menu-ctx-item perigo" data-acao="eliminar">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M15 9l-6 6M9 9l6 6"/></svg>
      <span>Eliminar jogador (${proxima}º lugar)</span>
    </button>`;
  }

  const menu = document.createElement('div');
  menu.id = 'menuJogadorTorneio';
  menu.className = 'menu-ctx';
  menu.setAttribute('role', 'menu');
  menu.innerHTML = `<div class="menu-ctx-titulo">${escapeHtml(nome)}</div>${opcoes}`;
  document.body.appendChild(menu);

  // Abaixo do nome, sem sair da tela.
  const r = botao.getBoundingClientRect();
  const largura = menu.offsetWidth;
  const altura = menu.offsetHeight;
  let x = Math.min(r.left, window.innerWidth - largura - 8);
  let y = r.bottom + 4;
  if (y + altura > window.innerHeight - 8) y = Math.max(r.top - altura - 4, 8);
  menu.style.left = `${Math.max(x, 8)}px`;
  menu.style.top = `${y}px`;

  menu.addEventListener('click', e => {
    const item = e.target.closest('[data-acao]');
    if (!item) return;
    fecharMenuJogadorTorneio();
    if (item.dataset.acao === 'eliminar') eliminarJogadorTorneio(nome);
    if (item.dataset.acao === 'desfazer') desfazerEliminacaoTorneio(nome);
  });

  menu.querySelector('[data-acao]')?.focus();
}

document.addEventListener('click', e => {
  const botao = e.target.closest && e.target.closest('.dir-jogador-nome');
  if (botao) {
    e.stopPropagation();
    if (document.getElementById('menuJogadorTorneio')?.dataset.nome === botao.dataset.nome) return fecharMenuJogadorTorneio();
    abrirMenuJogadorTorneio(botao);
    const menu = document.getElementById('menuJogadorTorneio');
    if (menu) menu.dataset.nome = botao.dataset.nome;
    return;
  }
  if (!(e.target.closest && e.target.closest('#menuJogadorTorneio'))) fecharMenuJogadorTorneio();
});

document.addEventListener('keydown', e => { if (e.key === 'Escape') fecharMenuJogadorTorneio(); });
window.addEventListener('scroll', fecharMenuJogadorTorneio, true);
window.addEventListener('resize', fecharMenuJogadorTorneio);

async function gravarColocacoesTorneio(linhas) {
  return client.from('torneio_resultados').upsert(
    linhas.map(l => ({ torneio_id: String(torneioAtual.id), jogador: l.jogador, posicao: l.posicao })),
    { onConflict: 'torneio_id,jogador' }
  );
}

async function eliminarJogadorTorneio(nome) {

  if (!adminLiberado || !torneioAtual) return;

  await carregarResultadosTorneio();

  const registrados = tsJogadoresRegistrados(movimentacoesTorneio);

  if (resultadosTorneio.some(r => r.jogador === nome)) {
    await mostrarAlerta(`${nome} já tem colocação neste torneio.`);
    return;
  }

  const posicao = tsProximaPosicaoEliminacao(registrados.length, resultadosTorneio);

  if (!posicao) {
    await mostrarAlerta('Todas as colocações já foram preenchidas. Confira em Classificação.');
    return;
  }

  const linhas = [{ jogador: nome, posicao }];

  // Sobrou um jogador: ele é o campeão (1º), se a 1ª colocação ainda estiver livre.
  const comPosicao = new Set([...resultadosTorneio.map(r => r.jogador), nome]);
  const restantes = registrados.filter(j => !comPosicao.has(j));
  const primeiroLivre = !resultadosTorneio.some(r => Number(r.posicao) === 1);

  if (restantes.length === 1 && primeiroLivre) linhas.push({ jogador: restantes[0], posicao: 1 });

  const { error } = await gravarColocacoesTorneio(linhas);

  if (error) {
    console.error(error);
    await mostrarAlerta(/torneio_resultados/.test(error.message || '')
      ? 'A classificação ainda não foi ativada. Rode o arquivo sql/004_ranking.sql no Supabase.'
      : 'Erro ao eliminar o jogador. Tente de novo.');
    return;
  }

  await carregarResultadosTorneio();
  atualizarTela();
}

async function desfazerEliminacaoTorneio(nome) {

  if (!adminLiberado || !torneioAtual) return;

  const torneioId = String(torneioAtual.id);

  const { error } = await client.from('torneio_resultados').delete().eq('torneio_id', torneioId).eq('jogador', nome);

  if (error) {
    console.error(error);
    await mostrarAlerta('Erro ao desfazer. Tente de novo.');
    return;
  }

  await carregarResultadosTorneio();

  // Voltou a ter mais de um jogador no torneio: o campeão automático deixa de valer.
  const resumo = tsResumoJogadores(movimentacoesTorneio, resultadosTorneio);
  const campeao = resultadosTorneio.find(r => Number(r.posicao) === 1);

  if (campeao && resumo.restantes > 1) {
    await client.from('torneio_resultados').delete().eq('torneio_id', torneioId).eq('jogador', campeao.jogador);
    await carregarResultadosTorneio();
  }

  atualizarTela();
}
