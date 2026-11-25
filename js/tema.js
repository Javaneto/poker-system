// Tema claro/escuro do RPG Poker Club, compartilhado por todas as páginas.
// Incluir no <head> de cada página (antes do CSS ser aplicado), para não piscar:
//   <script src="js/tema.js"></script>
// - Guarda a escolha no navegador e aplica <html data-tema="claro|escuro">.
// - Muda junto em todas as abas abertas.
// - Qualquer botão com [data-alternar-tema] alterna o tema ao ser clicado.
(function () {

  const CHAVE = 'rpgPokerClubTema';
  const CHAVE_ANTIGA = 'rpgPokerClubModoEscuro'; // usada pelo botão antigo do Diretor

  function lerTemaSalvo() {
    try {
      const salvo = localStorage.getItem(CHAVE);
      if (salvo === 'claro' || salvo === 'escuro') return salvo;
      if (localStorage.getItem(CHAVE_ANTIGA) === '1') return 'escuro';
    } catch (e) { /* navegador sem storage: segue no claro */ }
    return 'claro';
  }

  function aplicar(tema) {
    document.documentElement.dataset.tema = tema;
    document.documentElement.style.colorScheme = tema === 'escuro' ? 'dark' : 'light';
    document.querySelectorAll('[data-alternar-tema]').forEach(atualizarBotao);
  }

  function atualizarBotao(botao) {
    const escuro = document.documentElement.dataset.tema === 'escuro';
    const rotulo = escuro ? 'Mudar para o modo claro' : 'Mudar para o modo escuro';
    botao.setAttribute('aria-pressed', escuro ? 'true' : 'false');
    botao.setAttribute('aria-label', rotulo);
    botao.title = rotulo;
  }

  function definirTema(tema) {
    aplicar(tema);
    try { localStorage.setItem(CHAVE, tema); } catch (e) { /* ignora */ }
  }

  function alternarTema() {
    definirTema(document.documentElement.dataset.tema === 'escuro' ? 'claro' : 'escuro');
  }

  window.temaAtual = function () { return document.documentElement.dataset.tema; };
  window.definirTema = definirTema;
  window.alternarTema = alternarTema;

  aplicar(lerTemaSalvo());

  // Outra aba mudou o tema: acompanha.
  window.addEventListener('storage', function (e) {
    if (e.key === CHAVE && (e.newValue === 'claro' || e.newValue === 'escuro')) aplicar(e.newValue);
  });

  document.addEventListener('click', function (e) {
    const botao = e.target.closest && e.target.closest('[data-alternar-tema]');
    if (botao) alternarTema();
  });

  document.addEventListener('DOMContentLoaded', function () {
    document.querySelectorAll('[data-alternar-tema]').forEach(atualizarBotao);
  });
})();
