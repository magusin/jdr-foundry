// module/utils/error-handler.js
// Protection globale contre les crashes du système RPG.
// Intercepte les erreurs non-catchées et les loggue sans crasher Foundry.

/**
 * Enveloppe une fonction async dans un try/catch qui loggue l'erreur
 * sans remonter au niveau global (évite les crashes de page).
 */
export function safe(fn, context = "[RPG]") {
  return async function(...args) {
    try {
      return await fn.apply(this, args);
    } catch(e) {
      console.error(`${context} Erreur interceptée :`, e);
      // Notifier le MJ en jeu si possible
      if (game?.user?.isGM) {
        ui?.notifications?.error?.(`Erreur système : ${e?.message ?? e}`, { permanent: false });
      }
      return null;
    }
  };
}

/**
 * Enveloppe un handler de bouton click dans un try/catch + verrou anti-doublon.
 * Utilisation : root.addEventListener("click", safeClick(async (ev) => { ... }))
 */
export function safeClick(fn, label = "bouton") {
  let _running = false;
  return async function(ev) {
    if (_running) return;
    _running = true;
    try {
      await fn.call(this, ev);
    } catch(e) {
      console.error(`[RPG] Erreur ${label} :`, e);
      ui?.notifications?.warn?.(`Erreur : ${e?.message ?? e}`);
    } finally {
      setTimeout(() => { _running = false; }, 200);
    }
  };
}

/**
 * Version debounced d'un update Foundry — évite les appels simultanés.
 */
export function debouncedUpdate(document, delay = 100) {
  let _timer = null;
  let _pending = {};
  return (data) => {
    Object.assign(_pending, data);
    clearTimeout(_timer);
    _timer = setTimeout(async () => {
      const toUpdate = { ..._pending };
      _pending = {};
      try { await document.update(toUpdate); }
      catch(e) { console.error("[RPG] debouncedUpdate:", e); }
    }, delay);
  };
}

/**
 * Installe un handler global pour les erreurs non-catchées.
 * Empêche Foundry de crasher complètement sur une erreur système.
 */
export function installGlobalErrorHandler() {
  // Erreurs JS non-catchées
  window.addEventListener("unhandledrejection", (event) => {
    const err = event.reason;
    const msg = err?.message ?? String(err ?? "");

    // ⚠️ Ce bloc était un no-op : la condition ne faisait jamais que passer
    // dans son commentaire ("on laisse passer les erreurs tierces") sans
    // jamais réellement sortir/ignorer quoi que ce soit — TOUTE promesse
    // rejetée non catchée sur toute la page (cœur Foundry, autres modules,
    // erreurs navigateur…), pas seulement celles de ce système, finissait
    // quand même loguée juste en dessous avec notre préfixe [RPG]. Ce
    // listener est posé sur `window`, donc global à toute la page — pas
    // scopé à ce système — d'où l'intérêt de vraiment sortir tôt ici.
    if (!msg.includes("[RPG]") && !msg.includes("rpg")) return;

    console.error("[RPG] Promesse rejetée non-catchée :", err);
    
    // Empêcher Foundry d'afficher une erreur fatale si c'est une erreur système RPG
    if (msg.includes("system.ressources") || msg.includes("prepareDerivedData") || 
        msg.includes("character-sheet") || msg.includes("monster-sheet")) {
      event.preventDefault(); // Empêche le crash total
      ui?.notifications?.warn?.("Erreur système RPG — rechargez la fiche si nécessaire.");
    }
  });

  // Erreurs synchrones
  const _origOnError = window.onerror;
  window.onerror = (msg, src, line, col, err) => {
    if (src?.includes("systems/rpg")) {
      console.error(`[RPG] Erreur JS (${src}:${line}):`, msg);
    }
    return _origOnError?.call(window, msg, src, line, col, err) ?? false;
  };

  console.log("[RPG] Gestionnaire d'erreurs global installé.");
}
