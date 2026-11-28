/*
 * Paginação das listas de cards (Torneios e Cash Game).
 *
 * Quantos cards por página depende de quantas colunas cabem na tela:
 *   3 colunas  -> 9 (3 x 3)
 *   2 colunas  -> 8 (4 x 2, celular)
 *   4 ou mais  -> 2 linhas (4 colunas = 8)
 *
 * Uso:
 *   const pag = criarPaginacaoCards({ grid, aoMudar: () => renderizar() });
 *   const visiveis = pag.fatiar(itens);   // itens da página atual
 *   pag.voltarInicio();                   // ao trocar filtro
 */

function colunasDoGrid(grid) {
  const colunas = getComputedStyle(grid).gridTemplateColumns.split(' ').filter(Boolean).length;
  return Math.max(colunas, 1);
}

function cardsPorPagina(grid) {
  const colunas = colunasDoGrid(grid);
  if (colunas === 3) return 9;
  if (colunas <= 2) return 8;
  return colunas * 2;
}

function criarPaginacaoCards({ grid, aoMudar }) {

  let pagina = 1;
  let porPagina = cardsPorPagina(grid);

  const barra = document.createElement('nav');
  barra.className = 'paginacao-cards oculto';
  barra.setAttribute('aria-label', 'Páginas');
  grid.insertAdjacentElement('afterend', barra);

  function irPara(n) {
    pagina = n;
    aoMudar();
    grid.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }

  function desenharBarra(totalPaginas) {

    barra.classList.toggle('oculto', totalPaginas <= 1);
    if (totalPaginas <= 1) { barra.innerHTML = ''; return; }

    barra.innerHTML = `
      <button type="button" class="btn-gray paginacao-btn" data-ir="${pagina - 1}" ${pagina <= 1 ? 'disabled' : ''} aria-label="Página anterior">‹ Anterior</button>
      <span class="paginacao-info">Página ${pagina} de ${totalPaginas}</span>
      <button type="button" class="btn-gray paginacao-btn" data-ir="${pagina + 1}" ${pagina >= totalPaginas ? 'disabled' : ''} aria-label="Próxima página">Próxima ›</button>
    `;

    barra.querySelectorAll('[data-ir]').forEach(b => {
      b.onclick = () => irPara(Number(b.dataset.ir));
    });
  }

  // Mudou o tamanho da tela e com isso a quantidade de colunas: refaz a página.
  let espera = null;
  window.addEventListener('resize', () => {
    clearTimeout(espera);
    espera = setTimeout(() => {
      const novo = cardsPorPagina(grid);
      if (novo === porPagina) return;
      const primeiro = (pagina - 1) * porPagina;
      porPagina = novo;
      pagina = Math.floor(primeiro / porPagina) + 1;
      aoMudar();
    }, 200);
  });

  return {
    fatiar(itens) {
      porPagina = cardsPorPagina(grid);
      const totalPaginas = Math.max(Math.ceil(itens.length / porPagina), 1);
      pagina = Math.min(Math.max(pagina, 1), totalPaginas);
      desenharBarra(itens.length ? totalPaginas : 1);
      return itens.slice((pagina - 1) * porPagina, pagina * porPagina);
    },
    voltarInicio() {
      pagina = 1;
    },
    esconder() {
      desenharBarra(1);
    }
  };
}
