/*
 * Diretor > Ajustar Prêmio (sql/011_ajuste_premiacao.sql).
 *
 *   - Ajustar: soma ou subtrai do prêmio total, com observação. Cada ajuste
 *     fica no histórico (torneio_premiacao_ajustes) e pode ser desfeito.
 *     Ao adicionar, dá para premiar a próxima posição com o valor.
 *   - Premiação por posição: valor de cada posição editável e um texto
 *     opcional (ex.: "Bilhete" → "Bilhete + R$ 100"). A soma nunca passa do
 *     prêmio total. Salva em torneios.premiacao_manual; vazia = estrutura.
 *   - Encerrar: os prêmios (manuais ou da estrutura) são lançados no Em
 *     Aberto de cada jogador premiado, conforme a classificação.
 *
 * Usa as variáveis e funções da página do Diretor (torneioAtual, client,
 * carregarDados, premiosTorneioAtual, mostrarAlerta...).
 */

let ajustesPremiacaoTorneio = [];
let premiacaoSqlPendente = false;

// Rascunho da premiação por posição enquanto o modal está aberto.
let apRascunho = [];
let apEditado = false;
let apTipoAjuste = 1;

const AP_ICONE_TEXTO = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 7V5h16v2M9 19h6M12 5v14"/></svg>';
const AP_ICONE_REMOVER = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18"/></svg>';
const AP_ICONE_LIXEIRA = '<svg class="cg-ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 6h18M8 6V4a1 1 0 0 1 1-1h6a1 1 0 0 1 1 1v2M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6M10 11v6M14 11v6"/></svg>';

function apErroSqlPendente(error) {
  const texto = `${error?.code || ''} ${error?.message || ''}`;
  return /PGRST202|PGRST204|PGRST205|42P01|42883|42703|premiacao_manual|torneio_premiacao_ajustes|registrar_ajuste_premiacao|desfazer_ajuste_premiacao|encerrar_torneio_com_premios/.test(texto);
}

async function apAvisarSqlPendente() {
  await mostrarAlerta('O banco ainda não foi atualizado para esta função. Rode o arquivo sql/011_ajuste_premiacao.sql no Supabase (SQL Editor) e tente de novo.');
}

// Detalhe técnico do erro no aviso: ajuda a descobrir o motivo pelo print.
function apDetalheErro(error) {
  const msg = String(error?.message || error?.details || '').trim();
  return msg ? `\n\nDetalhe: ${msg}` : '';
}

// ---------- dados ----------

async function carregarAjustesPremiacao() {

  if (!torneioAtual) { ajustesPremiacaoTorneio = []; return; }

  const { data, error } = await client
    .from('torneio_premiacao_ajustes')
    .select('*')
    .eq('torneio_id', String(torneioAtual.id))
    .order('criado_em', { ascending: false });

  if (error) {
    premiacaoSqlPendente = apErroSqlPendente(error);
    if (!premiacaoSqlPendente) console.error(error);
    ajustesPremiacaoTorneio = [];
    return;
  }

  premiacaoSqlPendente = false;
  ajustesPremiacaoTorneio = data || [];
}

function apPremioTotal() {
  return tsPremioTotal(movimentacoesTorneio, torneioAtual);
}

function apPremiosSalvos() {
  return premiosTorneioAtual();
}

function apRascunhoDosSalvos() {
  return apPremiosSalvos().map(p => ({ valor: p.valor, texto: p.texto, textoAtivo: !!p.texto }));
}

function apPremiosDoRascunho() {
  return apRascunho.map((p, i) => ({ posicao: i + 1, valor: Number(p.valor) || 0, texto: p.textoAtivo ? String(p.texto || '').trim() : '' }));
}

// ---------- modal principal ----------

function abrirModalAjustarPremiacao() {

  if (!adminLiberado || !torneioAtual) return;

  if (torneioAtual.status === 'encerrado') return;

  apRascunho = apRascunhoDosSalvos();
  apEditado = false;

  renderizarAjustarPremiacao();

  document.getElementById('modalAjustarPremiacao').classList.add('aberto');
}

function fecharModalAjustarPremiacao() {

  document.getElementById('modalAjustarPremiacao').classList.remove('aberto');
  apEditado = false;
}

// Chamado a cada carga de dados: mantém o modal aberto em dia.
function atualizarModalAjustarPremiacaoSeAberto() {

  if (!document.getElementById('modalAjustarPremiacao').classList.contains('aberto')) return;

  if (!torneioAtual || torneioAtual.status === 'encerrado') {
    fecharModalAjustarPremiacao();
    return;
  }

  if (!apEditado) apRascunho = apRascunhoDosSalvos();

  renderizarAjustarPremiacao();
}

function renderizarAjustarPremiacao() {

  const total = apPremioTotal();
  const ajuste = Number(torneioAtual.ajuste_premiacao || 0);
  const arrecadado = total - ajuste;

  document.getElementById('apPremioTotal').textContent = formatarMoeda(total);
  document.getElementById('apPremioComposicao').textContent = Math.abs(ajuste) < 0.005
    ? 'Sem ajustes'
    : `Entradas ${formatarMoeda(arrecadado)} ${ajuste > 0 ? '+' : '−'} ajustes ${formatarMoeda(Math.abs(ajuste))}`;

  const manual = tsTemPremiacaoManual(torneioAtual);
  const estrutura = estruturasPremiacao.find(e => e.id === torneioAtual.premiacao_estrutura_id);
  const modo = document.getElementById('apModo');

  if (apEditado) {
    modo.className = 'cg-badge compra';
    modo.textContent = 'Não salvo';
  } else if (manual) {
    modo.className = 'cg-badge rake';
    modo.textContent = 'Manual';
  } else {
    modo.className = 'cg-badge encerrado';
    modo.textContent = estrutura ? `Estrutura ${estrutura.nome}` : 'Sem estrutura';
  }

  document.getElementById('apBtnRestaurar').classList.toggle('oculto', !manual);

  renderizarLinhasPremiacao();
  renderizarResumoPremiacao();
  renderizarHistoricoAjustes();
}

function renderizarLinhasPremiacao() {

  const linhas = document.getElementById('apLinhas');

  if (apRascunho.length === 0) {
    linhas.innerHTML = '<p class="ap-dica">Nenhuma posição premiada. Escolha uma estrutura de premiação ou adicione uma posição.</p>';
    return;
  }

  linhas.innerHTML = apRascunho.map((p, i) => `
    <div class="ap-linha">
      <span class="ap-linha-pos">${i + 1}º</span>
      <input type="number" inputmode="decimal" min="0" step="0.01" aria-label="Valor da ${i + 1}ª posição"
        value="${Number(p.valor) ? Math.round(Number(p.valor) * 100) / 100 : ''}" placeholder="0,00"
        oninput="alterarValorPosicaoPremio(${i}, this.value)">
      <button type="button" class="ap-btn-icone${p.textoAtivo ? ' ativo' : ''}" title="Texto antes do valor (ex.: Bilhete)"
        aria-label="Texto da ${i + 1}ª posição" aria-pressed="${p.textoAtivo ? 'true' : 'false'}"
        onclick="alternarTextoPosicaoPremio(${i})">${AP_ICONE_TEXTO}</button>
      <button type="button" class="ap-btn-icone remover" title="Remover posição" aria-label="Remover ${i + 1}ª posição"
        onclick="removerPosicaoPremio(${i})">${AP_ICONE_REMOVER}</button>
      ${p.textoAtivo ? `
        <input type="text" class="ap-texto" maxlength="60" placeholder="Ex: Bilhete" aria-label="Texto da ${i + 1}ª posição"
          value="${escapeHtml(p.texto || '')}" oninput="alterarTextoPosicaoPremio(${i}, this.value)">
      ` : ''}
    </div>
  `).join('');
}

function renderizarResumoPremiacao() {

  const total = apPremioTotal();
  const soma = tsSomaPremios(apPremiosDoRascunho());
  const restanteCent = tsCentavos(total) - tsCentavos(soma);
  const resumo = document.getElementById('apResumo');
  const passou = restanteCent < 0;

  resumo.classList.toggle('erro', passou);
  resumo.innerHTML = `
    <div><span>Distribuído</span><strong>${formatarMoeda(soma)} de ${formatarMoeda(total)}</strong></div>
    <div><span>${passou ? 'Passou do prêmio total' : 'Não distribuído'}</span><strong>${formatarMoeda(Math.abs(restanteCent) / 100)}</strong></div>
    ${passou ? '<div><span>Diminua as posições ou use Ajustar para aumentar o prêmio total.</span></div>' : ''}
  `;

  document.getElementById('apBtnSalvar').classList.toggle('disabled', passou || !apEditado);
}

function renderizarHistoricoAjustes() {

  const lista = document.getElementById('apListaAjustes');
  const n = ajustesPremiacaoTorneio.length;

  document.getElementById('apHistoricoTitulo').textContent = `Histórico (${n} ${n === 1 ? 'ajuste' : 'ajustes'})`;

  // Ajustes feitos antes do histórico existir (sem linha na tabela).
  const somaHistoricoCent = ajustesPremiacaoTorneio.reduce((s, a) => s + tsCentavos(a.valor), 0);
  const anteriorCent = tsCentavos(torneioAtual.ajuste_premiacao) - somaHistoricoCent;

  const linhas = ajustesPremiacaoTorneio.map(a => {
    const valor = Number(a.valor);
    return `
      <div class="cg-fin-lanc">
        <span class="cg-badge ${valor > 0 ? 'adicao' : 'subtracao'}">${valor > 0 ? 'Adição' : 'Subtração'}</span>
        <div class="cg-fin-lanc-info">
          <span>${formatarDataHora(a.criado_em)}</span>
          ${a.observacao ? `<span class="cg-obs">${escapeHtml(a.observacao)}</span>` : ''}
        </div>
        <strong>${valor > 0 ? '+' : '−'} ${formatarMoeda(Math.abs(valor))}</strong>
        <button type="button" class="cg-fin-desfazer" title="Desfazer" aria-label="Desfazer ajuste" onclick="desfazerAjustePremiacao(${Number(a.id)})">${AP_ICONE_LIXEIRA}</button>
      </div>
    `;
  });

  if (anteriorCent !== 0) {
    linhas.push(`
      <div class="cg-fin-lanc">
        <span class="cg-badge anterior">Anterior</span>
        <div class="cg-fin-lanc-info"><span>Ajuste feito antes do histórico</span></div>
        <strong>${anteriorCent > 0 ? '+' : '−'} ${formatarMoeda(Math.abs(anteriorCent) / 100)}</strong>
      </div>
    `);
  }

  lista.innerHTML = linhas.length === 0
    ? `<p class="cg-dica">${premiacaoSqlPendente ? 'Histórico indisponível: rode o sql/011 no Supabase.' : 'Nenhum ajuste registrado.'}</p>`
    : linhas.join('');
}

// ---------- edição da premiação por posição ----------

function apMarcarEditado() {
  apEditado = true;
  renderizarAjustarPremiacao();
}

function alterarValorPosicaoPremio(i, valor) {
  if (!apRascunho[i]) return;
  apRascunho[i].valor = Math.max(parseFloat(valor) || 0, 0);
  apEditado = true;
  // Só o resumo: redesenhar as linhas tiraria o foco do campo.
  const modo = document.getElementById('apModo');
  modo.className = 'cg-badge compra';
  modo.textContent = 'Não salvo';
  renderizarResumoPremiacao();
}

function alterarTextoPosicaoPremio(i, texto) {
  if (!apRascunho[i]) return;
  apRascunho[i].texto = texto;
  apEditado = true;
  const modo = document.getElementById('apModo');
  modo.className = 'cg-badge compra';
  modo.textContent = 'Não salvo';
  renderizarResumoPremiacao();
}

function alternarTextoPosicaoPremio(i) {
  if (!apRascunho[i]) return;
  apRascunho[i].textoAtivo = !apRascunho[i].textoAtivo;
  apMarcarEditado();
  if (apRascunho[i].textoAtivo) {
    document.querySelectorAll('#apLinhas .ap-linha')[i]?.querySelector('.ap-texto')?.focus();
  }
}

function adicionarPosicaoPremio() {
  apRascunho.push({ valor: 0, texto: '', textoAtivo: false });
  apMarcarEditado();
  const campos = document.querySelectorAll('#apLinhas .ap-linha input[type="number"]');
  campos[campos.length - 1]?.focus();
}

function removerPosicaoPremio(i) {
  apRascunho.splice(i, 1);
  apMarcarEditado();
}

function apManualParaSalvar(premios) {
  return premios.map(p => ({
    valor: Math.max(tsCentavos(p.valor), 0) / 100,
    texto: String(p.texto || '').trim() || null
  }));
}

async function salvarPremiacaoManual() {

  if (!adminLiberado || !torneioAtual || torneioAtual.status === 'encerrado') return;

  const premios = apPremiosDoRascunho();

  if (tsCentavos(tsSomaPremios(premios)) > tsCentavos(apPremioTotal())) {
    await mostrarAlerta('A soma das posições passa do prêmio total. Diminua os valores ou use Ajustar para aumentar o prêmio.');
    return;
  }

  const btn = document.getElementById('apBtnSalvar');
  btn.classList.add('disabled');

  const { error } = await client
    .from('torneios')
    .update({ premiacao_manual: premios.length ? apManualParaSalvar(premios) : null })
    .eq('id', torneioAtual.id);

  if (error) {
    btn.classList.remove('disabled');
    if (apErroSqlPendente(error)) return apAvisarSqlPendente();
    console.error(error);
    await mostrarAlerta('Erro ao salvar a premiação. Tente novamente.' + apDetalheErro(error));
    return;
  }

  apEditado = false;
  await carregarDados();
}

async function restaurarPremiacaoAutomatica() {

  if (!adminLiberado || !torneioAtual || torneioAtual.status === 'encerrado') return;

  if (!await mostrarConfirm('Voltar a premiação para a estrutura? Os valores e textos digitados por posição serão descartados.')) return;

  const { error } = await client
    .from('torneios')
    .update({ premiacao_manual: null })
    .eq('id', torneioAtual.id);

  if (error) {
    if (apErroSqlPendente(error)) return apAvisarSqlPendente();
    console.error(error);
    await mostrarAlerta('Erro ao voltar para a estrutura. Tente novamente.' + apDetalheErro(error));
    return;
  }

  apEditado = false;
  await carregarDados();
}

// ---------- Ajustar (adicionar / subtrair do prêmio total) ----------

function abrirModalAjusteValorPremio() {

  if (!adminLiberado || !torneioAtual || torneioAtual.status === 'encerrado') return;

  document.getElementById('apAjusteValor').value = '';
  document.getElementById('apAjusteObs').value = '';
  document.getElementById('apProximaPosicao').checked = false;

  selecionarTipoAjustePremio(1);

  document.getElementById('modalAjusteValorPremio').classList.add('aberto');
  document.getElementById('apAjusteValor').focus();
}

function fecharModalAjusteValorPremio() {
  document.getElementById('modalAjusteValorPremio').classList.remove('aberto');
}

function selecionarTipoAjustePremio(sinal) {

  apTipoAjuste = sinal;
  const adicionar = sinal > 0;

  const btnAdd = document.getElementById('apTipoAdicionar');
  const btnSub = document.getElementById('apTipoSubtrair');
  btnAdd.classList.toggle('ativo', adicionar);
  btnSub.classList.toggle('ativo', !adicionar);
  btnAdd.setAttribute('aria-pressed', adicionar ? 'true' : 'false');
  btnSub.setAttribute('aria-pressed', adicionar ? 'false' : 'true');

  document.getElementById('apProximaPosicaoLinha').classList.toggle('oculto', !adicionar);
  document.getElementById('apProximaPosicaoTexto').textContent =
    `Premiar a próxima posição (${apRascunho.length + 1}º) com este valor`;

  document.getElementById('apAjusteDica').textContent = adicionar
    ? 'O valor soma no prêmio total do torneio.'
    : 'O valor sai do prêmio total do torneio.';

  const btn = document.getElementById('apBtnConfirmarAjuste');
  btn.className = adicionar ? 'btn-green' : 'btn-red';
  btn.textContent = adicionar ? 'Adicionar ao prêmio' : 'Subtrair do prêmio';
}

async function confirmarAjusteValorPremio() {

  if (!adminLiberado || !torneioAtual || torneioAtual.status === 'encerrado') return;

  const valor = Math.round((parseFloat(document.getElementById('apAjusteValor').value) || 0) * 100) / 100;
  const observacao = document.getElementById('apAjusteObs').value.trim();
  const proximaPosicao = apTipoAjuste > 0 && document.getElementById('apProximaPosicao').checked;

  if (!(valor > 0)) {
    await mostrarAlerta('Informe um valor válido.');
    document.getElementById('apAjusteValor').focus();
    return;
  }

  if (!observacao) {
    await mostrarAlerta('A observação é obrigatória.');
    document.getElementById('apAjusteObs').focus();
    return;
  }

  const total = apPremioTotal();
  const delta = apTipoAjuste * valor;
  const novoTotalCent = tsCentavos(total) + tsCentavos(delta);

  if (novoTotalCent < 0) {
    await mostrarAlerta(`Não dá para subtrair mais que o prêmio total (${formatarMoeda(total)}).`);
    return;
  }

  if (apTipoAjuste < 0 && tsTemPremiacaoManual(torneioAtual)) {
    const somaManual = tsSomaPremios(apPremiosSalvos());
    if (tsCentavos(somaManual) > novoTotalCent) {
      await mostrarAlerta(`A premiação por posição soma ${formatarMoeda(somaManual)} e o prêmio ficaria em ${formatarMoeda(novoTotalCent / 100)}. Diminua os valores das posições antes de subtrair.`);
      return;
    }
  }

  let novaManual = null;

  if (proximaPosicao) {
    const atuais = apPremiosDoRascunho();
    if (tsCentavos(tsSomaPremios(atuais)) > tsCentavos(total)) {
      await mostrarAlerta('A soma das posições já passa do prêmio total. Corrija as posições antes de premiar a próxima.');
      return;
    }
    novaManual = apManualParaSalvar([...atuais, { posicao: atuais.length + 1, valor, texto: '' }]);
  }

  const btn = document.getElementById('apBtnConfirmarAjuste');
  btn.classList.add('disabled');

  const { error } = await client.rpc('registrar_ajuste_premiacao', {
    p_torneio_id: String(torneioAtual.id),
    p_valor: delta,
    p_observacao: observacao,
    p_alterar_manual: proximaPosicao,
    p_premiacao_manual: novaManual
  });

  btn.classList.remove('disabled');

  if (error) {
    if (apErroSqlPendente(error)) return apAvisarSqlPendente();
    console.error(error);
    await mostrarAlerta('Erro ao ajustar o prêmio. Tente novamente.' + apDetalheErro(error));
    return;
  }

  if (proximaPosicao) apEditado = false;

  fecharModalAjusteValorPremio();
  await carregarDados();
}

async function desfazerAjustePremiacao(id) {

  if (!adminLiberado || !torneioAtual || torneioAtual.status === 'encerrado') return;

  const ajuste = ajustesPremiacaoTorneio.find(a => Number(a.id) === Number(id));
  if (!ajuste) return;

  const valor = Number(ajuste.valor);
  const novoTotalCent = tsCentavos(apPremioTotal()) - tsCentavos(valor);

  if (novoTotalCent < 0) {
    await mostrarAlerta('Desfazer este ajuste deixaria o prêmio total negativo.');
    return;
  }

  if (tsTemPremiacaoManual(torneioAtual) && tsCentavos(tsSomaPremios(apPremiosSalvos())) > novoTotalCent) {
    await mostrarAlerta(`Sem este ajuste o prêmio ficaria em ${formatarMoeda(novoTotalCent / 100)}, menos que a soma das posições. Diminua ou remova posições antes de desfazer.`);
    return;
  }

  const descricao = `${valor > 0 ? 'adição' : 'subtração'} de ${formatarMoeda(Math.abs(valor))}${ajuste.observacao ? ` (${ajuste.observacao})` : ''}`;

  if (!await mostrarConfirm(`Desfazer a ${descricao}? O prêmio total volta para ${formatarMoeda(novoTotalCent / 100)}.`)) return;

  const { error } = await client.rpc('desfazer_ajuste_premiacao', { p_ajuste_id: Number(id) });

  if (error) {
    if (apErroSqlPendente(error)) return apAvisarSqlPendente();
    console.error(error);
    await mostrarAlerta('Erro ao desfazer o ajuste. Tente novamente.' + apDetalheErro(error));
    return;
  }

  await carregarDados();
}

// ---------- pagamento dos prêmios ao encerrar ----------

// { pagamentos: linhas de movimentacoes, linhas: texto do resumo,
//   semJogador: posições premiadas sem jogador na classificação, erro }
function montarPagamentosPremios() {

  const premios = premiosTorneioAtual();
  const total = apPremioTotal();
  const soma = tsSomaPremios(premios);

  if (tsCentavos(soma) > tsCentavos(total)) {
    return { erro: `A premiação por posição soma ${formatarMoeda(soma)}, mais que o prêmio total (${formatarMoeda(total)}). Corrija em Ajustar Prêmio antes de encerrar.` };
  }

  const pagamentos = [];
  const linhas = [];
  const semJogador = [];
  const agora = new Date().toISOString();

  premios.forEach(p => {

    if (!(p.valor > 0) && !p.texto) return;

    const resultado = resultadosTorneio.find(r => Number(r.posicao) === p.posicao);
    const premioTexto = tsTextoPremio(p, formatarMoeda);

    if (!resultado) {
      semJogador.push(`${p.posicao}º (${premioTexto})`);
      return;
    }

    linhas.push(`${p.posicao}º ${resultado.jogador}: ${premioTexto}${p.valor > 0 ? '' : ' (sem valor em dinheiro)'}`);

    if (!(p.valor > 0)) return;

    pagamentos.push({
      jogador: resultado.jogador,
      tipo: 'Saída',
      valor: Math.round(p.valor * 100) / 100,
      modalidade: 'Torneio',
      tipo_registro: 'Prêmio',
      torneio_id: torneioAtual.id,
      pago: false,
      data: agora,
      observacao: `Prêmio ${p.posicao}º lugar - ${torneioAtual.nome}${p.texto ? ` (${p.texto})` : ''}`
    });
  });

  return { pagamentos, linhas, semJogador };
}
