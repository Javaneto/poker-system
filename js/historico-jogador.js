/*
 * Modal "Em Aberto" do jogador: histórico das movimentações em aberto
 * (cash e torneio, de todas as sessões ainda não fechadas) e botão Lançar
 * (Pagamento ou Dívida).
 *
 * Usado na página Em Aberto e no Cash Game (mesa).
 *
 * Usa as globais que a página já define:
 *   client, escapeHtml, mostrarAlerta, formatarMoeda, formatarDataHora,
 *   buscarTodas, calcularResultadoMovimentacoes
 *
 * Lançamentos gravados em movimentacoes com tipo 'Pagamento' (assim o
 * cálculo de saldo de todas as telas continua o mesmo):
 *   Pagamento → valor positivo, modalidade 'Cash' (jogador pagou: saldo +)
 *   Dívida    → valor negativo, modalidade 'Dívida' (jogador deve: saldo -)
 */

const HJ_TIPOS_ENTRADA = ['Entrada', 'Registro', 'Rebuy', 'Add-on'];

const historicoJogador = {
  nome: null,
  movs: [],
  torneios: [],
  opcoes: {},
  tipoLancamento: 'Pagamento',
  carregando: 0
};

function hjGarantirModais() {

  if (document.getElementById('modalHistJogador')) return;

  const html = `
    <div id="modalHistJogador" class="modal-overlay">
      <div class="modal-box" style="max-width:720px;">
        <h2 id="hjTitulo">Em Aberto</h2>

        <div class="topbar" style="margin-bottom:14px;">
          <div>
            <p style="color:var(--apagado);margin:0 0 4px;">Resultado</p>
            <p id="hjResultado" style="font-size:22px;margin:0;font-weight:800;">R$ 0,00</p>
          </div>

          <button type="button" id="hjBtnLancar" class="btn-green" onclick="abrirLancamentoJogador()">Lançar</button>
        </div>

        <div id="hjCarregando" class="hj-vazio oculto">Carregando...</div>

        <div id="hjConteudo" style="max-height:52vh;overflow-y:auto;">
          <div class="hj-colunas">
            <div class="hj-coluna">
              <div class="hj-coluna-topo">
                <h3>Cash</h3>
                <strong id="hjColCashTotal"></strong>
              </div>
              <div class="hj-coluna-sub" id="hjColCashSub"></div>
              <div id="hjColCash"></div>
            </div>

            <div class="hj-coluna">
              <div class="hj-coluna-topo">
                <h3>Torneio</h3>
                <strong id="hjColTorneioTotal"></strong>
              </div>
              <div class="hj-coluna-sub" id="hjColTorneioSub"></div>
              <div id="hjColTorneio"></div>
            </div>
          </div>

          <div id="hjBlocoLancamentos" class="hj-lancamentos oculto">
            <h3>Pagamentos e dívidas</h3>
            <div id="hjListaLancamentos"></div>
          </div>
        </div>

        <div class="modal-acoes" style="margin-top:16px;justify-content:space-between;">
          <button type="button" class="btn-gray" onclick="fecharHistoricoJogador()">Fechar</button>
          <button type="button" id="hjBtnFechamento" class="btn-red oculto" onclick="hjAbrirFechamento()">Fechamento</button>
        </div>
      </div>
    </div>

    <div id="modalLancarJogador" class="modal-overlay">
      <div class="modal-box" style="max-width:400px;">
        <h2>Lançar</h2>

        <p id="hjLancarResumo" class="modal-resumo"></p>

        <div class="modalidade-opcoes" style="margin-bottom:14px;">
          <button type="button" id="hjBtnTipoPagamento" class="modalidade-btn ativo" onclick="selecionarTipoLancamento('Pagamento')">Pagamento (+)</button>
          <button type="button" id="hjBtnTipoDivida" class="modalidade-btn" onclick="selecionarTipoLancamento('Dívida')">Dívida (−)</button>
        </div>

        <p id="hjLancarDica" class="hj-dica"></p>

        <input type="number" id="hjLancarValor" placeholder="Valor (R$)" min="0" step="0.01" inputmode="decimal">

        <textarea id="hjLancarObs" placeholder="Observação (obrigatória)" rows="2" maxlength="300" style="width:100%;box-sizing:border-box;margin-bottom:12px;resize:vertical;font:inherit;"></textarea>

        <div class="modal-acoes">
          <button type="button" class="btn-gray" onclick="hjFecharModal('modalLancarJogador')">Cancelar</button>
          <button type="button" id="hjBtnConfirmarLancar" class="btn-green" style="flex:1;" onclick="confirmarLancamentoJogador()">Confirmar</button>
        </div>
      </div>
    </div>
  `;

  // Antes dos modais da página: assim Aviso/Confirmar/Fechamento abrem por cima.
  const modelo = document.createElement('div');
  modelo.innerHTML = html;
  const primeiroModal = document.querySelector('body > .modal-overlay');

  [...modelo.children].forEach(el => {
    if (primeiroModal) document.body.insertBefore(el, primeiroModal);
    else document.body.appendChild(el);
  });
}

function hjFecharModal(id) {
  document.getElementById(id)?.classList.remove('aberto');
}

function hjValorCentavos(valor) {
  return Math.round(Number(valor || 0) * 100) / 100;
}

function hjHtmlValor(valor) {
  const v = hjValorCentavos(valor);
  if (Math.abs(v) < 0.005) return `<span class="hj-zero">${formatarMoeda(0)}</span>`;
  return `<span class="${v > 0 ? 'positivo' : 'negativo'}">${v > 0 ? '+' : '-'} ${formatarMoeda(Math.abs(v))}</span>`;
}

function hjTextoValor(valor) {
  const v = hjValorCentavos(valor);
  if (Math.abs(v) < 0.005) return formatarMoeda(0);
  return `${v > 0 ? '+' : '-'} ${formatarMoeda(Math.abs(v))}`;
}

function hjDataCurta(valor) {
  return new Date(valor).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
}

function hjEhLancamento(mov) {
  return mov.tipo === 'Pagamento';
}

// Nome mostrado para um lançamento do tipo Pagamento.
function rotuloLancamento(mov) {
  if (mov.modalidade === 'Dívida') return 'Dívida';
  return Number(mov.valor) < 0 ? 'Pago ao jogador' : 'Pagamento do jogador';
}

function hjNomeTorneio(id) {
  return historicoJogador.torneios.find(t => String(t.id) === String(id))?.nome || 'Torneio';
}

// ---------- abrir / carregar ----------

// opcoes: { aoMudar: () => void, aoFechamento: (nome, movs) => void }
async function abrirHistoricoJogador(nome, opcoes = {}) {

  hjGarantirModais();

  historicoJogador.nome = nome;
  historicoJogador.movs = [];
  historicoJogador.opcoes = opcoes;

  document.getElementById('hjTitulo').textContent = `Em Aberto — ${nome}`;
  document.getElementById('hjBtnFechamento').classList.toggle('oculto', !opcoes.aoFechamento);
  document.getElementById('modalHistJogador').classList.add('aberto');

  await recarregarHistoricoJogador({ mostrarCarregando: true });
}

function historicoJogadorAberto() {
  return !!historicoJogador.nome && !!document.getElementById('modalHistJogador')?.classList.contains('aberto');
}

async function recarregarHistoricoJogador({ mostrarCarregando = false } = {}) {

  if (!historicoJogadorAberto()) return;

  const nome = historicoJogador.nome;
  const chamada = ++historicoJogador.carregando;

  if (mostrarCarregando) {
    document.getElementById('hjCarregando').classList.remove('oculto');
    document.getElementById('hjConteudo').classList.add('oculto');
    document.getElementById('hjResultado').textContent = '-';
    document.getElementById('hjResultado').className = '';
    document.getElementById('hjBtnLancar').classList.add('disabled');
    document.getElementById('hjBtnFechamento').classList.add('disabled');
  }

  let movs;
  let torneios;

  try {
    movs = await buscarTodas(() => client
      .from('movimentacoes')
      .select('*')
      .eq('jogador', nome)
      .is('sessao_finalizada_em', null)
      .order('id', { ascending: true }));

    const ids = [...new Set((movs || []).filter(m => m.torneio_id).map(m => m.torneio_id))];

    torneios = [];

    if (ids.length) {
      const { data, error } = await client.from('torneios').select('id,nome').in('id', ids);
      if (error) throw error;
      torneios = data || [];
    }
  } catch (erro) {
    console.error(erro);
    movs = null;
  }

  // Outra carga começou (ou o modal mudou de jogador) enquanto esta rodava.
  if (chamada !== historicoJogador.carregando || nome !== historicoJogador.nome) return;

  if (!movs) {
    document.getElementById('hjCarregando').textContent = 'Erro ao carregar o histórico. Feche e tente de novo.';
    document.getElementById('hjCarregando').classList.remove('oculto');
    document.getElementById('hjConteudo').classList.add('oculto');
    return;
  }

  historicoJogador.movs = movs.sort((a, b) => new Date(b.data) - new Date(a.data));
  historicoJogador.torneios = torneios;

  document.getElementById('hjCarregando').textContent = 'Carregando...';
  document.getElementById('hjCarregando').classList.add('oculto');
  document.getElementById('hjConteudo').classList.remove('oculto');

  renderizarHistoricoJogador();
}

function fecharHistoricoJogador() {
  historicoJogador.nome = null;
  historicoJogador.movs = [];
  hjFecharModal('modalLancarJogador');
  hjFecharModal('modalHistJogador');
}

// ---------- render ----------

function hjHtmlLinhaMov(mov, { comTorneio = false } = {}) {

  let titulo = escapeHtml(mov.tipo);
  if (hjEhLancamento(mov)) titulo = escapeHtml(rotuloLancamento(mov));
  else if (mov.pago && HJ_TIPOS_ENTRADA.includes(mov.tipo)) titulo += ' · pago';

  const valor = hjEhLancamento(mov) ? Math.abs(Number(mov.valor)) : Number(mov.valor);
  const classeValor = mov.modalidade === 'Dívida' ? ' class="negativo"' : '';

  return `
    <div class="linha-desfazer">
      <div class="linha-desfazer-info">
        <strong>${titulo}</strong>
        ${comTorneio ? `<span style="color:var(--apagado);">${escapeHtml(hjNomeTorneio(mov.torneio_id))}</span>` : ''}
        <span style="color:var(--apagado-2);">${hjDataCurta(mov.data)}</span>
        ${mov.observacao ? `<span style="color:var(--apagado);font-style:italic;">Obs: ${escapeHtml(mov.observacao)}</span>` : ''}
      </div>
      <div class="linha-desfazer-valor">
        <strong${classeValor}>${formatarMoeda(valor)}</strong>
        <button type="button" class="btn-dark" onclick="imprimirMovimentacaoJogador(${Number(mov.id)})">Imprimir</button>
      </div>
    </div>
  `;
}

function hjRenderizarColuna(movs, prefixo, comTorneio) {

  const calc = calcularResultadoMovimentacoes(movs);

  document.getElementById(`hjCol${prefixo}Total`).innerHTML = movs.length ? hjHtmlValor(calc.resultado) : '';
  document.getElementById(`hjCol${prefixo}Sub`).textContent = movs.length ? `Entrou ${formatarMoeda(calc.entrada)} · Saiu ${formatarMoeda(calc.saida)}` : '';
  document.getElementById(`hjCol${prefixo}`).innerHTML = movs.length
    ? movs.map(m => hjHtmlLinhaMov(m, { comTorneio })).join('')
    : '<p class="hj-vazio">Nada em aberto.</p>';
}

function renderizarHistoricoJogador() {

  if (!historicoJogadorAberto()) return;

  const movs = historicoJogador.movs;

  const total = calcularResultadoMovimentacoes(movs).resultado;
  const el = document.getElementById('hjResultado');
  el.textContent = hjTextoValor(total);
  el.className = total >= 0 ? 'positivo' : 'negativo';

  const cash = movs.filter(m => !hjEhLancamento(m) && !m.torneio_id);
  const torneio = movs.filter(m => !hjEhLancamento(m) && m.torneio_id);
  const lancamentos = movs.filter(hjEhLancamento);

  hjRenderizarColuna(cash, 'Cash', false);
  hjRenderizarColuna(torneio, 'Torneio', true);

  document.getElementById('hjBlocoLancamentos').classList.toggle('oculto', lancamentos.length === 0);
  document.getElementById('hjListaLancamentos').innerHTML = lancamentos.map(m => hjHtmlLinhaMov(m)).join('');

  document.getElementById('hjBtnLancar').classList.remove('disabled');
  document.getElementById('hjBtnFechamento').classList.toggle('disabled', movs.length === 0);
}

function hjAbrirFechamento() {
  if (!historicoJogador.nome || !historicoJogador.opcoes.aoFechamento) return;
  if (document.getElementById('hjBtnFechamento').classList.contains('disabled')) return;
  historicoJogador.opcoes.aoFechamento(historicoJogador.nome, historicoJogador.movs);
}

// ---------- lançar (pagamento / dívida) ----------

function abrirLancamentoJogador() {

  if (!historicoJogador.nome) return;
  if (document.getElementById('hjBtnLancar').classList.contains('disabled')) return;

  document.getElementById('hjLancarResumo').textContent = `Jogador: ${historicoJogador.nome}`;
  document.getElementById('hjLancarValor').value = '';
  document.getElementById('hjLancarObs').value = '';
  selecionarTipoLancamento('Pagamento');
  document.getElementById('modalLancarJogador').classList.add('aberto');
  setTimeout(() => document.getElementById('hjLancarValor').focus(), 50);
}

function selecionarTipoLancamento(tipo) {

  historicoJogador.tipoLancamento = tipo;

  const pagamento = tipo === 'Pagamento';
  document.getElementById('hjBtnTipoPagamento').classList.toggle('ativo', pagamento);
  document.getElementById('hjBtnTipoDivida').classList.toggle('ativo', !pagamento);
  document.getElementById('hjLancarDica').textContent = pagamento
    ? 'O jogador pagou ao clube: o valor soma (+) no saldo dele.'
    : 'O jogador ficou devendo ao clube: o valor desconta (−) do saldo dele.';
}

async function confirmarLancamentoJogador() {

  const nome = historicoJogador.nome;
  const btn = document.getElementById('hjBtnConfirmarLancar');

  if (!nome || btn.classList.contains('disabled')) return;

  const valor = hjValorCentavos(parseFloat(document.getElementById('hjLancarValor').value));
  const observacao = document.getElementById('hjLancarObs').value.trim();
  const divida = historicoJogador.tipoLancamento === 'Dívida';

  if (!(valor > 0)) {
    await mostrarAlerta('Informe um valor válido.');
    return;
  }

  if (!observacao) {
    await mostrarAlerta('A observação é obrigatória.');
    document.getElementById('hjLancarObs').focus();
    return;
  }

  btn.classList.add('disabled');

  let cpf = null;
  let telefone = null;

  const { data: jogador } = await client
    .from('jogadores')
    .select('cpf,telefone')
    .eq('nome', nome)
    .limit(1)
    .maybeSingle();

  if (jogador) {
    cpf = jogador.cpf || null;
    telefone = jogador.telefone || null;
  }

  const { error } = await client
    .from('movimentacoes')
    .insert([{
      jogador: nome,
      tipo: 'Pagamento',
      valor: divida ? -valor : valor,
      modalidade: divida ? 'Dívida' : 'Cash',
      pago: false,
      data: new Date().toISOString(),
      cpf,
      telefone,
      observacao
    }]);

  btn.classList.remove('disabled');

  if (error) {
    console.error(error);
    await mostrarAlerta(divida ? 'Erro ao lançar a dívida.' : 'Erro ao lançar o pagamento.');
    return;
  }

  hjFecharModal('modalLancarJogador');
  await recarregarHistoricoJogador();
  if (historicoJogador.opcoes.aoMudar) historicoJogador.opcoes.aoMudar();
}

// ---------- impressão ----------

function imprimirMovimentacaoJogador(id) {

  const mov = historicoJogador.movs.find(m => Number(m.id) === Number(id));

  if (!mov) return;

  const janela = window.open('', '', 'width=420,height=700');

  if (!janela) {
    mostrarAlerta('O navegador bloqueou a janela de impressão.');
    return;
  }

  const tipo = hjEhLancamento(mov) ? rotuloLancamento(mov) : mov.tipo;

  janela.document.write(`
    <html>
    <head>
      <style>
        @page { size: 79mm auto; margin: 2mm; }
        html, body { width: 75mm; margin: 0; padding: 0; font-family: monospace; font-size: 15px; font-weight: 600; line-height: 1.2; overflow: hidden; }
        h2, p { margin: 0; padding: 0; }
      </style>
    </head>
    <body>
      <h2 style="text-align:center;margin:0 0 4px 0;font-size:22px;">RPG Poker Club</h2>
      <p style="text-align:center;margin:0 0 10px 0;font-size:14px;">Termo de Movimentação</p>
      <br>
      <p>Eu, ${escapeHtml(mov.jogador)}, declaro movimentação no valor de:</p>
      <h2 style="text-align:center;">${formatarMoeda(Math.abs(Number(mov.valor)))}</h2>
      <br>
      <p>Tipo: ${escapeHtml(tipo)}</p>
      <p>Modalidade: ${escapeHtml(mov.torneio_id ? 'Torneio' : (mov.modalidade || '-'))}</p>
      ${mov.observacao ? `<p>Obs: ${escapeHtml(mov.observacao)}</p>` : ''}
      <p>CPF: ${escapeHtml(mov.cpf || '-')}</p>
      <p>Telefone: ${escapeHtml(mov.telefone || '-')}</p>
      <br><br><br>
      ____________________________
      <br>
      Assinatura
      <br><br>
      ${escapeHtml(formatarDataHora(mov.data))}
    </body>
    </html>
  `);

  janela.document.close();
  janela.print();
}

// ---------- Esc ----------

// Fase de captura: roda antes do Esc da página. Só fecha os nossos modais
// quando nenhum modal da página (aviso, confirmar, fechamento) está por cima.
document.addEventListener('keydown', e => {

  if (e.key !== 'Escape' || !document.getElementById('modalHistJogador')) return;

  const nossos = ['modalHistJogador', 'modalLancarJogador'];
  const outrosAbertos = [...document.querySelectorAll('.modal-overlay.aberto')].some(el => !nossos.includes(el.id));

  if (outrosAbertos) return;

  if (document.getElementById('modalLancarJogador').classList.contains('aberto')) {
    hjFecharModal('modalLancarJogador');
    e.stopImmediatePropagation();
  } else if (historicoJogadorAberto()) {
    fecharHistoricoJogador();
    e.stopImmediatePropagation();
  }
}, true);
