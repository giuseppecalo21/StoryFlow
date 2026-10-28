/*
 * StoryFlow – strumenti per l'onboarding nella pagina delle storie di Meta Business Suite
 * (https://business.facebook.com/latest/story_composer/). Non pubblica nulla.
 *
 *   window.__sfMetaSetup.pick({zoom, lang})  l'utente clicca sul nome della sua Pagina/profilo e lo copiamo
 *                                      esattamente com'è: { ok, text } oppure { ok:false, reason }.
 *                                      zoom ingrandisce il riquadro (Android mostra la pagina desktop rimpicciolita);
 *                                      lang è la lingua del pannello (it, en, es, pt, fr; altrimenti quella del browser)
 *   window.__sfMetaSetup.verify(text)  stesso controllo del motore prima di pubblicare
 *                                      (document.body.innerText contiene il testo): { ok, reason, suggestion }
 *   window.__sfMetaSetup.cancel()      chiude il selettore
 *
 * Non dipende dai nomi dei menu di Meta: è l'utente a indicare il testo nella pagina vera.
 * Le app lo iniettano solo su richiesta del pannello (desktop: desktop/src/main.js, Android: MainActivity).
 */
(() => {
  'use strict';
  if (window.__sfMetaSetup) { window.__sfMetaSetup.cancel(); }

  const VERIFY_MS = 25000;            // come il motore (engine/composer.js)
  const PICK_MS = 5 * 60 * 1000;
  const MAX_LEN = 120;
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  const bodyText = () => (document.body && document.body.innerText) || '';

  let active = null;

  // Testi del riquadro, nella lingua del pannello.
  const TEXTS = {
    it: { pickTitle: 'Clicca sul nome della tua Pagina o del tuo profilo Instagram',
      pickText: 'Lo trovi nel riquadro che indica dove verrà pubblicata la storia. Tranquillo: non pubblichiamo nulla.',
      cancel: 'Annulla', which: 'Quale testo usiamo?', again: 'Scegli di nuovo', chosen: 'Hai scelto',
      chosenText: 'Lo useremo esattamente così, lettera per lettera. Potrai comunque modificarlo nel pannello.',
      use: 'Usa questo nome', noText: 'Qui non c’è testo: clicca proprio sul nome.',
      both: 'Se pubblichi su Facebook e Instagram insieme, scegli tutta la scritta: così controlliamo anche che siano selezionati entrambi.' },
    en: { pickTitle: 'Click the name of your Page or your Instagram profile',
      pickText: 'You’ll find it in the box that shows where the story will be published. Don’t worry: we won’t publish anything.',
      cancel: 'Cancel', which: 'Which text should we use?', again: 'Choose again', chosen: 'You chose',
      chosenText: 'We’ll use it exactly like this, letter for letter. You can still edit it in the panel.',
      use: 'Use this name', noText: 'There’s no text here: click right on the name.',
      both: 'If you publish to Facebook and Instagram together, choose the whole text: that way we also check that both are selected.' },
    es: { pickTitle: 'Haz clic en el nombre de tu página o de tu perfil de Instagram',
      pickText: 'Está en el recuadro que indica dónde se publicará la historia. Tranquilo: no publicamos nada.',
      cancel: 'Cancelar', which: '¿Qué texto usamos?', again: 'Elegir de nuevo', chosen: 'Has elegido',
      chosenText: 'Lo usaremos tal cual, letra por letra. De todos modos, podrás cambiarlo en el panel.',
      use: 'Usar este nombre', noText: 'Aquí no hay texto: haz clic justo sobre el nombre.',
      both: 'Si publicas en Facebook e Instagram a la vez, elige el texto completo: así comprobamos también que estén seleccionados los dos.' },
    pt: { pickTitle: 'Clique no nome da sua Página ou do seu perfil do Instagram',
      pickText: 'Ele fica no quadro que indica onde o story será publicado. Fique tranquilo: não vamos publicar nada.',
      cancel: 'Cancelar', which: 'Qual texto vamos usar?', again: 'Escolher de novo', chosen: 'Você escolheu',
      chosenText: 'Vamos usar exatamente assim, letra por letra. Você ainda pode editar no painel.',
      use: 'Usar este nome', noText: 'Aqui não tem texto: clique bem em cima do nome.',
      both: 'Se você publica no Facebook e no Instagram juntos, escolha o texto inteiro: assim também conferimos se os dois estão selecionados.' },
    fr: { pickTitle: 'Cliquez sur le nom de votre Page ou de votre profil Instagram',
      pickText: 'Il se trouve dans l’encadré qui indique où la story sera publiée. Rassurez-vous : nous ne publions rien.',
      cancel: 'Annuler', which: 'Quel texte utilisons-nous ?', again: 'Choisir à nouveau', chosen: 'Vous avez choisi',
      chosenText: 'Nous l’utiliserons tel quel, lettre par lettre. Vous pourrez toujours le modifier dans le panneau.',
      use: 'Utiliser ce nom', noText: 'Il n’y a pas de texte ici : cliquez directement sur le nom.',
      both: 'Si vous publiez sur Facebook et Instagram en même temps, choisissez le texte entier : nous vérifierons aussi que les deux sont sélectionnés.' }
  };
  const textsFor = lang => {
    for (const c of [lang, navigator.language, 'it']) {
      const code = String(c || '').slice(0, 2).toLowerCase();
      if (TEXTS[code]) return TEXTS[code];
    }
    return TEXTS.it;
  };

  function linesOf(el) {
    const raw = String((el && el.innerText) || '');
    const seen = new Set();
    return raw.split('\n').map(s => s.trim()).filter(s => {
      if (!s || s.length > MAX_LEN || seen.has(s)) return false;
      seen.add(s);
      return true;
    }).slice(0, 8);
  }

  function pick(opts = {}) {
    if (active) active.finish({ ok: false, reason: 'restart' });
    const zoom = Math.min(6, Math.max(1, Number(opts.zoom) || 1));
    const T = textsFor(opts.lang);
    return new Promise(resolve => {
      const host = document.createElement('div');
      host.setAttribute('data-storyflow', 'picker');
      host.style.cssText = 'all:initial;position:fixed;inset:0;z-index:2147483647;pointer-events:none;';
      const root = host.attachShadow({ mode: 'open' });
      root.innerHTML = `
        <style>
          .wrap{position:fixed;left:0;right:0;bottom:18px;display:flex;justify-content:center;pointer-events:none}
          .bar{pointer-events:auto;background:#fff;color:#292c40;border:2px solid #6045e8;border-radius:10px;box-shadow:0 14px 40px #1d203a55;
            font:14px/1.45 system-ui,-apple-system,"Segoe UI",sans-serif;padding:14px 16px;box-sizing:border-box}
          .k{font-size:10px;letter-spacing:.12em;font-weight:800;color:#6045e8;margin-bottom:4px}
          b{font-size:15px}
          p{margin:6px 0 0;color:#5c6075}
          .row{display:flex;flex-wrap:wrap;gap:8px;margin-top:10px}
          button{font:600 13px system-ui,sans-serif;border-radius:6px;padding:8px 12px;cursor:pointer;border:1px solid #d6d9e4;background:#fff;color:#292c40}
          button.main{background:#6045e8;border-color:#6045e8;color:#fff}
          button.choice{background:#f6f4ff;border-color:#c9bfff;text-align:left}
          .sel{font-weight:700;background:#f1eeff;border-radius:4px;padding:1px 5px}
          .box{position:fixed;pointer-events:none;border:3px solid #6045e8;border-radius:6px;background:#6045e81f;display:none;box-sizing:border-box}
        </style>
        <div class="box"></div>
        <div class="wrap"><div class="bar" role="dialog" aria-live="polite"><div class="k">STORYFLOW</div><div class="body"></div></div></div>`;
      const bar = root.querySelector('.bar');
      bar.style.zoom = String(zoom);
      bar.style.width = Math.min(620, (window.innerWidth - 24) / zoom) + 'px';
      const box = root.querySelector('.box');
      const body = root.querySelector('.body');
      let stage = 'pick';
      // Anche i clic sui nostri pulsanti restano qui e non arrivano alla pagina di Meta.
      ['click', 'pointerdown', 'pointerup', 'mousedown', 'mouseup', 'touchstart', 'touchend']
        .forEach(t => bar.addEventListener(t, e => e.stopPropagation()));

      const inHost = e => (e.composedPath ? e.composedPath() : []).includes(host);
      const button = (label, cls, onClick) => {
        const b = document.createElement('button');
        b.type = 'button'; b.textContent = label; if (cls) b.className = cls;
        b.addEventListener('click', onClick);
        return b;
      };

      function showPick(note) {
        stage = 'pick';
        body.innerHTML = '<b></b><p></p>';
        body.querySelector('b').textContent = T.pickTitle;
        body.querySelector('p').textContent = T.pickText;
        if (note) { const p = document.createElement('p'); p.textContent = note; p.style.color = '#b23a48'; body.appendChild(p); }
        const row = document.createElement('div'); row.className = 'row';
        row.append(button(T.cancel, '', () => finish({ ok: false, reason: 'cancel' })));
        body.appendChild(row);
      }
      // choices: testi da proporre; hint: spiegazione facoltativa sotto la domanda.
      function showChoices(choices, hint) {
        stage = 'choose';
        body.innerHTML = '<b></b>';
        body.querySelector('b').textContent = T.which;
        if (hint) { const p = document.createElement('p'); p.textContent = hint; body.appendChild(p); }
        const row = document.createElement('div'); row.className = 'row';
        choices.forEach(text => row.append(button(text, 'choice', () => showConfirm(text))));
        row.append(button(T.again, '', () => showPick()));
        body.appendChild(row);
      }
      function showConfirm(text) {
        stage = 'confirm';
        body.innerHTML = '<b><span class="lbl"></span> <span class="sel"></span></b><p></p>';
        body.querySelector('.lbl').textContent = T.chosen;
        body.querySelector('p').textContent = T.chosenText;
        body.querySelector('.sel').textContent = text;
        const row = document.createElement('div'); row.className = 'row';
        row.append(
          button(T.use, 'main', () => finish({ ok: true, text })),
          button(T.again, '', () => showPick())
        );
        body.appendChild(row);
      }

      function highlight(el) {
        if (!el || el === document.body || el === document.documentElement) { box.style.display = 'none'; return; }
        const r = el.getBoundingClientRect();
        Object.assign(box.style, { display: 'block', left: r.left - 3 + 'px', top: r.top - 3 + 'px', width: r.width + 6 + 'px', height: r.height + 6 + 'px' });
      }
      // Il bersaglio è l'elemento più piccolo con del testo, risalendo al massimo di 4 livelli.
      function targetOf(e) {
        let el = (e.composedPath ? e.composedPath()[0] : e.target);
        if (el && el.nodeType !== 1) el = el.parentElement;
        for (let i = 0; el && i < 4; i++, el = el.parentElement) if (linesOf(el).length) return el;
        return null;
      }
      // La riga intera che contiene il testo cliccato, es. "Nome Pagina e nome_profilo" quando si clicca
      // solo sul nome della Pagina: si risale finché il testo resta su una sola riga.
      function wholeLine(el) {
        let best = null;
        for (let up = el && el.parentElement, i = 0; up && up !== document.body && i < 4; up = up.parentElement, i++) {
          const text = String(up.innerText || '').trim();
          if (!text || text.includes('\n') || text.length > MAX_LEN) break;
          best = { el: up, text };
        }
        return best;
      }

      // Durante la scelta i clic non arrivano a Meta: niente menu aperti né pulsanti premuti per sbaglio.
      // Sugli eventi touch niente preventDefault, altrimenti il tocco non diventa un clic.
      const NO_DEFAULT = new Set(['mousedown', 'mouseup', 'dblclick', 'contextmenu']);
      const swallow = e => { if (!inHost(e)) { e.stopImmediatePropagation(); if (NO_DEFAULT.has(e.type)) e.preventDefault(); } };
      const onMove = e => { if (stage === 'pick' && !inHost(e)) highlight(targetOf(e)); };
      const onClick = e => {
        if (inHost(e)) return;
        e.preventDefault(); e.stopImmediatePropagation();
        if (stage !== 'pick') return;
        const el = targetOf(e);
        const lines = linesOf(el);
        if (!lines.length) return showPick(T.noText);
        if (lines.length > 1) { highlight(el); return showChoices(lines); }
        const line = wholeLine(el);
        if (line && line.text !== lines[0]) {
          highlight(line.el);
          return showChoices([line.text, lines[0]], T.both);
        }
        highlight(el);
        showConfirm(lines[0]);
      };
      const SWALLOW = ['pointerdown', 'pointerup', 'mousedown', 'mouseup', 'touchstart', 'touchend', 'dblclick', 'contextmenu'];

      const timer = setTimeout(() => finish({ ok: false, reason: 'timeout' }), PICK_MS);
      function finish(result) {
        if (!active) return;
        active = null;
        clearTimeout(timer);
        SWALLOW.forEach(t => window.removeEventListener(t, swallow, true));
        window.removeEventListener('mousemove', onMove, true);
        window.removeEventListener('click', onClick, true);
        host.remove();
        if (result.ok && !bodyText().includes(result.text)) result = { ok: false, reason: 'notfound', text: result.text };
        resolve(result);
      }
      active = { finish };

      SWALLOW.forEach(t => window.addEventListener(t, swallow, { capture: true, passive: false }));
      window.addEventListener('mousemove', onMove, true);
      window.addEventListener('click', onClick, true);
      document.documentElement.appendChild(host);
      showPick();
    });
  }

  async function verify(text, timeoutMs = VERIFY_MS) {
    const target = String(text || '').trim();
    if (!target) return { ok: false, reason: 'empty' };
    const end = Date.now() + timeoutMs;
    while (Date.now() < end) {
      if (bodyText().includes(target)) return { ok: true, text: target };
      await sleep(500);
    }
    // Spesso cambia solo una maiuscola: proponiamo il testo esatto che mostra Meta.
    const page = bodyText();
    const at = page.toLowerCase().indexOf(target.toLowerCase());
    const suggestion = at >= 0 ? page.substr(at, target.length) : '';
    return { ok: false, reason: 'notfound', text: target, suggestion: suggestion && suggestion !== target ? suggestion : '' };
  }

  window.__sfMetaSetup = {
    pick,
    verify,
    cancel: () => { if (active) active.finish({ ok: false, reason: 'cancel' }); }
  };
})();
