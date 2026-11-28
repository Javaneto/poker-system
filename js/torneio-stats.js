/*
 * Estatísticas de torneio usadas no Diretor e na Tela da TV:
 * fichas por entrada, Chip Count, jogadores restantes e Avg Stack.
 *
 * Fichas: cada tipo de entrada (torneio_valores.tipo) tem um montante de
 * fichas (coluna fichas, sql/010_fichas_torneio.sql). A movimentação guarda o
 * tipo em tipo_registro; as variantes "Buy-in Duplo", "Rebuy Triplo" usam a
 * linha "Duplo"/"Triplo".
 *
 * Eliminação: quem tem colocação em torneio_resultados (posição > 1) está fora.
 */

const TS_TIPOS_ENTRADA = ['Entrada', 'Registro', 'Rebuy', 'Add-on'];
const TS_NOMES_BUYIN = ['Buy-in', 'Free', 'Buy-in Free', 'Buy-in Duplo', 'Buy-in Triplo'];

function tsValorDaMovimentacao(mov, valores) {
  const tipo = String(mov.tipo_registro || '');
  return valores.find(v => v.tipo === tipo)
    || valores.find(v => tipo === `Buy-in ${v.tipo}` || tipo === `Rebuy ${v.tipo}`)
    || null;
}

function tsFichasDaMovimentacao(mov, valores) {
  const valor = tsValorDaMovimentacao(mov, valores);
  return Math.max(parseInt(valor?.fichas, 10) || 0, 0);
}

// Total de fichas que entraram no torneio (registros, rebuys e add-ons).
function tsChipCount(movs, valores) {
  return movs
    .filter(m => TS_TIPOS_ENTRADA.includes(m.tipo))
    .reduce((soma, m) => soma + tsFichasDaMovimentacao(m, valores), 0);
}

function tsJogadoresRegistrados(movs) {
  return Array.from(new Set(movs.filter(m => TS_NOMES_BUYIN.includes(m.tipo_registro)).map(m => m.jogador)));
}

// Jogadores registrados que já foram eliminados (têm colocação maior que 1).
function tsEliminados(registrados, resultados) {
  const nomes = new Set(registrados);
  return (resultados || []).filter(r => nomes.has(r.jogador) && Number(r.posicao) > 1);
}

function tsResumoJogadores(movs, resultados) {
  const registrados = tsJogadoresRegistrados(movs);
  const eliminados = tsEliminados(registrados, resultados);
  return { total: registrados.length, restantes: Math.max(registrados.length - eliminados.length, 0) };
}

function tsAvgStack(chipCount, restantes) {
  return restantes > 0 ? Math.round(chipCount / restantes) : 0;
}

function tsFormatarFichas(valor) {
  return Number(valor || 0).toLocaleString('pt-BR', { maximumFractionDigits: 0 });
}

// Pior colocação ainda livre (de N até 2) para o próximo eliminado.
function tsProximaPosicaoEliminacao(totalRegistrados, resultados) {
  const usadas = new Set((resultados || []).map(r => Number(r.posicao)).filter(p => p > 0));
  for (let p = totalRegistrados; p >= 2; p--) {
    if (!usadas.has(p)) return p;
  }
  return null;
}

// ---------------------------------------------------------------------------
// Premiação
// ---------------------------------------------------------------------------
// Prêmio total = soma do valor_prize das entradas + ajustes manuais.
// Por posição: a premiação manual do torneio (torneios.premiacao_manual,
// sql/011) quando houver; senão a estrutura de premiação arredondada.
// Contas em centavos inteiros para não acumular erro de ponto flutuante.

function tsCentavos(valor) {
  return Math.round(Number(valor || 0) * 100);
}

function tsPremioTotal(movs, torneio) {
  const prizeCent = (movs || []).reduce((soma, m) => soma + tsCentavos(m.valor_prize), 0);
  return (prizeCent + tsCentavos(torneio?.ajuste_premiacao)) / 100;
}

// Valores da estrutura (percentuais) arredondados para múltiplos de
// "arredondamento": fração ≥ 60% da unidade sobe; a sobra vai para a
// posição seguinte e o resto final fica com a última posição.
function tsValoresEstrutura(totalPrize, percentuais, arredondamento) {

  const lista = percentuais || [];
  const unidadeCent = tsCentavos(arredondamento);

  if (!unidadeCent || unidadeCent <= 0) {
    return lista.map(pct => Math.round(Number(totalPrize) * Number(pct)) / 100);
  }

  let sobraCent = 0;
  const resultadosCent = [];

  lista.forEach(pct => {
    const brutoCent = Math.round(Number(totalPrize) * Number(pct)) + sobraCent;
    const multiplos = Math.floor(brutoCent / unidadeCent);
    const restoCent = brutoCent - multiplos * unidadeCent;
    const valorCent = restoCent * 10 >= unidadeCent * 6 ? (multiplos + 1) * unidadeCent : multiplos * unidadeCent;
    sobraCent = brutoCent - valorCent;
    resultadosCent.push(valorCent);
  });

  if (resultadosCent.length > 0) {
    resultadosCent[resultadosCent.length - 1] += sobraCent;
  }

  return resultadosCent.map(c => c / 100);
}

function tsTemPremiacaoManual(torneio) {
  return Array.isArray(torneio?.premiacao_manual) && torneio.premiacao_manual.length > 0;
}

// [{ posicao, valor, texto }] na ordem das posições.
function tsPremiosTorneio(torneio, totalPrize, estrutura) {

  if (tsTemPremiacaoManual(torneio)) {
    return torneio.premiacao_manual.map((p, i) => ({
      posicao: i + 1,
      valor: Math.max(tsCentavos(p?.valor), 0) / 100,
      texto: String(p?.texto || '').trim()
    }));
  }

  if (!estrutura) return [];

  return tsValoresEstrutura(totalPrize, estrutura.percentuais, torneio?.arredondamento_premiacao)
    .map((valor, i) => ({ posicao: i + 1, valor, texto: '' }));
}

function tsSomaPremios(premios) {
  return (premios || []).reduce((soma, p) => soma + tsCentavos(p.valor), 0) / 100;
}

// "Bilhete + R$ 100", "Bilhete" ou "R$ 100".
function tsTextoPremio(premio, formatar) {
  const texto = String(premio?.texto || '').trim();
  const valor = Number(premio?.valor || 0);
  if (texto && valor > 0) return `${texto} + ${formatar(valor)}`;
  if (texto) return texto;
  return formatar(valor);
}
