/* StoryFlow Engine — motore unico di pubblicazione per app desktop, app Android ed estensione Chrome.
 * Viene scaricato dal server (engine/manifest.json firmato) e iniettato nella pagina
 * https://business.facebook.com/latest/story_composer/ : per correggere un cambio
 * dell'interfaccia Meta basta pubblicare una nuova versione di questo file.
 * Le etichette dei pulsanti sono raccolte in UI_LABELS: aggiungere qui nuove lingue.
 * I messaggi per l'utente (MESSAGES) seguono la lingua del pannello (uiLang delle storie in coda).
 */
(function () {
  'use strict';

  const ENGINE_VERSION = '4.1.0';

  // Impedisce che il watchdog avvii due volte lo script sulla stessa pagina
  if (window.__SF_COMPOSER_ACTIVE__) return;

  const COMPOSER = 'https://business.facebook.com/latest/story_composer/';
  const AUTO_HASHES = ['#sfauto', '#sftest'];
  const STICKER_TRIES = 2;
  const PAUSA = 2000;

  // --- ETICHETTE INTERFACCIA META (una voce per lingua; il confronto ignora maiuscole e spazi) ---
  const UI_LABELS = {
    addMedia: { it: ['Aggiungi foto/video', 'Aggiungi foto o video'], en: ['Add photo/video', 'Add photos/videos', 'Add photo or video'] },
    addLink: { it: ['Aggiungi link'], en: ['Add link'] },
    editLink: { it: ['Modifica link'], en: ['Edit link'] },
    apply: { it: ['Applica'], en: ['Apply'] },
    edit: { it: ['Modifica'], en: ['Edit'] },
    editPhotoTitle: { it: ['Modifica foto'], en: ['Edit photo', 'Edit image'] },
    moreStickers: { it: ['Altri adesivi'], en: ['More stickers'] },
    cancel: { it: ['Annulla'], en: ['Cancel'] },
    discard: { it: ['Elimina modifiche'], en: ['Discard changes', 'Discard edits'] },
    share: { it: ['Condividi', 'Condividi ora'], en: ['Share', 'Share now'] },
    linkStickerHeading: { it: ['Aggiungi adesivo con link', 'Aggiungi adesivo link'], en: ['Add link sticker', 'Add a link sticker'] },
    linkStickerMenu: { it: ['Link', '🔗 Link'], en: ['Link', '🔗 Link'] },
    linkStickerAria: { it: ['Crea adesivo con link', 'Crea adesivo link'], en: ['Create link sticker'] },
    removeAria: { it: ['Rimuovi', 'remove'], en: ['Remove', 'remove'] }
  };
  const SHARED_WORDS = '(?:condivisa|pubblicata|shared|published|posted)';
  const STORY_WORDS = '(?:storia|story)';
  const SHARED_RE = new RegExp(`${STORY_WORDS}.{0,40}${SHARED_WORDS}|${SHARED_WORDS}.{0,40}${STORY_WORDS}`, 'i');

  // --- MESSAGGI PER L'UTENTE (avanzamento e riquadro in alto a sinistra), nella lingua del pannello ---
  // I messaggi d'errore tecnici restano in italiano: finiscono nel rapporto per l'assistenza.
  const MESSAGES = {
    it: { preview: 'elaborazione anteprima grafica in corso...', removeDefault: 'rimozione sticker Link predefinito...',
      activate: 'attivazione sticker interattivo...', configure: 'configurazione pulsante ({text})', verify: 'Verifica presenza e posizione adesivo',
      init: 'Inizializzazione pagina...', start: 'Avvio storia {i} di {n}', image: 'Caricamento immagine', link: 'Inserimento collegamento',
      sticker: 'Creazione adesivo cliccabile', testDone: 'Test completato con successo!', publish: 'Pubblicazione automatica in corso',
      retry: 'Riconnessione automatica storia {i} di {n}…', doneOk: 'Coda conclusa con successo: {ok} pubblicate, 0 errori',
      doneErr: 'Coda conclusa: {ok} pubblicate, {err} non riuscite ({reason})', checkLog: 'verifica registro', system: 'il sistema' },
    en: { preview: 'processing the design preview...', removeDefault: 'removing the default link sticker...',
      activate: 'activating the interactive sticker...', configure: 'setting up the button ({text})', verify: 'Checking that the sticker is in place',
      init: 'Setting up the page...', start: 'Starting story {i} of {n}', image: 'Uploading image', link: 'Adding the link',
      sticker: 'Creating the clickable sticker', testDone: 'Test completed successfully!', publish: 'Publishing automatically',
      retry: 'Reconnecting automatically, story {i} of {n}…', doneOk: 'Queue finished: {ok} published, 0 errors',
      doneErr: 'Queue finished: {ok} published, {err} failed ({reason})', checkLog: 'check the log', system: 'the system' },
    es: { preview: 'procesando la vista previa del diseño...', removeDefault: 'quitando el sticker de enlace predeterminado...',
      activate: 'activando el sticker interactivo...', configure: 'configurando el botón ({text})', verify: 'Comprobando que el sticker esté en su sitio',
      init: 'Preparando la página...', start: 'Empezando la historia {i} de {n}', image: 'Subiendo la imagen', link: 'Añadiendo el enlace',
      sticker: 'Creando el sticker con enlace', testDone: '¡Prueba completada con éxito!', publish: 'Publicando automáticamente',
      retry: 'Reconectando automáticamente, historia {i} de {n}…', doneOk: 'Cola terminada: {ok} publicadas, 0 errores',
      doneErr: 'Cola terminada: {ok} publicadas, {err} fallidas ({reason})', checkLog: 'revisa el registro', system: 'el sistema' },
    pt: { preview: 'processando a prévia da arte...', removeDefault: 'removendo a figurinha de link padrão...',
      activate: 'ativando a figurinha interativa...', configure: 'configurando o botão ({text})', verify: 'Conferindo se a figurinha está no lugar certo',
      init: 'Preparando a página...', start: 'Começando o story {i} de {n}', image: 'Enviando a imagem', link: 'Adicionando o link',
      sticker: 'Criando a figurinha clicável', testDone: 'Teste concluído com sucesso!', publish: 'Publicando automaticamente',
      retry: 'Reconectando automaticamente, story {i} de {n}…', doneOk: 'Fila concluída: {ok} publicados, 0 erros',
      doneErr: 'Fila concluída: {ok} publicados, {err} com falha ({reason})', checkLog: 'confira o registro', system: 'o sistema' },
    fr: { preview: 'traitement de l’aperçu du visuel...', removeDefault: 'suppression du sticker lien par défaut...',
      activate: 'activation du sticker interactif...', configure: 'configuration du bouton ({text})', verify: 'Vérification de la présence et de la position du sticker',
      init: 'Préparation de la page...', start: 'Début de la story {i} sur {n}', image: 'Envoi de l’image', link: 'Ajout du lien',
      sticker: 'Création du sticker cliquable', testDone: 'Test réussi !', publish: 'Publication automatique en cours',
      retry: 'Reconnexion automatique, story {i} sur {n}…', doneOk: 'File terminée : {ok} publiées, 0 erreur',
      doneErr: 'File terminée : {ok} publiées, {err} en échec ({reason})', checkLog: 'consultez le journal', system: 'le système' }
  };
  // Prima della coda la lingua è quella del browser; poi quella scelta nel pannello (uiLang delle storie).
  // Senza uiLang (pannello precedente, solo italiano) si resta in italiano.
  let uiLang = MESSAGES[String(navigator.language || '').slice(0, 2)] ? String(navigator.language).slice(0, 2) : 'it';
  const msg = (key, params = {}) => String((MESSAGES[uiLang] || MESSAGES.it)[key] || MESSAGES.it[key] || key)
    .replace(/\{(\w+)\}/g, (m, k) => (params[k] !== undefined ? String(params[k]) : m));

  const pageLang = () => String(document.documentElement.lang || navigator.language || 'it').slice(0, 2).toLowerCase();
  const norm = s => String(s || '').normalize('NFC').replace(/\s+/g, ' ').trim().toLowerCase();
  // Prima la lingua della pagina, poi tutte le altre: funziona anche con lingue non previste
  // se Meta mostra i testi in inglese o italiano.
  function labelsFor(key) {
    const entry = UI_LABELS[key] || {};
    const lang = pageLang();
    const ordered = [...(entry[lang] || []), ...Object.keys(entry).filter(k => k !== lang).flatMap(k => entry[k])];
    return [...new Set(ordered.map(norm))];
  }
  const firstLabel = key => (UI_LABELS[key]?.[pageLang()] || UI_LABELS[key]?.it || [key])[0];

  // --- Trasporto verso l'app ospite ---
  // native: window.StoryFlowNative (app Android e app desktop)
  // ext: chrome.runtime.sendMessage (estensione, sia content script sia user script)
  const isNative = () => Boolean(window.StoryFlowNative);
  const hasExt = () => {
    try { return typeof chrome !== 'undefined' && Boolean(chrome.runtime?.sendMessage); } catch (_) { return false; }
  };
  const hash = location.hash;
  const hashActive = AUTO_HASHES.some(h => hash.startsWith(h));
  let nativeRunning = false;
  try { nativeRunning = isNative() && Boolean(window.StoryFlowNative.isQueueRunning()); } catch (_) {}
  // Senza una coda attiva il motore non tocca la pagina: nessun hook resta installato
  // durante l'uso normale del composer e le iniezioni ripetute non lo duplicano.
  if (!hashActive && !nativeRunning) return;

  window.__SF_COMPOSER_ACTIVE__ = true;

  // --- Hook anti-beforeunload e intercettazione del selettore file (contesto pagina) ---
  try {
    const origAdd = EventTarget.prototype.addEventListener;
    EventTarget.prototype.addEventListener = function (type, fn, opt) {
      if (String(type).toLowerCase() === 'beforeunload') return;
      return origAdd.call(this, type, fn, opt);
    };
    window.addEventListener('beforeunload', (e) => { e.stopImmediatePropagation(); }, true);
    Object.defineProperty(window, 'onbeforeunload', { configurable: true, get: () => null, set: () => {} });
  } catch (_) {}

  const ARM = 'storyflow-file-picker-arm';
  const DISARM = 'storyflow-file-picker-disarm';
  const READY = 'storyflow-file-picker-ready';
  const PICK = 'storyflow-file-picker-input';
  let armed = false;

  document.addEventListener(ARM, () => { armed = true; document.dispatchEvent(new Event(READY)); }, true);
  document.addEventListener(DISARM, () => { armed = false; }, true);

  function notifyInput(input) {
    if (!input.isConnected) {
      input.style.display = 'none';
      (document.body || document.documentElement).appendChild(input);
    }
    input.dispatchEvent(new Event(PICK, { bubbles: true, composed: true }));
  }

  const nativeClick = HTMLInputElement.prototype.click;
  HTMLInputElement.prototype.click = function (...args) {
    if (!armed || this.type !== 'file') return nativeClick.apply(this, args);
    notifyInput(this);
  };

  document.addEventListener('click', (event) => {
    if (!armed || !(event.target instanceof HTMLInputElement) || event.target.type !== 'file') return;
    event.preventDefault();
    notifyInput(event.target);
  }, true);


  function extCall(cmd, payload = {}) {
    return new Promise(res => {
      try {
        chrome.runtime.sendMessage({ cmd, ...payload }, r => { void chrome.runtime.lastError; res(r); });
      } catch (_) { res(null); }
    });
  }

  // Mini HUD in alto a sinistra + mirino rosso per vedere i tocchi in tempo reale senza coprire Meta
  function setHud(text) {
    try {
      let hud = document.getElementById('sf-mini-hud');
      if (!hud && document.body) {
        hud = document.createElement('div');
        hud.id = 'sf-mini-hud';
        hud.style.cssText = 'position:fixed;top:12px;left:12px;z-index:2147483647;background:#6045e8;color:#fff;padding:8px 14px;border-radius:8px;font:700 14px system-ui,sans-serif;pointer-events:none;box-shadow:0 4px 14px rgba(0,0,0,0.35);';
        document.body.appendChild(hud);
      }
      if (hud) hud.textContent = '⚡ StoryFlow: ' + text;
    } catch (_) {}
  }

  function showTouchDot(x, y) {
    try {
      if (!document.body) return;
      let dot = document.getElementById('sf-touch-dot');
      if (!dot) {
        dot = document.createElement('div');
        dot.id = 'sf-touch-dot';
        dot.style.cssText = 'position:fixed;width:22px;height:22px;margin:-11px 0 0 -11px;border-radius:50%;background:rgba(230,25,40,0.85);border:3px solid #fff;z-index:2147483647;pointer-events:none;transition:all 0.15s ease;';
        document.body.appendChild(dot);
      }
      dot.style.left = x + 'px';
      dot.style.top = y + 'px';
    } catch (_) {}
  }

  const Bridge = {
    async getState() {
      if (isNative()) {
        try { return JSON.parse(window.StoryFlowNative.getState() || 'null'); } catch (_) { return null; }
      }
      const r = await extCall('GET_STATE');
      return r?.state || null;
    },
    async saveState(state) {
      if (isNative()) {
        window.StoryFlowNative.saveState(JSON.stringify(state));
        return;
      }
      await extCall('SAVE_STATE', { state });
    },
    emitProgress(payload) {
      setHud(payload.message || payload.stage);
      if (isNative()) {
        window.StoryFlowNative.sendProgress(JSON.stringify(payload));
        return;
      }
      void extCall('SF_PROGRESS', payload);
    },
    async trustedClick(x, y) {
      showTouchDot(x, y);
      if (isNative()) {
        window.StoryFlowNative.trustedClick(x, y, window.innerWidth, window.innerHeight);
        await new Promise(r => setTimeout(r, 450));
        return;
      }
      await extCall('TRUSTED_CLICK', { x: Math.round(x), y: Math.round(y) });
    },
    canTrustedDrag() {
      if (isNative()) return typeof window.StoryFlowNative.trustedDrag === 'function';
      return hasExt();
    },
    async trustedDrag(sx, sy, ex, ey) {
      showTouchDot(ex, ey);
      if (isNative()) {
        window.StoryFlowNative.trustedDrag(sx, sy, ex, ey, window.innerWidth, window.innerHeight);
        await new Promise(r => setTimeout(r, 700));
        return;
      }
      await extCall('TRUSTED_DRAG', { sx: Math.round(sx), sy: Math.round(sy), ex: Math.round(ex), ey: Math.round(ey) });
    },
    nextStory(dryRun) {
      window.__SF_COMPOSER_ACTIVE__ = false;
      if (isNative()) {
        window.StoryFlowNative.nextStory(Boolean(dryRun));
        return;
      }
      extCall('NEXT_STORY_NAV', { dryRun }).then(r => {
        if (!r?.ok) {
          history.replaceState(null, '', COMPOSER + (dryRun ? '#sftest' : '#sfauto-next'));
          location.reload();
        }
      });
    },
    finishQueue() {
      window.__SF_COMPOSER_ACTIVE__ = false;
      if (isNative()) {
        window.StoryFlowNative.finishQueue();
        return;
      }
      void extCall('FINISH_QUEUE');
    }
  };

  let lastStage = 'start', S = null;
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  const txt = e => (e.innerText || '').trim();

  function btn(key, root = document) {
    if (!root) return null;
    const wanted = labelsFor(key);
    return [...root.querySelectorAll('[role=button]')]
      .filter(e => wanted.includes(norm(txt(e))) && e.getAttribute('aria-disabled') !== 'true')
      .pop() || null;
  }
  const ariaSelector = key => labelsFor(key).map(l => `[aria-label="${l.replace(/"/g, '\\"')}" i]`).join(',');
  const byAria = (key, root = document) => root ? root.querySelector(ariaSelector(key)) : null;

  // Elenco dei pulsanti visibili: finisce nel report d'errore per aggiornare UI_LABELS in poche ore.
  function visibleButtons(root = document) {
    const labels = [...(root || document).querySelectorAll('[role=button],button')]
      .filter(e => e.getBoundingClientRect().width > 0)
      .map(e => txt(e) || e.getAttribute('aria-label') || '')
      .map(t => t.replace(/\s+/g, ' ').trim())
      .filter(t => t && t.length <= 40);
    return [...new Set(labels)].slice(0, 30).join(' | ');
  }
  function notFound(key, what = 'Pulsante', root = document) {
    return new Error(`${what} «${firstLabel(key)}» non trovato (lingua Meta: ${pageLang()}). Pulsanti visibili: ${visibleButtons(root) || 'nessuno'}`);
  }

  async function waitFor(fn, ms = 15000, step = 250) {
    const end = Date.now() + ms;
    while (Date.now() < end) { const v = fn(); if (v) return v; await sleep(step); }
    return null;
  }

  function setInput(i, v) {
    i.focus();
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(i, v);
    i.dispatchEvent(new Event('input', { bubbles: true }));
    i.dispatchEvent(new Event('change', { bubbles: true }));
    i.blur();
  }

  function dataUrlToBlob(dataUrl) {
    const [head, b64] = dataUrl.split(',');
    const mime = head.match(/:(.*?);/)[1];
    const bin = atob(b64);
    const u8 = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i);
    return new Blob([u8], { type: mime });
  }

  const hostLabel = url => {
    try { return new URL(url).hostname.replace(/^www\./, '').toUpperCase(); } catch (_) { return 'LEGGI'; }
  };

  function emitStage(stage, rawMessage) {
    lastStage = stage;
    const cleanMsg = String(rawMessage || '').replace(/\bMeta\b/gi, msg('system'));
    const totalStories = S ? (S.dryRun ? 1 : (S.total || (S.done + S.items.length))) : 1;
    const currentStory = S ? (S.done || 1) : 1;
    if (S) {
      Bridge.emitProgress({
        stage,
        index: currentStory,
        total: totalStories,
        dryRun: S.dryRun,
        message: cleanMsg,
        msgLang: uiLang,
        ok: S.ok || 0,
        err: S.err || 0,
        failedStage: stage === 'error' ? (S.lastError?.stage || '') : '',
        engineVersion: ENGINE_VERSION,
        log: S.log
      });
    }
  }

  function status(msg) {
    if (msg.startsWith('StoryFlow:')) emitStage(lastStage, msg.replace(/^StoryFlow:\s*/, ''));
  }

  async function uploadImage(blob, id) {
    const originalInputs = new Set(document.querySelectorAll('input[type="file"]'));
    const appearedInputs = [];
    const file = new File([blob], `story-${id}.jpg`, { type: blob.type || 'image/jpeg', lastModified: Date.now() });
    let delivered = false;

    const remember = (node) => {
      if (!(node instanceof Element)) return;
      if (node.matches('input[type="file"]') && !originalInputs.has(node)) appearedInputs.push(node);
      for (const input of node.querySelectorAll('input[type="file"]')) {
        if (!originalInputs.has(input)) appearedInputs.push(input);
      }
    };
    const observer = new MutationObserver((records) => {
      for (const record of records) for (const node of record.addedNodes) remember(node);
    });

    function deliver(input) {
      if (delivered || !(input instanceof HTMLInputElement) || input.type !== 'file') return false;
      try {
        const dt = new DataTransfer();
        dt.items.add(file);
        input.files = dt.files;
        if (!input.files || input.files.length !== 1) return false;
        delivered = true;
        input.dispatchEvent(new Event('input', { bubbles: true }));
        input.dispatchEvent(new Event('change', { bubbles: true }));
        return true;
      } catch (_) { return false; }
    }

    const onPicker = (event) => { deliver(event.target); };
    document.addEventListener(PICK, onPicker, true);
    observer.observe(document.documentElement, { childList: true, subtree: true });
    document.dispatchEvent(new Event(ARM));

    try {
      const add = await waitFor(() => btn('addMedia'), 25000);
      if (!add) throw notFound('addMedia');
      add.click();

      await waitFor(() => delivered, 6000, 100);
      if (!delivered) {
        const candidates = [...new Set([...appearedInputs, ...document.querySelectorAll('input[type="file"]')])]
          .filter(input => input instanceof HTMLInputElement && !input.disabled)
          .sort((a, b) => {
            const score = input => (originalInputs.has(input) ? 0 : 4) + (/image|jpeg|jpg|png/i.test(input.accept || '') ? 2 : 0) + (input.isConnected ? 1 : 0);
            return score(b) - score(a);
          });
        for (const input of candidates) { if (deliver(input)) break; }
      }
      if (!delivered) throw new Error(`Input file non intercettato (input nel DOM: ${document.querySelectorAll('input[type="file"]').length})`);

      status('StoryFlow: ' + msg('preview'));
      if (!await waitFor(() => btn('addLink'), 30000)) {
        throw notFound('addLink', 'Dopo il caricamento, pulsante');
      }
    } finally {
      document.dispatchEvent(new Event(DISARM));
      document.removeEventListener(PICK, onPicker, true);
      observer.disconnect();
    }
  }

  async function addSwipeLink(url) {
    btn('addLink').click();
    const inp = await waitFor(() => document.querySelector('[role=dialog] input[type=url]'), 10000);
    if (!inp) throw new Error('Finestra link non aperta');
    setInput(inp, url);
    await sleep(2000);
    const ap = await waitFor(() => btn('apply', inp.closest('[role=dialog]')), 10000);
    if (!ap) throw notFound('apply', 'Pulsante della finestra link', inp.closest('[role=dialog]'));
    ap.click();
    if (!await waitFor(() => btn('editLink'), 10000)) throw notFound('editLink', 'Link non salvato: pulsante');
  }

  function bigImageOf(d) {
    return [...d.querySelectorAll('img')]
      .map(i => ({ i, h: i.getBoundingClientRect().height }))
      .filter(o => o.h > 150)
      .sort((a, b) => b.h - a.h)
      .map(o => o.i)[0] || null;
  }

  // Editor foto: prima per titolo, poi per struttura (finestra con immagine grande e pulsante Applica)
  function editor() {
    const dialogs = [...document.querySelectorAll('[role=dialog]')];
    const titles = labelsFor('editPhotoTitle');
    const byTitle = dialogs.find(d => titles.some(t => norm(txt(d)).startsWith(t)));
    if (byTitle) return byTitle;
    return dialogs.find(d => !d.querySelector('input[type=url]') && bigImageOf(d) && btn('apply', d)) || null;
  }

  function editorImg() {
    const d = editor(); if (!d) return null;
    return bigImageOf(d);
  }

  const removeSelector = () => ariaSelector('removeAria');

  // Riconosce qualsiasi sticker sulla foto senza limiti rigidi di altezza
  const findStickers = () => {
    const ed = editor() || document;
    const withRm = [...ed.querySelectorAll('div')].filter(d => {
      if (d.style.position !== 'absolute') return false;
      const h = parseFloat(d.style.height) || d.getBoundingClientRect().height;
      return h >= 12 && h <= 85 && d.querySelector(removeSelector());
    });
    if (withRm.length) return withRm;
    return [...ed.querySelectorAll('div')].filter(d => {
      if (d.style.position !== 'absolute') return false;
      const h = parseFloat(d.style.height) || d.getBoundingClientRect().height;
      return h >= 12 && h <= 85;
    });
  };

  const goodSticker = (label) => {
    const up = (label || '').toUpperCase().trim();
    const found = findStickers().find(s => (s.innerText || '').toUpperCase().includes(up));
    if (found) return found;
    const ed = editor();
    if (!ed) return null;
    return [...ed.querySelectorAll('div')].find(d =>
      d.style.position === 'absolute' &&
      (d.innerText || '').toUpperCase().includes(up) &&
      d.getBoundingClientRect().height >= 12 &&
      d.getBoundingClientRect().height <= 85
    ) || null;
  };

  function stickerPos(label) {
    const st = goodSticker(label), img = editorImg();
    if (!st || !img) return null;
    const N = st.getBoundingClientRect(), J = img.getBoundingClientRect();
    const t = (N.top - J.top) / J.height, b = (N.bottom - J.top) / J.height, l = (N.left - J.left) / J.width, r = (N.right - J.left) / J.width;
    return { ok: t > 0.74 && b < 0.99 && l > -0.05 && r < 1.05, t: +t.toFixed(3), b: +b.toFixed(3) };
  }

  async function dragSticker(label, useHardwareDrag = false) {
    const st = goodSticker(label), img = editorImg();
    if (!st || !img) throw new Error('Adesivo o immagine non trovati');
    img.scrollIntoView({ block: 'center' });
    await sleep(300);
    const I = img.getBoundingClientRect(), S0 = st.getBoundingClientRect();
    const sx = S0.left + S0.width / 2, sy = S0.top + S0.height / 2;
    const ex = I.left + I.width / 2, ey = I.top + 0.88 * I.height;

    if (useHardwareDrag && Bridge.canTrustedDrag()) {
      await Bridge.trustedDrag(sx, sy, ex, ey);
      await sleep(PAUSA);
      return;
    }

    const o = (x, y, b) => ({ clientX: x, clientY: y, screenX: x, screenY: y, buttons: b, button: 0, pointerId: 1, pointerType: 'mouse', isPrimary: true, bubbles: true, composed: true, cancelable: true });
    const t0 = document.elementFromPoint(sx, sy) || st;
    t0.dispatchEvent(new PointerEvent('pointerdown', o(sx, sy, 1)));
    t0.dispatchEvent(new MouseEvent('mousedown', o(sx, sy, 1)));
    for (let i = 1; i <= 25; i++) {
      const x = sx + (ex - sx) * i / 25, y = sy + (ey - sy) * i / 25, e = document.elementFromPoint(x, y) || t0;
      e.dispatchEvent(new PointerEvent('pointermove', o(x, y, 1)));
      e.dispatchEvent(new MouseEvent('mousemove', o(x, y, 1)));
      await sleep(16);
    }
    const te = document.elementFromPoint(ex, ey) || t0;
    te.dispatchEvent(new PointerEvent('pointerup', o(ex, ey, 0)));
    te.dispatchEvent(new MouseEvent('mouseup', o(ex, ey, 0)));
    await sleep(PAUSA);
  }

  function photoEditBtn() {
    const ml = btn('editLink');
    if (!ml) return null;
    const mlTop = ml.getBoundingClientRect().top;
    const wanted = labelsFor('edit');
    const mod = [...document.querySelectorAll('[role=button]')]
      .filter(e => wanted.includes(norm(txt(e))))
      .sort((a, b) => Math.abs(a.getBoundingClientRect().top - mlTop) - Math.abs(b.getBoundingClientRect().top - mlTop))[0];
    return mod && Math.abs(mod.getBoundingClientRect().top - mlTop) <= 45 ? mod : null;
  }

  async function closeEditor(afterCheck = false) {
    await sleep(PAUSA);
    const apEd = await waitFor(() => btn('apply', editor()), afterCheck ? 3000 : 6000);
    if (apEd) {
      apEd.click();
    } else if (afterCheck) {
      const an = btn('cancel', editor());
      if (!an) throw notFound('cancel', 'Nell\'editor foto, pulsante', editor());
      an.click();
      await sleep(1500);
    } else {
      throw notFound('apply', 'Nell\'editor foto, pulsante', editor());
    }
    if (!await waitFor(() => !editor() && btn('share'), 20000)) throw new Error('Editor non chiuso');
    await sleep(PAUSA);
  }

  // Rimuove il [ 🔗 Link ] predefinito messo da addSwipeLink al centro della foto
  async function removeExistingStickersInEditor() {
    const ed = editor() || document;
    for (let k = 0; k < 8; k++) {
      let rm = ed.querySelector(removeSelector());
      if (!rm) {
        // Se non è ancora visibile, tocca il badge [ 🔗 Link ] sopra la foto per far apparire la X
        const st = findStickers()[0];
        if (st) {
          st.click();
          const r = st.getBoundingClientRect();
          st.dispatchEvent(new MouseEvent('mouseover', { clientX: r.left + 5, clientY: r.top + 5, bubbles: true }));
          await sleep(400);
          rm = ed.querySelector(removeSelector());
        }
      }
      if (rm) {
        rm.click();
        await sleep(800);
      } else if (byAria('linkStickerAria')) {
        break;
      } else {
        await sleep(500);
      }
    }
  }

  // Trova il pulsante Link nel pannello Adesivi a sinistra
  const findLinkButtonInMenu = () => {
    const aria = byAria('linkStickerAria');
    if (aria) return aria;

    // Fallback: cerca il pulsante "Link" situato nella colonna "Adesivi" a sinistra della foto
    const ed = editor();
    const img = editorImg();
    if (!ed || !img) return null;
    const imgLeft = img.getBoundingClientRect().left;
    const wanted = labelsFor('linkStickerMenu');
    return [...ed.querySelectorAll('[role="button"], div, span')].find(el => {
      if (!wanted.includes(norm(txt(el)))) return false;
      const r = el.getBoundingClientRect();
      return r.width >= 25 && r.width <= 160 && r.height >= 20 && r.height <= 65 && r.right < imgLeft;
    }) || null;
  };

  const stickerHeading = () => {
    const wanted = labelsFor('linkStickerHeading');
    return [...document.querySelectorAll('[role=heading]')].find(e => wanted.includes(norm(txt(e))));
  };

  async function addLinkSticker(url, stickerText) {
    const mod = await waitFor(() => photoEditBtn(), 8000);
    if (!mod) throw notFound('edit');
    mod.click();

    await waitFor(() => editorImg(), 10000);
    await sleep(800);

    const more = await waitFor(() => { const e = editor(); return e && btn('moreStickers', e); }, 10000);
    if (!more) throw notFound('moreStickers', 'Nell\'editor foto, pulsante', editor());
    more.click();
    await sleep(800);

    status('StoryFlow: ' + msg('removeDefault'));
    await removeExistingStickersInEditor();

    let h = null;
    for (let attempt = 1; attempt <= 3 && !h; attempt++) {
      let create = await waitFor(findLinkButtonInMenu, 4000);
      if (!create) {
        const reopenMore = btn('moreStickers', editor());
        if (reopenMore) { reopenMore.click(); await sleep(700); }
        await removeExistingStickersInEditor();
        create = await waitFor(findLinkButtonInMenu, 4000);
      }
      if (!create) throw notFound('linkStickerAria', 'Nel menu adesivi, pulsante', editor());

      create.scrollIntoView({ block: 'center' });
      await sleep(500);
      const rect = create.getBoundingClientRect();
      const cx = rect.left + rect.width / 2;
      const cy = rect.top + rect.height / 2;

      status('StoryFlow: ' + msg('activate'));
      await Bridge.trustedClick(cx, cy);

      h = await waitFor(stickerHeading, 6500, 250);
    }

    if (!h) throw new Error(`Popup adesivo Link non aperto dopo il clic automatico (lingua Meta: ${pageLang()})`);

    status('StoryFlow: ' + msg('configure', { text: stickerText }));
    let pop = h; while (pop && pop.querySelectorAll('input').length < 2) pop = pop.parentElement;
    if (!pop) throw new Error('Campi dell\'adesivo link non trovati');
    const [iu, it] = pop.querySelectorAll('input');
    setInput(iu, url); await sleep(700);
    setInput(it, stickerText); await sleep(900);
    if (iu.value !== url || it.value !== stickerText) {
      setInput(iu, url); await sleep(600);
      setInput(it, stickerText); await sleep(900);
    }

    const ap = await waitFor(() => btn('apply', pop), 8000);
    if (!ap) throw notFound('apply', 'Nell\'adesivo link, pulsante', pop);
    ap.click();

    if (!await waitFor(() => !stickerHeading() && goodSticker(stickerText), 12000)) throw new Error('Adesivo non creato');
    await sleep(1000);

    let pos = null;
    for (let k = 0; k < 3 && !(pos && pos.ok); k++) {
      await dragSticker(stickerText, k >= 1);
      pos = stickerPos(stickerText);
    }
    if (!pos || !pos.ok) throw new Error('Adesivo fuori posizione ' + JSON.stringify(pos));
    await sleep(PAUSA);
    await closeEditor();
    return pos;
  }

  async function verifySticker() {
    const mod = await waitFor(() => photoEditBtn(), 8000);
    if (!mod) return { ok: false, why: 'Modifica non trovato per verifica' };
    mod.click();
    if (!await waitFor(() => editorImg(), 10000)) return { ok: false, why: 'Editor non riaperto' };
    await sleep(PAUSA);
    let panel = false, found = null;
    for (let k = 0; k < 2 && !found; k++) {
      const more = await waitFor(() => { const e = editor(); return e && btn('moreStickers', e); }, 6000);
      if (more) { more.click(); panel = true; }
      found = await waitFor(() => byAria('linkStickerAria'), 4500);
    }
    await closeEditor(true);
    if (!panel) return { ok: false, why: 'Pannello Adesivi non aperto' };
    if (found) return { ok: false, why: 'Pulsante Link ancora disponibile: adesivo assente' };
    return { ok: true };
  }

  async function stickerVerified(url, stickerText) {
    let last = '', lastPos = null;
    for (let a = 1; a <= STICKER_TRIES; a++) {
      try {
        lastPos = await addLinkSticker(url, stickerText);
        emitStage('verify', msg('verify'));
        const v = await verifySticker();
        if (v.ok) return { pos: lastPos, tries: a };
        last = v.why;
      } catch (err) {
        last = String(err?.message || err);
        if (editor()) {
          const an = btn('cancel', editor()); if (an) { an.click(); await sleep(1500); }
          const sc = btn('discard'); if (sc) { sc.click(); await sleep(1500); }
        }
      }
      S.log.push(` ! tentativo sticker ${a}: ${last}`);
      await Bridge.saveState(S);
      await sleep(1500);
    }
    throw new Error(`Adesivo non confermato (${last})`);
  }

  async function share() {
    if (editor()) throw new Error('Editor ancora aperto prima di Condividi');
    await sleep(PAUSA);
    const c = btn('share');
    if (!c) throw notFound('share');
    c.click();
    const ok = await waitFor(() =>
      !location.pathname.includes('story_composer') || SHARED_RE.test(document.body.innerText), 90000, 500);
    if (ok) await sleep(3500);
    return !!ok;
  }

  async function main() {
    setHud(msg('init'));
    await waitFor(() => document.body && document.readyState !== 'loading', 60000, 200);
    await sleep(2500);
    S = await Bridge.getState();
    if (!S || !S.items || !S.items.length) {
      Bridge.finishQueue();
      return;
    }
    if (!Array.isArray(S.log)) S.log = [];

    const it = S.items[0];
    const lang = String(it.uiLang || S.uiLang || '').slice(0, 2);
    uiLang = MESSAGES[lang] ? lang : 'it';
    S.total = S.total || S.done + S.items.length;
    const currentIndex = S.done + 1;
    S.log.push(`Motore ${ENGINE_VERSION} · lingua Meta: ${pageLang()}`);
    emitStage('start', msg('start', { i: currentIndex, n: S.total }));

    try {
      if (it.metaTarget) {
        if (!await waitFor(() => document.body.innerText.includes(it.metaTarget), 25000)) {
          throw new Error(`Canale "${it.metaTarget}" non trovato. Verifica l'accesso in Account Meta.`);
        }
      }
      const blob = dataUrlToBlob(it.dataUrl);
      emitStage('image', msg('image'));
      await uploadImage(blob, it.id);
      emitStage('link', msg('link'));
      await addSwipeLink(it.url);
      emitStage('sticker', msg('sticker'));
      const v = await stickerVerified(it.url, it.stickerText || hostLabel(it.url));

      if (S.dryRun) {
        S.done++;
        S.log.push(`TEST OK (non condivisa): ${it.title} | pos ${v.pos.t}-${v.pos.b}`);
        S.items.shift();
        await Bridge.saveState(S);
        emitStage('done', msg('testDone'));
        setTimeout(() => Bridge.finishQueue(), 1500);
        return;
      }

      emitStage('publish', msg('publish'));
      const shared = await share();
      if (!shared) throw new Error('Conferma di pubblicazione non ricevuta entro il limite previsto');
      S.done++;
      S.ok++;
      S.log.push(`OK: ${it.title}`);
    } catch (e) {
      const failedStage = lastStage;
      const message = String(e?.message || e || 'Errore sconosciuto');

      it._retries = (it._retries || 0) + 1;
      if (it._retries <= 1) {
        S.log.push(` ↻ Riprovo storia ${it.id} (${failedStage}: ${message})`);
        await Bridge.saveState(S);
        emitStage('start', msg('retry', { i: currentIndex, n: S.total }));
        await sleep(2500);
        Bridge.nextStory(S.dryRun);
        return;
      }

      S.done++;
      S.err++;
      S.lastError = { stage: failedStage, message, id: String(it.id || ''), at: Date.now(), engineVersion: ENGINE_VERSION, lang: pageLang() };
      S.log.push(`ERRORE ${it.id}: ${message}`);
      await Bridge.saveState(S);
    }

    S.items.shift();
    await Bridge.saveState(S);
    if (!S.items.length) {
      const finishMessage = S.err
        ? msg('doneErr', { ok: S.ok, err: S.err, reason: S.lastError?.message || msg('checkLog') })
        : msg('doneOk', { ok: S.ok });
      emitStage(S.err ? 'error' : 'done', finishMessage);
      setTimeout(() => Bridge.finishQueue(), 1800);
      return;
    }
    await sleep(3000);
    Bridge.nextStory(S.dryRun);
  }

  main();
})();
