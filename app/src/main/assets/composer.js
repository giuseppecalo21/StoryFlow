/* StoryFlow 3.3.0 — Protezione anti-doppio avvio + rimozione garantita sticker predefinito + Mini HUD live */
(function () {
  'use strict';

  // Impedisce che il watchdog avvii due volte lo script sulla stessa pagina
  if (window.__SF_COMPOSER_ACTIVE__) return;

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

  const COMPOSER = 'https://business.facebook.com/latest/story_composer/';
  const STICKER_TRIES = 2;
  const PAUSA = 2000;

  const isNative = () => Boolean(window.StoryFlowNative);
  const hash = location.hash;
  if (!hash.startsWith('#zwauto') && !hash.startsWith('#zwtest') && !(isNative() && window.StoryFlowNative.isQueueRunning())) return;

  window.__SF_COMPOSER_ACTIVE__ = true;

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
      return new Promise(res => chrome.storage.local.get(['sf_state'], r => res(r.sf_state)));
    },
    async saveState(state) {
      if (isNative()) {
        window.StoryFlowNative.saveState(JSON.stringify(state));
        return;
      }
      return new Promise(res => chrome.storage.local.set({ sf_state: state }, res));
    },
    emitProgress(payload) {
      setHud(payload.message || payload.stage);
      if (isNative()) {
        window.StoryFlowNative.sendProgress(JSON.stringify(payload));
        return;
      }
      try { chrome.runtime.sendMessage({ cmd: 'SF_PROGRESS', ...payload }, () => { void chrome.runtime.lastError; }); } catch (_) {}
    },
    async trustedClick(x, y) {
      showTouchDot(x, y);
      if (isNative()) {
        window.StoryFlowNative.trustedClick(x, y, window.innerWidth, window.innerHeight);
        await new Promise(r => setTimeout(r, 450));
        return;
      }
      await chrome.runtime.sendMessage({ cmd: 'TRUSTED_CLICK', x: Math.round(x), y: Math.round(y) });
    },
    async trustedDrag(sx, sy, ex, ey) {
      showTouchDot(ex, ey);
      if (isNative() && typeof window.StoryFlowNative.trustedDrag === 'function') {
        window.StoryFlowNative.trustedDrag(sx, sy, ex, ey, window.innerWidth, window.innerHeight);
        await new Promise(r => setTimeout(r, 700));
      }
    },
    nextStory(dryRun) {
      window.__SF_COMPOSER_ACTIVE__ = false;
      if (isNative()) {
        window.StoryFlowNative.nextStory(Boolean(dryRun));
        return;
      }
      try {
        chrome.runtime.sendMessage({ cmd: 'NEXT_STORY_NAV', dryRun }, () => {
          if (chrome.runtime.lastError) {
            history.replaceState(null, '', COMPOSER + (dryRun ? '#zwtest' : '#zwauto-next'));
            location.reload();
          }
        });
      } catch (_) { location.reload(); }
    },
    finishQueue() {
      window.__SF_COMPOSER_ACTIVE__ = false;
      if (isNative()) {
        window.StoryFlowNative.finishQueue();
        return;
      }
      try { chrome.runtime.sendMessage({ cmd: 'FINISH_QUEUE' }); } catch (_) {}
    }
  };

  let lastStage = 'start', S = null;
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  const txt = e => (e.innerText || '').trim();
  const btn = (label, root = document) => root
    ? [...root.querySelectorAll('[role=button]')].filter(e => txt(e) === label && e.getAttribute('aria-disabled') !== 'true').pop()
    : null;

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

  function emitStage(stage, rawMessage) {
    lastStage = stage;
    const cleanMsg = String(rawMessage || '').replace(/\bMeta\b/gi, 'il sistema');
    const totalStories = S ? (S.dryRun ? 1 : (S.total || (S.done + S.items.length))) : 1;
    const currentStory = S ? (S.done || 1) : 1;
    if (S) {
      Bridge.emitProgress({
        stage,
        index: currentStory,
        total: totalStories,
        dryRun: S.dryRun,
        message: cleanMsg,
        failedStage: stage === 'error' ? (S.lastError?.stage || '') : '',
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
      const add = await waitFor(() => btn('Aggiungi foto/video'), 25000);
      if (!add) throw new Error('Pulsante Aggiungi foto/video non trovato');
      add.click();

      await waitFor(() => delivered, 6000, 100);
      if (!delivered) {
        const candidates = [...new Set([...appearedInputs, ...document.querySelectorAll('input[type="file"]')])];
        for (const input of candidates) { if (deliver(input)) break; }
      }
      if (!delivered) throw new Error('Input file non intercettato');

      status('StoryFlow: elaborazione anteprima grafica in corso...');
      if (!await waitFor(() => btn('Aggiungi link'), 30000)) {
        throw new Error('Pulsante Aggiungi link non disponibile dopo upload');
      }
    } finally {
      document.dispatchEvent(new Event(DISARM));
      document.removeEventListener(PICK, onPicker, true);
      observer.disconnect();
    }
  }

  async function addSwipeLink(url) {
    btn('Aggiungi link').click();
    const inp = await waitFor(() => document.querySelector('[role=dialog] input[type=url]'), 10000);
    if (!inp) throw new Error('Finestra link non aperta');
    setInput(inp, url);
    await sleep(2000);
    const ap = await waitFor(() => btn('Applica', inp.closest('[role=dialog]')), 10000);
    if (!ap) throw new Error('Applica link disattivato');
    ap.click();
    if (!await waitFor(() => btn('Modifica link'), 10000)) throw new Error('Link non salvato');
  }

  const editor = () => [...document.querySelectorAll('[role=dialog]')].find(d => txt(d).startsWith('Modifica foto'));

  function editorImg() {
    const d = editor(); if (!d) return null;
    return [...d.querySelectorAll('img')]
      .map(i => ({ i, h: i.getBoundingClientRect().height }))
      .filter(o => o.h > 150)
      .sort((a, b) => b.h - a.h)
      .map(o => o.i)[0] || null;
  }

  // Riconosce qualsiasi sticker sulla foto senza limiti rigidi di 28px/39px
  const findStickers = () => {
    const ed = editor() || document;
    const withRm = [...ed.querySelectorAll('div')].filter(d => {
      if (d.style.position !== 'absolute') return false;
      const h = parseFloat(d.style.height) || d.getBoundingClientRect().height;
      return h >= 12 && h <= 85 && d.querySelector('button[aria-label="remove"], button[aria-label="Rimuovi"], [aria-label="remove"]');
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

    if (useHardwareDrag && isNative()) {
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
    const ml = btn('Modifica link');
    if (!ml) return null;
    const mlTop = ml.getBoundingClientRect().top;
    const mod = [...document.querySelectorAll('[role=button]')]
      .filter(e => txt(e) === 'Modifica')
      .sort((a, b) => Math.abs(a.getBoundingClientRect().top - mlTop) - Math.abs(b.getBoundingClientRect().top - mlTop))[0];
    return mod && Math.abs(mod.getBoundingClientRect().top - mlTop) <= 45 ? mod : null;
  }

  async function closeEditor(afterCheck = false) {
    await sleep(PAUSA);
    const apEd = await waitFor(() => btn('Applica', editor()), afterCheck ? 3000 : 6000);
    if (apEd) {
      apEd.click();
    } else if (afterCheck) {
      const an = btn('Annulla', editor());
      if (!an) throw new Error('Annulla di Modifica foto non trovato');
      an.click();
      await sleep(1500);
    } else {
      throw new Error('Applica di Modifica foto non trovato');
    }
    if (!await waitFor(() => !editor() && btn('Condividi'), 20000)) throw new Error('Editor non chiuso');
    await sleep(PAUSA);
  }

  // Rimuove il [ 🔗 Link ] predefinito messo da addSwipeLink al centro della foto
  async function removeExistingStickersInEditor() {
    const ed = editor() || document;
    for (let k = 0; k < 8; k++) {
      // Cerca direttamente il bottone remove dentro l'editor senza filtrare per 39px/28px!
      let rm = ed.querySelector('button[aria-label="remove"], button[aria-label="Rimuovi"], [aria-label="remove"], [aria-label="Rimuovi"]');
      if (!rm) {
        // Se non è ancora visibile, tocca il badge [ 🔗 Link ] sopra la foto per far apparire la X
        const st = findStickers()[0];
        if (st) {
          st.click();
          const r = st.getBoundingClientRect();
          st.dispatchEvent(new MouseEvent('mouseover', { clientX: r.left + 5, clientY: r.top + 5, bubbles: true }));
          await sleep(400);
          rm = ed.querySelector('button[aria-label="remove"], button[aria-label="Rimuovi"], [aria-label="remove"], [aria-label="Rimuovi"]');
        }
      }
      if (rm) {
        rm.click();
        await sleep(800);
      } else if (document.querySelector('[aria-label="Create link sticker"]')) {
        break;
      } else {
        await sleep(500);
      }
    }
  }

  // Trova il pulsante Link nel pannello Adesivi a sinistra
  const findLinkButtonInMenu = () => {
    const byAria = document.querySelector('[aria-label="Create link sticker"]') ||
                   document.querySelector('[aria-label="Crea adesivo con link"]');
    if (byAria) return byAria;

    // Fallback: cerca il pulsante "Link" situato nella colonna "Adesivi" a sinistra della foto
    const ed = editor();
    const img = editorImg();
    if (!ed || !img) return null;
    const imgLeft = img.getBoundingClientRect().left;
    return [...ed.querySelectorAll('[role="button"], div, span')].find(el => {
      const t = txt(el);
      if (t !== 'Link' && t !== '🔗 Link') return false;
      const r = el.getBoundingClientRect();
      return r.width >= 25 && r.width <= 160 && r.height >= 20 && r.height <= 65 && r.right < imgLeft;
    }) || null;
  };

  async function addLinkSticker(url, stickerText) {
    const mod = await waitFor(() => photoEditBtn(), 8000);
    if (!mod) throw new Error('Pulsante Modifica non trovato');
    mod.click();

    await waitFor(() => editorImg(), 10000);
    await sleep(800);

    const more = await waitFor(() => { const e = editor(); return e && btn('Altri adesivi', e); }, 10000);
    if (!more) throw new Error('Altri adesivi non trovato');
    more.click();
    await sleep(800);

    status('StoryFlow: rimozione sticker Link predefinito...');
    await removeExistingStickersInEditor();

    const heading = () => [...document.querySelectorAll('[role=heading]')].find(e => txt(e) === 'Aggiungi adesivo con link');

    let h = null;
    for (let attempt = 1; attempt <= 3 && !h; attempt++) {
      let create = await waitFor(findLinkButtonInMenu, 4000);
      if (!create) {
        const reopenMore = btn('Altri adesivi', editor());
        if (reopenMore) { reopenMore.click(); await sleep(700); }
        await removeExistingStickersInEditor();
        create = await waitFor(findLinkButtonInMenu, 4000);
      }
      if (!create) throw new Error('Pulsante adesivo Link non trovato nel menu');

      create.scrollIntoView({ block: 'center' });
      await sleep(500);
      const rect = create.getBoundingClientRect();
      const cx = rect.left + rect.width / 2;
      const cy = rect.top + rect.height / 2;

      status('StoryFlow: attivazione sticker interattivo...');
      await Bridge.trustedClick(cx, cy);

      h = await waitFor(heading, 6500, 250);
    }

    if (!h) throw new Error('Popup adesivo Link non aperto dopo il clic automatico');

    status(`StoryFlow: configurazione pulsante (${stickerText})`);
    let pop = h; while (pop && pop.querySelectorAll('input').length < 2) pop = pop.parentElement;
    const [iu, it] = pop.querySelectorAll('input');
    setInput(iu, url); await sleep(700);
    setInput(it, stickerText); await sleep(900);
    if (iu.value !== url || it.value !== stickerText) {
      setInput(iu, url); await sleep(600);
      setInput(it, stickerText); await sleep(900);
    }

    const ap = await waitFor(() => btn('Applica', pop), 8000);
    if (!ap) throw new Error('Applica adesivo disattivato');
    ap.click();

    if (!await waitFor(() => !heading() && goodSticker(stickerText), 12000)) throw new Error('Adesivo non creato');
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
    const linkBtn = () => document.querySelector('[aria-label="Create link sticker"]');
    let panel = false, found = null;
    for (let k = 0; k < 2 && !found; k++) {
      const more = await waitFor(() => { const e = editor(); return e && btn('Altri adesivi', e); }, 6000);
      if (more) { more.click(); panel = true; }
      found = await waitFor(linkBtn, 4500);
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
        emitStage('verify', 'Verifica presenza e posizione adesivo');
        const v = await verifySticker();
        if (v.ok) return { pos: lastPos, tries: a };
        last = v.why;
      } catch (err) {
        last = String(err?.message || err);
        if (editor()) {
          const an = btn('Annulla', editor()); if (an) { an.click(); await sleep(1500); }
          const sc = btn('Elimina modifiche'); if (sc) { sc.click(); await sleep(1500); }
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
    const c = btn('Condividi');
    if (!c) throw new Error('Pulsante Condividi non trovato');
    c.click();
    const ok = await waitFor(() =>
      !location.pathname.includes('story_composer') ||
      /storia.{0,40}(condivisa|pubblicata)|(condivisa|pubblicata).{0,40}storia/i.test(document.body.innerText), 90000, 500);
    if (ok) await sleep(3500);
    return !!ok;
  }

  async function main() {
    setHud('Inizializzazione pagina...');
    await waitFor(() => document.body && document.readyState !== 'loading', 60000, 200);
    await sleep(2500);
    S = await Bridge.getState();
    if (!S || !S.items || !S.items.length) {
      Bridge.finishQueue();
      return;
    }

    const it = S.items[0];
    S.total = S.total || S.done + S.items.length;
    const currentIndex = S.done + 1;
    emitStage('start', `Avvio storia ${currentIndex} di ${S.total}`);

    try {
      if (it.metaTarget) {
        if (!await waitFor(() => document.body.innerText.includes(it.metaTarget), 25000)) {
          throw new Error(`Canale "${it.metaTarget}" non trovato. Verifica l'accesso in Account Meta.`);
        }
      }
      const blob = dataUrlToBlob(it.dataUrl);
      emitStage('image', 'Caricamento immagine');
      await uploadImage(blob, it.id);
      emitStage('link', 'Inserimento collegamento');
      await addSwipeLink(it.url);
      emitStage('sticker', 'Creazione adesivo cliccabile');
      const v = await stickerVerified(it.url, it.stickerText || 'ZONAWRESTLING.NET');

      if (S.dryRun) {
        S.done++;
        S.log.push(`TEST OK (non condivisa): ${it.title} | pos ${v.pos.t}-${v.pos.b}`);
        S.items.shift();
        await Bridge.saveState(S);
        emitStage('done', 'Test completato con successo!');
        setTimeout(() => Bridge.finishQueue(), 1500);
        return;
      }

      emitStage('publish', 'Pubblicazione automatica in corso');
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
        emitStage('start', `Riconnessione automatica storia ${currentIndex} di ${S.total}…`);
        await sleep(2500);
        Bridge.nextStory(S.dryRun);
        return;
      }

      S.done++;
      S.err++;
      S.lastError = { stage: failedStage, message, id: String(it.id || ''), at: Date.now() };
      S.log.push(`ERRORE ${it.id}: ${message}`);
      await Bridge.saveState(S);
    }

    S.items.shift();
    await Bridge.saveState(S);
    if (!S.items.length) {
      const finishMessage = S.err
        ? `Coda conclusa: ${S.ok} pubblicate, ${S.err} non riuscite (${S.lastError?.message || 'verifica registro'})`
        : `Coda conclusa con successo: ${S.ok} pubblicate, 0 errori`;
      emitStage(S.err ? 'error' : 'done', finishMessage);
      setTimeout(() => Bridge.finishQueue(), 1800);
      return;
    }
    await sleep(3000);
    Bridge.nextStory(S.dryRun);
  }

  main();
})();