// Menu lateral unificado do RPG Poker Club.
// Basta incluir <script src="js/menu.js"></script> no <head> da página.
// - Desktop: barra fixa à esquerda, recolhível (só ícones). Estado salvo no navegador.
// - Celular (< 768px) e telas de TV (<body data-menu="overlay">): gaveta aberta pelo botão ☰.
(function () {

  const CHAVE_RECOLHIDO = 'rpgPokerClubMenuRecolhido';

  const ICONES = {
    cash: '<path d="M3 7h18v10H3z"/><circle cx="12" cy="12" r="2.5"/><path d="M6 10v4M18 10v4"/>',
    diretor: '<circle cx="12" cy="13" r="8"/><path d="M12 9v4l2.5 2.5M9 2h6"/>',
    tv: '<rect x="2" y="4" width="20" height="13" rx="2"/><path d="M8 21h8M12 17v4"/>',
    torneios: '<path d="M8 21h8M12 17v4M7 4h10v5a5 5 0 0 1-10 0z"/><path d="M17 5h3v2a3 3 0 0 1-3 3M7 5H4v2a3 3 0 0 0 3 3"/>',
    jogadores: '<circle cx="9" cy="8" r="3.5"/><path d="M2 20c0-3.5 3-6 7-6s7 2.5 7 6"/><circle cx="17" cy="9" r="2.5"/><path d="M17 14c2.8 0 5 2 5 5"/>',
    ranking: '<path d="M4 20V11M10 20V5M16 20v-6M22 20H2"/>',
    cadastro: '<circle cx="10" cy="8" r="3.5"/><path d="M3 20c0-3.5 3-6 7-6 1.5 0 2.9.3 4 1M18 14v6M15 17h6"/>',
    config: '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/>',
    aberto: '<path d="M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h5"/><path d="M14 3l5 5h-5z"/><path d="M8 9h3M8 13h4"/><circle cx="17" cy="17" r="4.5"/><path d="M17 15v2.2l1.4 1"/>',
    relatorio: '<path d="M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 3v5h5"/><path d="M8 18v-2M12 18v-4.5M16 18v-7"/>',
    sair: '<path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4M16 17l5-5-5-5M21 12H9"/>',
    recolher: '<path d="M15 18l-6-6 6-6"/>',
    menu: '<path d="M3 6h18M3 12h18M3 18h18"/>',
    fechar: '<path d="M18 6L6 18M6 6l12 12"/>'
  };

  function icone(nome) {
    return '<svg class="mnu-ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + ICONES[nome] + '</svg>';
  }

  let pagina = (location.pathname.split('/').pop() || 'index.html').toLowerCase();
  if (!pagina.endsWith('.html')) pagina += '.html';

  // acao: função da página chamada quando já estamos nela (senão navega para href).
  // id/desabilitado: mantêm os ids que as páginas já usam para liberar por permissão.
  const ITENS = [
    { grupo: 'Operação' },
    { rotulo: 'Cash Game', icone: 'cash', href: 'index.html', tambem: ['cash-mesa.html'] },
    { rotulo: 'Diretor', icone: 'diretor', href: 'diretor.html' },
    { rotulo: 'Em Aberto', icone: 'aberto', href: 'em-aberto.html' },
    { rotulo: 'Tela da TV', icone: 'tv', href: 'detalhes.html' },
    { rotulo: 'Torneios', icone: 'torneios', href: 'torneios.html' },
    { grupo: 'Clube' },
    { rotulo: 'Jogadores', icone: 'jogadores', href: 'jogadores.html' },
    { rotulo: 'Ranking', icone: 'ranking', href: 'rankings.html' },
    { rotulo: 'Relatório', icone: 'relatorio', href: 'relatorio.html' },
    { rotulo: 'Estruturas de Torneio', icone: 'config', href: 'diretor.html#config', id: 'btnConfigTorneioMenu', paginaAcao: 'diretor.html', acao: 'abrirModalEstruturas' }
  ];

  const CSS = `
  :root { --mnu-larg: 248px; --mnu-larg-recolhido: 72px; }
  .mnu-barra {
    position: fixed; top: 0; left: 0; bottom: 0; z-index: 2500;
    width: var(--mnu-larg); display: flex; flex-direction: column;
    background: #0f1117; color: #c9ccd4; border-right: 1px solid #1f2330;
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;
    transition: width .2s ease, transform .2s ease; overflow: hidden;
  }
  .mnu-topo { display: flex; align-items: center; gap: 10px; padding: 16px 16px 12px; min-height: 64px; }
  .mnu-logo {
    flex: 0 0 40px; height: 40px; border-radius: 12px; display: grid; place-items: center;
    background: linear-gradient(135deg, #dc2626, #7f1d1d); color: #fff; font-weight: 800; font-size: 18px;
  }
  .mnu-nome { color: #fff; font-weight: 800; font-size: 15px; white-space: nowrap; }
  .mnu-lista { flex: 1; overflow-y: auto; overflow-x: hidden; padding: 4px 12px; display: flex; flex-direction: column; gap: 2px; }
  .mnu-grupo { font-size: 11px; font-weight: 700; text-transform: uppercase; letter-spacing: .08em; color: #5d6372; padding: 14px 12px 6px; white-space: nowrap; }
  .mnu-item {
    display: flex; align-items: center; gap: 12px; width: 100%; min-height: 44px; padding: 0 12px;
    border: 0; border-radius: 10px; background: transparent; color: inherit; font: inherit; font-size: 14px; font-weight: 600;
    text-decoration: none; text-align: left; cursor: pointer; white-space: nowrap; box-shadow: none; margin: 0;
    transition: background .15s ease, color .15s ease;
  }
  .mnu-item:hover { background: #1a1e29; color: #fff; }
  .mnu-item.ativo { background: #dc2626; color: #fff; }
  .mnu-item.disabled { opacity: .4; pointer-events: none; }
  .mnu-ico { flex: 0 0 20px; width: 20px; height: 20px; }
  .mnu-rodape { padding: 8px 12px 14px; border-top: 1px solid #1f2330; display: flex; flex-direction: column; gap: 2px; }
  .mnu-recolher {
    flex: 0 0 40px; width: 40px; height: 40px; min-height: 40px; padding: 0; margin-left: auto;
    justify-content: center; color: #8b91a0;
  }
  .mnu-recolher .mnu-ico { transition: transform .2s ease; }
  .mnu-fechar { display: none; margin-left: auto; background: transparent; border: 0; color: #c9ccd4; cursor: pointer; padding: 8px; box-shadow: none; }
  .mnu-abrir {
    display: none; position: fixed; top: 10px; left: 10px; z-index: 2400; width: 44px; height: 44px;
    border-radius: 12px; border: 1px solid #1f2330; background: #0f1117; color: #fff; cursor: pointer;
    align-items: center; justify-content: center; padding: 0; box-shadow: 0 4px 14px rgba(0,0,0,.25);
  }
  .mnu-fundo { display: none; position: fixed; inset: 0; z-index: 2450; background: rgba(15,17,23,.55); }

  /* Desktop: barra fixa empurrando o conteúdo */
  body.mnu-fixo { padding-left: calc(var(--mnu-larg) + 24px); transition: padding-left .2s ease; }
  body.mnu-fixo.mnu-recolhido { padding-left: calc(var(--mnu-larg-recolhido) + 24px); }
  body.mnu-recolhido .mnu-barra { width: var(--mnu-larg-recolhido); }
  body.mnu-recolhido .mnu-nome, body.mnu-recolhido .mnu-rot { display: none; }
  body.mnu-recolhido .mnu-grupo { visibility: hidden; height: 12px; padding: 0; }
  body.mnu-recolhido .mnu-item { justify-content: center; padding: 0; }
  body.mnu-recolhido .mnu-recolher .mnu-ico { transform: rotate(180deg); }
  /* Recolhido: no topo fica só o botão de expandir, no lugar do logo */
  body.mnu-recolhido .mnu-logo { display: none; }
  body.mnu-recolhido .mnu-topo { justify-content: center; padding-left: 0; padding-right: 0; }
  body.mnu-recolhido .mnu-recolher { margin-left: 0; }

  /* Gaveta: celular e telas de TV */
  body.mnu-gaveta .mnu-barra { transform: translateX(-100%); width: min(280px, 85vw); box-shadow: 8px 0 30px rgba(0,0,0,.35); }
  body.mnu-gaveta .mnu-abrir { display: flex; }
  body.mnu-gaveta .mnu-fechar { display: block; }
  body.mnu-gaveta .mnu-recolher { display: none; }
  body.mnu-gaveta .mnu-logo { display: grid; }
  body.mnu-gaveta .mnu-topo { justify-content: flex-start; padding: 16px 16px 12px; }
  body.mnu-gaveta.mnu-aberto .mnu-barra { transform: none; }
  body.mnu-gaveta.mnu-aberto .mnu-fundo { display: block; }
  body.mnu-gaveta .mnu-nome, body.mnu-gaveta .mnu-rot { display: inline; }
  body.mnu-gaveta .mnu-grupo { visibility: visible; height: auto; padding: 14px 12px 6px; }
  body.mnu-gaveta .mnu-item { justify-content: flex-start; padding: 0 12px; }
  body.mnu-gaveta:not(.mnu-tv) { padding-top: 64px; }
  body.mnu-tv .mnu-abrir { width: 36px; height: 36px; top: 8px; left: 8px; opacity: .6; }
  body.mnu-tv .mnu-abrir:hover { opacity: 1; }
  body.mnu-tv .tv-topo { padding-left: 56px; }
  body.mnu-tv.tela-cheia .tv-topo { padding-left: 0; }

  /* Telas cheias / modo TV: menu some */
  body.tela-cheia .mnu-abrir, body.modo-tv .mnu-barra, body.modo-tv .mnu-abrir { display: none !important; }
  body.mnu-fixo.modo-tv { padding-left: 24px; }
  `;

  function montarItem(item) {
    const naPaginaDaAcao = item.acao && pagina === item.paginaAcao;
    const ativo = !item.acao && (item.href === pagina || (item.tambem || []).includes(pagina));
    const classes = 'mnu-item' + (ativo ? ' ativo' : '') + (item.id && naPaginaDaAcao ? ' disabled' : '');
    const conteudo = icone(item.icone) + '<span class="mnu-rot">' + item.rotulo + '</span>';
    const atrib = (item.id && naPaginaDaAcao ? ' id="' + item.id + '"' : '') + ' class="' + classes + '" title="' + item.rotulo + '"' + (ativo ? ' aria-current="page"' : '');

    if (naPaginaDaAcao) {
      return '<button type="button"' + atrib + ' data-acao="' + item.acao + '">' + conteudo + '</button>';
    }
    return '<a href="' + item.href + '"' + atrib + '>' + conteudo + '</a>';
  }

  function montar() {
    if (document.getElementById('mnuBarra')) return;

    const estilo = document.createElement('style');
    estilo.textContent = CSS;
    document.head.appendChild(estilo);

    const html =
      '<button type="button" class="mnu-abrir" id="mnuAbrir" aria-label="Abrir menu">' + icone('menu') + '</button>' +
      '<div class="mnu-fundo" id="mnuFundo"></div>' +
      '<nav class="mnu-barra" id="mnuBarra" aria-label="Menu principal">' +
        '<div class="mnu-topo"><div class="mnu-logo">♠</div><span class="mnu-nome">RPG Poker Club</span>' +
        '<button type="button" class="mnu-item mnu-recolher" id="mnuRecolher" title="Recolher menu" aria-label="Recolher menu">' + icone('recolher') + '</button>' +
        '<button type="button" class="mnu-fechar" id="mnuFechar" aria-label="Fechar menu">' + icone('fechar') + '</button></div>' +
        '<div class="mnu-lista">' +
          ITENS.map(i => i.grupo ? '<div class="mnu-grupo">' + i.grupo + '</div>' : montarItem(i)).join('') +
        '</div>' +
        '<div class="mnu-rodape">' +
          '<button type="button" class="mnu-item" id="mnuSair" title="Sair">' + icone('sair') + '<span class="mnu-rot" id="btnAdmin">Sair</span></button>' +
        '</div>' +
      '</nav>';

    document.body.insertAdjacentHTML('afterbegin', html);

    const modoTV = document.body.dataset.menu === 'overlay';
    if (modoTV) document.body.classList.add('mnu-tv');

    try {
      if (localStorage.getItem(CHAVE_RECOLHIDO) === '1') {
        document.body.classList.add('mnu-recolhido');
        const botao = document.getElementById('mnuRecolher');
        botao.title = 'Expandir menu';
        botao.setAttribute('aria-label', botao.title);
      }
    } catch (e) { /* navegador sem storage: segue expandido */ }

    const celular = window.matchMedia('(max-width: 767px)');
    function aplicarModo() {
      const gaveta = modoTV || celular.matches;
      document.body.classList.toggle('mnu-gaveta', gaveta);
      document.body.classList.toggle('mnu-fixo', !gaveta);
      if (!gaveta) document.body.classList.remove('mnu-aberto');
    }
    aplicarModo();
    celular.addEventListener('change', aplicarModo);

    document.getElementById('mnuAbrir').addEventListener('click', abrirMenu);
    document.getElementById('mnuFechar').addEventListener('click', fecharMenu);
    document.getElementById('mnuFundo').addEventListener('click', fecharMenu);
    document.getElementById('mnuRecolher').addEventListener('click', function () {
      const recolhido = document.body.classList.toggle('mnu-recolhido');
      this.title = recolhido ? 'Expandir menu' : 'Recolher menu';
      this.setAttribute('aria-label', this.title);
      try { localStorage.setItem(CHAVE_RECOLHIDO, recolhido ? '1' : '0'); } catch (e) { /* ignora */ }
    });
    document.getElementById('mnuSair').addEventListener('click', function () {
      if (typeof window.sair === 'function') window.sair();
      else location.href = 'login.html';
    });
    document.querySelectorAll('#mnuBarra [data-acao]').forEach(function (botao) {
      botao.addEventListener('click', function () {
        fecharMenu();
        const fn = window[botao.dataset.acao];
        if (typeof fn === 'function') fn();
      });
    });
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape') fecharMenu();
    });
  }

  function abrirMenu() { document.body.classList.add('mnu-aberto'); }
  function fecharMenu() { document.body.classList.remove('mnu-aberto'); }

  // ---- Botão X de fechar em todos os modais (.modal-box) ----
  // O X aciona o botão "Fechar"/"Cancelar"/"Voltar"/"OK" do próprio modal, para
  // manter a limpeza que cada página faz ao fechar; sem ele, só esconde o modal.

  const CSS_MODAL = `
  .modal-box { position: relative; }
  .modal-fechar-x {
    position: absolute; top: 10px; right: 10px; z-index: 2;
    width: 36px; height: 36px; padding: 0; margin: 0; border: 0; border-radius: 10px;
    display: flex; align-items: center; justify-content: center;
    background: transparent; color: var(--apagado, #8b91a0); cursor: pointer; box-shadow: none;
    transition: background .15s ease, color .15s ease;
  }
  .modal-fechar-x:hover { background: var(--superficie-3, #f2f3f7); color: var(--texto, #16181d); }
  .modal-fechar-x:focus-visible { outline: 2px solid #dc2626; outline-offset: 2px; }
  .modal-fechar-x .mnu-ico { width: 20px; height: 20px; }
  /* Modais acima do menu lateral (z-index 2500) */
  .modal-overlay { z-index: 3000; }
  #modalCentralHistorico { z-index: 2900; } /* abaixo dos confirm/alerta abertos sobre ela */
  .modal-box > h2:first-of-type, .modal-box > .modal-fechar-x + .topbar { padding-right: 44px; }
  `;

  const TEXTOS_FECHAR = /^(fechar|cancelar|voltar|ok|não|nao)$/i;

  function fecharModalPeloX(overlay) {
    const botoes = Array.from(overlay.querySelectorAll('button:not(.modal-fechar-x)'));
    const alvo = botoes.reverse().find(b => TEXTOS_FECHAR.test(b.textContent.trim()) || b.textContent.trim() === '×');
    if (alvo) alvo.click();
    else overlay.classList.remove('aberto');
  }

  function adicionarXNosModais(raiz) {
    const caixas = raiz.matches && raiz.matches('.modal-box') ? [raiz] : Array.from((raiz.querySelectorAll ? raiz : document).querySelectorAll('.modal-box'));
    caixas.forEach(caixa => {
      if (caixa.querySelector(':scope > .modal-fechar-x')) return;
      const overlay = caixa.closest('.modal-overlay');
      if (!overlay) return;
      const botao = document.createElement('button');
      botao.type = 'button';
      botao.className = 'modal-fechar-x';
      botao.setAttribute('aria-label', 'Fechar');
      botao.title = 'Fechar';
      botao.innerHTML = icone('fechar');
      botao.addEventListener('click', e => { e.stopPropagation(); fecharModalPeloX(overlay); });
      caixa.insertBefore(botao, caixa.firstChild);
    });
  }

  // ---- Tecla ESC: fecha só o modal que está por cima, um de cada vez ----
  // Roda na fase de captura (antes dos atalhos das páginas, que fechavam todos
  // de uma vez) e usa o mesmo caminho do X para manter a limpeza de cada página.

  function modalDoTopo() {
    const abertos = Array.from(document.querySelectorAll('.modal-overlay.aberto'))
      .filter(el => getComputedStyle(el).display !== 'none');
    if (abertos.length === 0) return null;
    // Mesmo z-index: o último no DOM é o que aparece por cima.
    return abertos.reduce((topo, el) => {
      const zTopo = Number(getComputedStyle(topo).zIndex) || 0;
      const zEl = Number(getComputedStyle(el).zIndex) || 0;
      return zEl >= zTopo ? el : topo;
    });
  }

  window.addEventListener('keydown', function (e) {
    if (e.key !== 'Escape' || e.defaultPrevented) return;
    const modal = modalDoTopo();
    if (!modal) return; // sem modal aberto: segue para os atalhos da página (fechar menu, tela cheia...)
    e.preventDefault();
    e.stopPropagation();
    fecharModalPeloX(modal);
  }, true);

  // ---- Modal aberto por último fica sempre por cima ----
  // Evita o Aviso/Confirmar abrir atrás de outro modal (z-index fixo ou ordem no DOM).
  let zModalTopo = 3000;

  function trazerModalParaFrente(overlay) {
    zModalTopo += 1;
    overlay.style.zIndex = String(zModalTopo);
  }

  function iniciarPilhaDeModais() {
    document.querySelectorAll('.modal-overlay.aberto').forEach(trazerModalParaFrente);
    new MutationObserver(mutacoes => {
      mutacoes.forEach(m => {
        const el = m.target;
        if (!el.classList || !el.classList.contains('modal-overlay')) return;
        const estavaAberto = /(^|\s)aberto(\s|$)/.test(m.oldValue || '');
        if (el.classList.contains('aberto') && !estavaAberto) trazerModalParaFrente(el);
      });
    }).observe(document.body, { attributes: true, attributeFilter: ['class'], attributeOldValue: true, subtree: true });
  }

  function iniciarXNosModais() {
    const estilo = document.createElement('style');
    estilo.textContent = CSS_MODAL;
    document.head.appendChild(estilo);
    adicionarXNosModais(document);
    iniciarPilhaDeModais();
    // Modais criados depois (Central de Histórico, relatórios do torneio...)
    new MutationObserver(mutacoes => {
      mutacoes.forEach(m => m.addedNodes.forEach(n => { if (n.nodeType === 1) adicionarXNosModais(n); }));
    }).observe(document.body, { childList: true, subtree: true });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', iniciarXNosModais);
  else iniciarXNosModais();

  window.abrirMenu = abrirMenu;
  window.fecharMenu = fecharMenu;

  // Monta já (o script fica logo após <body>), antes dos scripts da página,
  // que habilitam itens do menu por id assim que confirmam o login.
  if (document.body) montar();
  else document.addEventListener('DOMContentLoaded', montar);
})();
