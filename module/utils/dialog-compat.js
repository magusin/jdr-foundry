/**
 * Wrapper de compatibilité Dialog V1 → DialogV2 pour Foundry V13+
 * Utilise DialogV2 si disponible, sinon Dialog classique.
 *
 * Usage (identique à Dialog V1) :
 *   const { rpgDialog } = await import("/systems/rpg/module/utils/dialog-compat.js");
 *   rpgDialog({ title, content, buttons, default, options }).render(true);
 */

const _DialogV2 = foundry.applications?.api?.DialogV2;

/**
 * Crée et retourne une Dialog compatible V1/V2.
 * L'objet retourné a une méthode .render(true) pour afficher.
 */
export function rpgDialog(cfg) {
  // Foundry V13+ avec DialogV2 : utilise la nouvelle API
  if (_DialogV2) {
    // Conversion du format V1 vers V2
    const buttons = Object.entries(cfg.buttons ?? {}).map(([action, btn]) => ({
      action,
      label: btn.label ?? action,
      default: action === (cfg.default ?? ""),
      callback: btn.callback
        ? (_ev, _button, _dialog) => {
            // Fournit un objet jQuery-like pour la compatibilité
            const fakeHtml = [_button.form ?? _button.closest("form") ?? _dialog.element];
            fakeHtml[0] = fakeHtml[0] ?? _dialog.element;
            return btn.callback(fakeHtml);
          }
        : undefined
    }));

    // Crée un objet avec méthode render() compatible
    return {
      render: (_force) => {
        _DialogV2.wait({
          title: cfg.title ?? "",
          content: cfg.content ?? "",
          buttons,
          ...(cfg.options ?? {})
        }).catch(() => {});
      }
    };
  }

  // Foundry V12 et antérieur : Dialog classique
  // eslint-disable-next-line no-undef
  return new Dialog(cfg, cfg.options ?? {});
}

/**
 * Version Promise : attend la réponse utilisateur.
 * Remplace : new Promise(resolve => new Dialog({ ..., callback: resolve }))
 */
export function rpgDialogPromise(cfg) {
  return new Promise(resolve => {
    const buttons = {};
    for (const [key, btn] of Object.entries(cfg.buttons ?? {})) {
      buttons[key] = {
        ...btn,
        callback: (html) => {
          const result = btn.callback ? btn.callback(html) : key;
          resolve(result);
        }
      };
    }

    // Gère la fermeture sans sélection
    const originalRender = cfg.render;
    rpgDialog({
      ...cfg,
      buttons,
      render: (html) => {
        if (originalRender) originalRender(html);
        // Si la Dialog est fermée par ×, résout avec null
        const win = html instanceof Array ? html[0]?.closest(".app") : html?.closest?.(".app");
        win?.querySelector(".close")?.addEventListener("click", () => resolve(null), { once: true });
      }
    }).render(true);
  });
}
