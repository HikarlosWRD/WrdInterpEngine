'use strict';

(function () {
  if (window.__WRD_PREHEAT_UI__) return;
  window.__WRD_PREHEAT_UI__ = true;

  function currentScript() {
    if (document.currentScript) return document.currentScript;
    const scripts = document.getElementsByTagName('script');
    return scripts[scripts.length - 1] || null;
  }

  function loadManager() {
    const script = currentScript();
    const relative = (script && script.getAttribute('data-engine-manager')) || 'engine/engine-manager.js';
    if (typeof require !== 'function') throw new Error('Node.js is disabled in this CEP panel.');
    const path = require('path');
    const url = require('url');
    let scriptPath = '';
    if (script && script.src) {
      try { scriptPath = url.fileURLToPath(script.src); }
      catch (_) { scriptPath = decodeURIComponent(script.src.replace(/^file:\/+/, '').replace(/\//g, path.sep)); }
    }
    return require(path.resolve(scriptPath ? path.dirname(scriptPath) : process.cwd(), relative));
  }

  function findAnchor() {
    const elements = Array.from(document.querySelectorAll('h1,h2,h3,header,div,span'));
    const title = elements.find(el => (el.textContent || '').trim().includes('Interpolation Engine'));
    if (!title) return null;
    let node = title;
    for (let i = 0; i < 4 && node.parentElement; i += 1) {
      if (node.parentElement.tagName.toLowerCase() === 'header') return node.parentElement;
      const r = node.getBoundingClientRect();
      const p = node.parentElement.getBoundingClientRect();
      if (p.width > r.width * 1.5) return node.parentElement;
      node = node.parentElement;
    }
    return title;
  }

  function createUI() {
    const existing = document.getElementById('wrd-engine-preheat');
    if (existing) return existing;
    const style = document.createElement('style');
    style.textContent = `
      #wrd-engine-preheat{box-sizing:border-box;width:100%;margin:10px 0 12px;padding:10px 12px;border:1px solid rgba(255,255,255,.08);border-radius:9px;background:rgba(13,17,24,.78);color:#d7dce5;font-family:Arial,Helvetica,sans-serif}
      #wrd-engine-preheat .wrd-row{display:flex;align-items:center;gap:9px;min-width:0}
      #wrd-engine-preheat .wrd-title{font-size:12px;font-weight:700;white-space:nowrap}
      #wrd-engine-preheat .wrd-status{min-width:0;flex:1;overflow:hidden;color:#8994a6;font-size:11px;text-overflow:ellipsis;white-space:nowrap}
      #wrd-engine-preheat .wrd-percent{min-width:34px;color:#9ca8ba;font-size:11px;text-align:right}
      #wrd-engine-preheat button{height:23px;padding:0 8px;border:1px solid rgba(255,255,255,.12);border-radius:6px;background:rgba(255,255,255,.055);color:#b5bfce;cursor:pointer;font-size:10px}
      #wrd-engine-preheat button:hover{background:rgba(255,255,255,.095)}
      #wrd-engine-preheat .wrd-track{height:6px;margin-top:8px;overflow:hidden;border-radius:999px;background:rgba(255,255,255,.07)}
      #wrd-engine-preheat .wrd-fill{width:0;height:100%;border-radius:inherit;background:linear-gradient(90deg,#4f82ff,#78a7ff);box-shadow:0 0 10px rgba(79,130,255,.38);transition:width .35s ease}
      #wrd-engine-preheat[data-state="complete"] .wrd-fill{background:linear-gradient(90deg,#30b878,#6bd9a3);box-shadow:0 0 10px rgba(48,184,120,.34)}
      #wrd-engine-preheat[data-state="error"] .wrd-fill{background:#d65e67}
      #wrd-engine-preheat[data-state="paused"] .wrd-fill,#wrd-engine-preheat[data-state="cancelled"] .wrd-fill{background:#b6914c}
    `;
    document.head.appendChild(style);
    const box = document.createElement('div');
    box.id = 'wrd-engine-preheat';
    box.dataset.state = 'idle';
    box.innerHTML = '<div class="wrd-row"><div class="wrd-title">Engine Warm-up</div><div class="wrd-status">Preparando...</div><div class="wrd-percent">0%</div><button type="button">Pausar</button></div><div class="wrd-track"><div class="wrd-fill"></div></div>';
    const anchor = findAnchor();
    if (anchor && anchor.parentNode) anchor.parentNode.insertBefore(box, anchor.nextSibling);
    else document.body.insertBefore(box, document.body.firstChild);
    return box;
  }

  function boot() {
    let engine;
    try { engine = loadManager(); }
    catch (error) { console.error('[WRD PREHEAT]', error); return; }
    const ui = createUI();
    const status = ui.querySelector('.wrd-status');
    const percent = ui.querySelector('.wrd-percent');
    const fill = ui.querySelector('.wrd-fill');
    const button = ui.querySelector('button');
    let manuallyPaused = false;

    function render(state) {
      const value = Math.max(0, Math.min(100, Number(state.percent || 0)));
      ui.dataset.state = state.status || 'idle';
      status.textContent = state.stage || 'Aguardando';
      percent.textContent = `${Math.round(value)}%`;
      fill.style.width = `${value}%`;
      const active = ['loading-model','model-ready','countdown','starting','running','cancelling'].includes(state.status);
      button.textContent = active ? 'Pausar' : 'Aquecer';
      if (state.status === 'complete') { button.textContent = 'Pronto'; button.disabled = true; }
      else button.disabled = false;
    }

    engine.onPreheatProgress(render);
    button.addEventListener('click', function () {
      const state = engine.getPreheatState();
      if (['running','starting','countdown','loading-model','model-ready'].includes(state.status)) {
        manuallyPaused = true;
        engine.cancelAutoPreheat('Pausado pelo usuário').catch(function () {});
      } else if (state.status !== 'complete') {
        manuallyPaused = false;
        engine.runPreheatNow({width:1920,height:1080,scale:1.0,precision:'fp16',pauseMs:1200}).catch(function () {});
      }
    });

    engine.startAutoPreheat({delayMs:30000,width:1920,height:1080,scale:1.0,precision:'fp16',pauseMs:1200}).catch(function () {});
    setInterval(function () {
      const state = engine.getPreheatState();
      if (!manuallyPaused && ['paused','cancelled','error'].includes(state.status)) {
        engine.startAutoPreheat({delayMs:45000,width:1920,height:1080,scale:1.0,precision:'fp16',pauseMs:1200}).catch(function () {});
      }
    }, 15000);
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot, {once:true});
  else boot();
})();
