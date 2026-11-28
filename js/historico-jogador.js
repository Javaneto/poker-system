/*
 * Modal "Em Aberto" do jogador: histórico das movimentações em aberto
 * (cash e torneio, de todas as sessões ainda não fechadas), botão Lançar
 * (Pagamento ou Cobrança) e Fechamento.
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
 *   Cobrança  → valor negativo, modalidade 'Cobrança' (jogador deve: saldo -)
 *   (lançamentos antigos com modalidade 'Dívida' também contam como Cobrança)
 */

const HJ_TIPOS_ENTRADA = ['Entrada', 'Registro', 'Rebuy', 'Add-on'];
const HJ_MODALIDADES_COBRANCA = ['Cobrança', 'Dívida'];

function hjEhCobranca(mov) {
  return HJ_MODALIDADES_COBRANCA.includes(mov.modalidade);
}

const historicoJogador = {
  nome: null,
  movs: [],
  torneios: [],
  opcoes: {},
  tipoLancamento: 'Pagamento',
  carregando: 0,
  fechamento: null   // { nome, ids, saldoAnterior, sessao, total }
};

function hjGarantirModais() {

  if (document.getElementById('modalHistJogador')) return;

  const html = `
    <div id="modalHistJogador" class="modal-overlay">
      <div class="modal-box" style="max-width:720px;">
        <h2 id="hjTitulo">Em Aberto</h2>

        <div class="topbar" style="margin-bottom:14px;">
          <div class="hj-resultado-topo">
            <span>Resultado</span>
            <strong id="hjResultado">R$ 0,00</strong>
          </div>

          <button type="button" id="hjBtnLancar" class="btn-green btn-com-icone" onclick="abrirLancamentoJogador()">
            <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" aria-hidden="true"><path d="M12 5v14M5 12h14"/></svg>
            <span>Lançar</span>
          </button>
        </div>

        <div id="hjCarregando" class="hj-vazio oculto">Carregando...</div>

        <div id="hjConteudo" style="max-height:52vh;overflow-y:auto;">
          <div class="hj-colunas">
            <div class="hj-coluna">
              <div class="hj-coluna-topo">
                <h3>Cash</h3>
                <div class="hj-coluna-sub" id="hjColCashSub"></div>
                <strong id="hjColCashTotal"></strong>
              </div>
              <div id="hjColCash"></div>
            </div>

            <div class="hj-coluna">
              <div class="hj-coluna-topo">
                <h3>Torneio</h3>
                <div class="hj-coluna-sub" id="hjColTorneioSub"></div>
                <strong id="hjColTorneioTotal"></strong>
              </div>
              <div id="hjColTorneio"></div>
            </div>
          </div>

          <div id="hjBlocoLancamentos" class="hj-lancamentos oculto">
            <h3>Pagamentos e cobranças</h3>
            <div id="hjListaLancamentos"></div>
          </div>
        </div>

        <div class="modal-acoes" style="margin-top:16px;justify-content:space-between;">
          <button type="button" class="btn-gray" onclick="fecharHistoricoJogador()">Fechar</button>
          <button type="button" id="hjBtnFechamento" class="btn-red" onclick="hjAbrirFechamento()">Fechamento</button>
        </div>
      </div>
    </div>

    <div id="modalLancarJogador" class="modal-overlay">
      <div class="modal-box" style="max-width:400px;">
        <h2 id="hjLancarTitulo">Registrar Pagamento</h2>

        <p id="hjLancarResumo" class="modal-resumo"></p>

        <div class="hj-tipos-lancamento" role="group" aria-label="Tipo de lançamento">
          <button type="button" id="hjBtnTipoPagamento" class="hj-tipo-lanc pagamento ativo" aria-pressed="true" onclick="selecionarTipoLancamento('Pagamento')">
            <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 2v20M17 5.5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"/></svg>
            <span>Registrar Pagamento</span>
          </button>
          <button type="button" id="hjBtnTipoCobranca" class="hj-tipo-lanc debito" aria-pressed="false" onclick="selecionarTipoLancamento('Cobrança')">
            <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" aria-hidden="true"><path d="M5 12h14"/></svg>
            <span>Lançar Débito</span>
          </button>
        </div>

        <label class="rotulo-campo" for="hjLancarValor">Valor (R$)</label>
        <input type="number" id="hjLancarValor" placeholder="0,00" min="0" step="0.01" inputmode="decimal">

        <label class="rotulo-campo" for="hjLancarObs" id="hjLancarObsRotulo">Observações *</label>
        <textarea id="hjLancarObs" placeholder="Observações" rows="2" maxlength="300" style="width:100%;box-sizing:border-box;margin-bottom:8px;resize:vertical;font:inherit;"></textarea>

        <p id="hjLancarDica" class="hj-dica"></p>

        <div class="modal-acoes">
          <button type="button" class="btn-gray" onclick="hjFecharModal('modalLancarJogador')">Cancelar</button>
          <button type="button" id="hjBtnConfirmarLancar" class="btn-green" style="flex:1;" onclick="confirmarLancamentoJogador()">Registrar Pagamento</button>
        </div>
      </div>
    </div>

    <div id="modalFechamento" class="modal-overlay">
      <div class="modal-box" style="max-width:480px;">
        <h2 id="fechamentoTitulo">Fechamento</h2>

        <div id="fechamentoCarregando" class="hj-dica">Carregando saldo do jogador...</div>

        <div id="fechamentoConteudo" class="oculto">
          <div class="hj-resumo">
            <div class="hj-resumo-linha">
              <span>Saldo anterior do jogador</span>
              <strong id="fechSaldoAnterior"></strong>
            </div>
            <div class="hj-resumo-linha">
              <span>Resultado desta sessão</span>
              <strong id="fechSessao"></strong>
            </div>
            <div class="hj-resumo-linha total">
              <span>Saldo total</span>
              <strong id="fechTotal"></strong>
            </div>
          </div>

          <div id="fechamentoZerado" class="hj-caixa oculto">Saldo zerado: nada a receber nem a pagar.</div>

          <div id="fechamentoAcerto">
            <label class="hj-rotulo" for="fechValor" id="fechRotulo">Receber agora (R$)</label>

            <div class="hj-campo-valor">
              <input type="number" id="fechValor" min="0" step="0.01" inputmode="decimal" placeholder="0,00" oninput="hjAtualizarFechamento()">
              <button type="button" class="btn-gray" id="btnFechTudo" onclick="hjPreencherTudoFechamento()">Tudo</button>
            </div>

            <p class="hj-dica" id="fechDica"></p>

            <div class="hj-caixa" id="fechPrevia"></div>
          </div>

          <label class="hj-caixa hj-check">
            <input type="checkbox" id="fechConferi" onchange="hjAtualizarFechamento()">
            <span id="fechTextoConferi"></span>
          </label>
        </div>

        <div class="modal-acoes" style="margin-top:6px;">
          <button type="button" class="btn-gray" onclick="hjFecharModal('modalFechamento')">Cancelar</button>
          <button type="button" id="btnConfirmarFechamento" class="btn-green disabled" onclick="hjConfirmarFechamento()">Confirmar fechamento</button>
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
  if (hjEhCobranca(mov)) return 'Cobrança';
  return Number(mov.valor) < 0 ? 'Pago ao jogador' : 'Pagamento do jogador';
}

function hjNomeTorneio(id) {
  return historicoJogador.torneios.find(t => String(t.id) === String(id))?.nome || 'Torneio';
}

// ---------- abrir / carregar ----------

// opcoes: { aoMudar: () => void }  (chamado depois de lançar ou fechar)
async function abrirHistoricoJogador(nome, opcoes = {}) {

  hjGarantirModais();

  historicoJogador.nome = nome;
  historicoJogador.movs = [];
  historicoJogador.opcoes = opcoes;

  document.getElementById('hjTitulo').textContent = `Em Aberto — ${nome}`;
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
  historicoJogador.fechamento = null;
  hjFecharModal('modalFechamento');
  hjFecharModal('modalLancarJogador');
  hjFecharModal('modalHistJogador');
}

// ---------- render ----------

const HJ_ICONE_IMPRIMIR = `<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M7 9V3.8c0-.4.4-.8.8-.8h8.4c.4 0 .8.4.8.8V9"/><rect x="3" y="9" width="18" height="8" rx="2.2"/><path d="M7 14h10v6.2c0 .4-.4.8-.8.8H7.8c-.4 0-.8-.4-.8-.8V14Z"/><path d="M10 17.5h4"/><circle cx="17.5" cy="11.8" r=".9" fill="currentColor" stroke="none"/></svg>`;

function hjHtmlLinhaMov(mov, { comTorneio = false } = {}) {

  let titulo = escapeHtml(mov.tipo);
  if (hjEhLancamento(mov)) titulo = escapeHtml(rotuloLancamento(mov));
  else if (mov.pago && HJ_TIPOS_ENTRADA.includes(mov.tipo)) titulo += ' · pago';

  const valor = hjEhLancamento(mov) ? Math.abs(Number(mov.valor)) : Number(mov.valor);
  const classeValor = hjEhCobranca(mov) ? ' class="negativo"' : '';

  return `
    <div class="hj-mov">
      <div class="hj-mov-info">
        <strong>${titulo}</strong>
        ${comTorneio ? `<span>${escapeHtml(hjNomeTorneio(mov.torneio_id))}</span>` : ''}
      </div>
      <span class="hj-mov-data">${hjDataCurta(mov.data)}</span>
      <div class="hj-mov-valor">
        <strong${classeValor}>${formatarMoeda(valor)}</strong>
        <button type="button" class="hj-btn-imprimir" title="Imprimir" aria-label="Imprimir" onclick="imprimirMovimentacaoJogador(${Number(mov.id)})">${HJ_ICONE_IMPRIMIR}</button>
      </div>
      ${mov.observacao ? `<span class="hj-mov-obs">Obs: ${escapeHtml(mov.observacao)}</span>` : ''}
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


// ---------- lançar (pagamento / cobrança) ----------

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

  // Mesmos textos de Jogadores (Registrar Pagamento / Lançar Débito).
  const pagamento = tipo === 'Pagamento';
  const btnPag = document.getElementById('hjBtnTipoPagamento');
  const btnDeb = document.getElementById('hjBtnTipoCobranca');
  btnPag.classList.toggle('ativo', pagamento);
  btnDeb.classList.toggle('ativo', !pagamento);
  btnPag.setAttribute('aria-pressed', pagamento ? 'true' : 'false');
  btnDeb.setAttribute('aria-pressed', pagamento ? 'false' : 'true');

  document.getElementById('hjLancarTitulo').textContent = pagamento ? 'Registrar Pagamento' : 'Lançar Débito Manual';
  document.getElementById('hjLancarObsRotulo').textContent = pagamento ? 'Observações *' : 'Descrição / Motivo *';
  document.getElementById('hjLancarObs').placeholder = pagamento ? 'Observações' : 'Ex: Mensalidade, multa, ajuste...';
  document.getElementById('hjLancarDica').textContent = pagamento
    ? 'O jogador pagou ao clube: o valor soma (+) no saldo dele.'
    : 'O valor desconta (−) do saldo do jogador: ele passa a dever ao clube.';

  const confirmar = document.getElementById('hjBtnConfirmarLancar');
  confirmar.textContent = pagamento ? 'Registrar Pagamento' : 'Confirmar Débito';
  confirmar.classList.toggle('btn-green', pagamento);
  confirmar.classList.toggle('btn-red', !pagamento);
}

async function confirmarLancamentoJogador() {

  const nome = historicoJogador.nome;
  const btn = document.getElementById('hjBtnConfirmarLancar');

  if (!nome || btn.classList.contains('disabled')) return;

  const valor = hjValorCentavos(parseFloat(document.getElementById('hjLancarValor').value));
  const observacao = document.getElementById('hjLancarObs').value.trim();
  const cobranca = historicoJogador.tipoLancamento === 'Cobrança';

  if (!(valor > 0)) {
    await mostrarAlerta('Informe um valor válido.');
    return;
  }

  if (!observacao) {
    await mostrarAlerta(cobranca ? 'Informe a descrição / motivo do débito.' : 'A observação é obrigatória.');
    document.getElementById('hjLancarObs').focus();
    return;
  }

  btn.classList.add('disabled');

  const { error } = await client
    .from('movimentacoes')
    .insert([{
      jogador: nome,
      tipo: 'Pagamento',
      valor: cobranca ? -valor : valor,
      modalidade: cobranca ? 'Cobrança' : 'Cash',
      pago: false,
      data: new Date().toISOString(),
      observacao
    }]);

  btn.classList.remove('disabled');

  if (error) {
    console.error(error);
    await mostrarAlerta(cobranca ? 'Erro ao lançar a cobrança.' : 'Erro ao lançar o pagamento.');
    return;
  }

  hjFecharModal('modalLancarJogador');
  await recarregarHistoricoJogador();
  if (historicoJogador.opcoes.aoMudar) historicoJogador.opcoes.aoMudar();
}

// ---------- fechamento ----------

async function hjInserirPagamento(nome, valor, observacao) {

  return client
    .from('movimentacoes')
    .insert([{
      jogador: nome,
      tipo: 'Pagamento',
      valor,
      modalidade: 'Cash',
      pago: false,
      data: new Date().toISOString(),
      ...(observacao ? { observacao } : {})
    }])
    .select()
    .single();
}

async function hjAbrirFechamento() {

  const nome = historicoJogador.nome;
  const movs = historicoJogador.movs;

  if (!nome || !movs.length) return;
  if (document.getElementById('hjBtnFechamento').classList.contains('disabled')) return;

  document.getElementById('fechamentoTitulo').textContent = `Fechamento — ${nome}`;
  document.getElementById('fechamentoCarregando').classList.remove('oculto');
  document.getElementById('fechamentoConteudo').classList.add('oculto');
  document.getElementById('btnConfirmarFechamento').classList.add('disabled');
  document.getElementById('modalFechamento').classList.add('aberto');

  // Saldo anterior = sessões já fechadas do jogador (mesmo número da tela Jogadores).
  let anteriores;

  try {
    anteriores = await buscarTodas(() => client
      .from('movimentacoes')
      .select('id,tipo,valor,pago')
      .eq('jogador', nome)
      .not('sessao_finalizada_em', 'is', null)
      .order('id', { ascending: true }));
  } catch (e) {
    anteriores = null;
    console.error(e);
  }

  if (!anteriores) {
    hjFecharModal('modalFechamento');
    await mostrarAlerta('Não foi possível carregar o saldo do jogador. Tente novamente.');
    return;
  }

  const saldoAnterior = hjValorCentavos(calcularResultadoMovimentacoes(anteriores).resultado);
  const sessao = hjValorCentavos(calcularResultadoMovimentacoes(movs).resultado);

  const f = historicoJogador.fechamento = {
    nome,
    ids: movs.map(m => m.id),
    saldoAnterior,
    sessao,
    total: hjValorCentavos(saldoAnterior + sessao)
  };

  document.getElementById('fechSaldoAnterior').innerHTML = hjHtmlValor(saldoAnterior);
  document.getElementById('fechSessao').innerHTML = hjHtmlValor(sessao);
  document.getElementById('fechTotal').innerHTML = hjHtmlValor(f.total);

  const zerado = Math.abs(f.total) < 0.005;
  const jogadorDeve = f.total < 0;

  document.getElementById('fechamentoZerado').classList.toggle('oculto', !zerado);
  document.getElementById('fechamentoAcerto').classList.toggle('oculto', zerado);

  document.getElementById('fechRotulo').textContent = jogadorDeve ? 'Receber do jogador agora (R$)' : 'Pagar ao jogador agora (R$)';
  document.getElementById('btnFechTudo').textContent = `Tudo (${formatarMoeda(Math.abs(f.total))})`;
  document.getElementById('fechDica').textContent = jogadorDeve
    ? 'O jogador está devendo. Digite quanto ele paga agora. Vazio = tudo fica no saldo do jogador; valor parcial deixa o restante no saldo; valor maior vira crédito do jogador.'
    : 'O clube deve ao jogador. Digite quanto o clube paga agora. Vazio = tudo fica no saldo do jogador; valor parcial deixa o restante no saldo; valor maior fica como dívida do jogador.';

  document.getElementById('fechValor').value = '';
  document.getElementById('fechConferi').checked = false;

  document.getElementById('fechamentoCarregando').classList.add('oculto');
  document.getElementById('fechamentoConteudo').classList.remove('oculto');

  hjAtualizarFechamento();
}

function hjPreencherTudoFechamento() {
  const f = historicoJogador.fechamento;
  if (!f) return;
  document.getElementById('fechValor').value = Math.abs(f.total).toFixed(2);
  hjAtualizarFechamento();
}

function hjValorAgoraFechamento() {
  const v = hjValorCentavos(parseFloat(document.getElementById('fechValor').value));
  return isNaN(v) || v < 0 ? 0 : v;
}

function hjAtualizarFechamento() {

  const f = historicoJogador.fechamento;
  if (!f) return;

  const total = f.total;
  const zerado = Math.abs(total) < 0.005;
  const jogadorDeve = total < 0;
  const maximo = Math.abs(total);
  const agora = hjValorAgoraFechamento();
  const excedeu = agora > maximo + 0.004;

  // Saldo que fica para o jogador depois do fechamento.
  const restante = zerado ? 0 : hjValorCentavos(jogadorDeve ? total + agora : total - agora);

  const verbo = jogadorDeve ? 'Receber agora' : 'Pagar agora';
  const previa = document.getElementById('fechPrevia');

  previa.innerHTML = `${verbo}: <strong>${formatarMoeda(agora)}</strong>. Fica no saldo do jogador: <strong>${hjHtmlValor(restante)}</strong>.`;

  // Valor acima do saldo é permitido: a diferença vira crédito (ou dívida) do jogador.
  if (excedeu) {
    previa.innerHTML += `<br><span style="color:var(--tx-ambar);font-size:13px;">O valor passa do saldo (${formatarMoeda(maximo)}): ${jogadorDeve ? 'o jogador fica com crédito' : 'o jogador fica devendo'} de ${formatarMoeda(Math.abs(restante))}.</span>`;
  }

  let texto;

  if (zerado) {
    texto = 'Conferi todos os lançamentos. Confirmo este fechamento.';
  } else if (agora > 0) {
    texto = `Conferi todos os lançamentos e o ${jogadorDeve ? 'recebimento' : 'pagamento ao jogador'} de ${formatarMoeda(agora)}, ficando ${hjTextoValor(restante)} no saldo do jogador. Confirmo este fechamento.`;
  } else {
    texto = `Conferi todos os lançamentos. Nada ${jogadorDeve ? 'recebido' : 'pago'} agora: ${hjTextoValor(restante)} fica no saldo do jogador. Confirmo este fechamento.`;
  }

  document.getElementById('fechTextoConferi').textContent = texto;
  document.getElementById('btnConfirmarFechamento').classList.toggle('disabled', !document.getElementById('fechConferi').checked);
}

async function hjConfirmarFechamento() {

  const f = historicoJogador.fechamento;
  const btn = document.getElementById('btnConfirmarFechamento');

  if (!f || btn.classList.contains('disabled')) return;
  if (!document.getElementById('fechConferi').checked) return;

  const total = f.total;
  const zerado = Math.abs(total) < 0.005;
  const agora = zerado ? 0 : hjValorAgoraFechamento();
  const aoMudar = historicoJogador.opcoes.aoMudar;

  btn.classList.add('disabled');

  const ids = [...f.ids];

  if (agora > 0) {

    // Jogador devendo: pagamento positivo (abate a dívida).
    // Clube devendo: pagamento negativo (abate o crédito do jogador).
    const jogadorDeve = total < 0;
    const { data, error } = await hjInserirPagamento(
      f.nome,
      jogadorDeve ? agora : -agora,
      jogadorDeve ? 'Recebido no fechamento' : 'Pago ao jogador no fechamento'
    );

    if (error || !data) {
      console.error(error);
      btn.classList.remove('disabled');
      await mostrarAlerta('Erro ao registrar o ' + (jogadorDeve ? 'recebimento' : 'pagamento') + '. Nada foi fechado; tente novamente.');
      return;
    }

    ids.push(data.id);
  }

  const { error } = await client
    .from('movimentacoes')
    .update({ sessao_finalizada_em: new Date().toISOString() })
    .in('id', ids)
    .is('sessao_finalizada_em', null);

  if (error) {
    console.error(error);
    btn.classList.remove('disabled');
    await mostrarAlerta('Erro ao fechar a sessão. ' + (agora > 0 ? 'O valor recebido/pago já foi lançado e aparece na lista; ' : '') + 'tente o fechamento de novo.');
    await recarregarHistoricoJogador();
    if (aoMudar) aoMudar();
    return;
  }

  fecharHistoricoJogador();
  if (aoMudar) aoMudar();
}

// ---------- impressão ----------

async function imprimirMovimentacaoJogador(id) {

  const mov = historicoJogador.movs.find(m => Number(m.id) === Number(id));

  if (!mov) return;

  const janela = window.open('', '', 'width=420,height=700');

  if (!janela) {
    mostrarAlerta('O navegador bloqueou a janela de impressão.');
    return;
  }

  const tipo = hjEhLancamento(mov) ? rotuloLancamento(mov) : mov.tipo;

  // CPF/telefone vêm do cadastro; lançamentos antigos guardavam uma cópia.
  const { data: cadastro } = await client
    .from('jogadores')
    .select('cpf,telefone')
    .eq('nome', mov.jogador)
    .maybeSingle();

  const cpf = cadastro?.cpf || mov.cpf || '-';
  const telefone = cadastro?.telefone || mov.telefone || '-';

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
      <p>CPF: ${escapeHtml(cpf)}</p>
      <p>Telefone: ${escapeHtml(telefone)}</p>
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
// quando nenhum modal da página (aviso, confirmar) está por cima.
document.addEventListener('keydown', e => {

  if (e.key !== 'Escape' || !document.getElementById('modalHistJogador')) return;

  const nossos = ['modalHistJogador', 'modalLancarJogador', 'modalFechamento'];
  const outrosAbertos = [...document.querySelectorAll('.modal-overlay.aberto')].some(el => !nossos.includes(el.id));

  if (outrosAbertos) return;

  if (document.getElementById('modalFechamento').classList.contains('aberto')) {
    hjFecharModal('modalFechamento');
    e.stopImmediatePropagation();
  } else if (document.getElementById('modalLancarJogador').classList.contains('aberto')) {
    hjFecharModal('modalLancarJogador');
    e.stopImmediatePropagation();
  } else if (historicoJogadorAberto()) {
    fecharHistoricoJogador();
    e.stopImmediatePropagation();
  }
}, true);
