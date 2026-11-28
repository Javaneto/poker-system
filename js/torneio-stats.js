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
