(async () => {
  const SCOPE = "rpg";
  const FLAG_ROOT = "aurasManual";

  const notify = (type, msg) => ui.notifications?.[type]?.(msg) ?? console.log(`[${type}]`, msg);

  const COLORS = game.rpg?.auraColors?.AURA_COLOR_BY_TAG ?? {};
  const colorForTag = (tag) => game.rpg?.auraColors?.auraColorHex?.(tag) ?? "#45d4ff";

  const TAG_OPTIONS = [
    ["", "— Personnalisée —"],
    ["feu", "🔥 Feu"], ["air", "🌬️ Air"], ["eau", "💧 Eau"], ["glace", "❄️ Glace"],
    ["eclair", "⚡ Éclair"], ["terre", "🌿 Terre"], ["magique", "✨ Magique"],
    ["physique", "⚔️ Physique"], ["lumiere", "✨ Lumière"], ["obscurite", "🌑 Obscurité"]
  ];

  // ---- Auras automatiques (sorts) : le rendu tourne déjà en continu ----
  // (installé au démarrage du monde, cf. init.js / rules/aura-render.js).
  // On s'assure juste qu'il est bien initialisé et à jour avant d'ouvrir
  // le dialogue d'auras manuelles.
  try {
    game.rpg?.auraRender?.init?.();
    game.rpg?.auraRender?.refresh?.();
  } catch (e) { console.warn("[RPG] aura-render:", e); }

  if (!game.user.isGM) {
    return notify("info", "Les auras de sorts s'affichent automatiquement. Seul le MJ peut poser une aura manuelle.");
  }

  // ---------------- Auras manuelles (zones ad-hoc posées par le MJ) ----------------
  const controlled = canvas.tokens?.controlled ?? [];
  const targeted = Array.from(game.user.targets ?? []);
  const tokens = [...controlled, ...targeted].filter((t, i, arr) => t && arr.findIndex(x => x.id === t.id) === i);

  if (!tokens.length) return notify("warn", "Contrôle un token et/ou cible des tokens (T) pour poser une aura manuelle.");

  const unionKeys = (() => {
    const set = new Set();
    for (const t of tokens) {
      const flags = t.document.getFlag(SCOPE, FLAG_ROOT) ?? {};
      for (const k of Object.keys(flags)) set.add(k);
    }
    return Array.from(set).sort((a, b) => a.localeCompare(b, "fr"));
  })();

  const defaultKey = unionKeys[0] ?? "aura";

  const refreshTokens = () => {
    for (const t of tokens) game.rpg?.auraRender?.refreshToken?.(t);
  };

  const content = `
  <form class="rpg-aura-manual-form">
    <div style="display:flex;gap:10px;align-items:flex-end;">
      <div style="flex:1;">
        <label>Clé d'aura (création / mise à jour)</label>
        <input type="text" name="key" placeholder="ex: zone-obscurite" value="${defaultKey}" />
      </div>
      <div style="min-width:220px;">
        <label>Charger une aura existante</label>
        <select name="prefill">
          <option value="none">—</option>
          ${unionKeys.map(k => `<option value="${k}">${k}</option>`).join("")}
        </select>
      </div>
    </div>

    <div style="display:flex;gap:10px;align-items:flex-end;margin-top:10px;">
      <div style="flex:1;">
        <label>Retirer une aura</label>
        <select name="removeKey">
          <option value="none">—</option>
          ${unionKeys.map(k => `<option value="${k}">${k}</option>`).join("")}
        </select>
        <p style="opacity:.7;margin:4px 0 0;font-size:11px;">
          Supprime la clé choisie sur <b>tous</b> les tokens sélectionnés/ciblés.
        </p>
      </div>
    </div>

    <hr style="opacity:.25;margin:12px 0;"/>

    <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;">
      <div>
        <label>Nom affiché</label>
        <input type="text" name="label" placeholder="ex: Aura de ténèbres" />
      </div>
      <div>
        <label>Type / Élément (couleur)</label>
        <select name="tag">
          ${TAG_OPTIONS.map(([v, l]) => `<option value="${v}">${l}</option>`).join("")}
        </select>
      </div>
    </div>

    <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:10px;margin-top:10px;">
      <div><label>Portée min (m)</label><input type="number" name="min" min="0" step="0.1" value="0" /></div>
      <div><label>Portée max (m)</label><input type="number" name="max" min="0" step="0.1" value="3" /></div>
      <div><label>Couleur personnalisée</label><input type="color" name="color" value="#45d4ff" /></div>
    </div>
    <small class="muted" style="display:block;margin-top:4px;">
      La couleur personnalisée n'est utilisée que si le type est laissé sur « Personnalisée ».
      Plusieurs auras actives sur un même token se superposent (couleurs mélangées, étiquettes empilées).
    </small>

    <div style="display:flex;gap:12px;align-items:center;margin-top:10px;">
      <label style="display:flex;gap:8px;align-items:center;">
        <input type="checkbox" name="enabled" checked> Aura active
      </label>
    </div>

    <p style="opacity:.7;margin-top:10px;font-size:12px;">
      Appliqué sur : <b>${tokens.length}</b> token(s)
    </p>
  </form>`;

  const applyToTokens = async (cfg) => {
    for (const t of tokens) {
      const cur = t.document.getFlag(SCOPE, FLAG_ROOT) ?? {};
      const next = foundry.utils.deepClone(cur);
      next[cfg.key] = {
        enabled: cfg.enabled,
        label: cfg.label,
        tag: cfg.tag,
        min: cfg.min,
        max: cfg.max,
        color: cfg.tag ? colorForTag(cfg.tag) : cfg.color
      };
      await t.document.setFlag(SCOPE, FLAG_ROOT, next);
    }
    refreshTokens();
  };

  const removeKeyFromTokens = async (key) => {
    for (const t of tokens) {
      const before = t.document.getFlag(SCOPE, FLAG_ROOT) ?? {};
      if (!before?.[key]) continue;

      await t.document.unsetFlag(SCOPE, `${FLAG_ROOT}.${key}`);

      const after = t.document.getFlag(SCOPE, FLAG_ROOT) ?? {};
      if (!after || Object.keys(after).length === 0) {
        await t.document.unsetFlag(SCOPE, FLAG_ROOT);
      }
    }
    refreshTokens();
  };

  const removeAllFromTokens = async () => {
    for (const t of tokens) await t.document.unsetFlag(SCOPE, FLAG_ROOT);
    refreshTokens();
  };

  new Dialog({
    title: "Aura manuelle (mètres)",
    content,
    buttons: {
      apply: {
        label: "Appliquer / Mettre à jour",
        callback: async (html) => {
          const fd = new FormData(html.find("form")[0]);

          const key = String(fd.get("key") ?? "aura").trim() || "aura";
          const tag = String(fd.get("tag") ?? "").trim();
          const cfg = {
            key,
            enabled: fd.get("enabled") === "on",
            label: String(fd.get("label") ?? "").trim() || key,
            tag,
            min: Math.max(0, Number(fd.get("min")) || 0),
            max: Math.max(0, Number(fd.get("max")) || 0),
            color: String(fd.get("color") || "#45d4ff")
          };

          if (cfg.max <= 0) return notify("warn", "La portée max doit être supérieure à 0.");
          if (cfg.min > cfg.max) return notify("warn", "La portée min ne peut pas dépasser la portée max.");

          await applyToTokens(cfg);
          notify("info", `Aura "${cfg.key}" appliquée (${cfg.min}–${cfg.max} m).`);
        }
      },
      removeKey: {
        label: "Retirer une aura",
        callback: async (html) => {
          const fd = new FormData(html.find("form")[0]);
          const key = String(fd.get("removeKey") ?? "none").trim();
          if (!key || key === "none") return notify("warn", "Choisis une aura à retirer dans la liste.");
          await removeKeyFromTokens(key);
          notify("info", `Aura "${key}" retirée.`);
        }
      },
      removeAll: {
        label: "Retirer toutes les auras",
        callback: async () => {
          await removeAllFromTokens();
          notify("info", "Toutes les auras manuelles retirées.");
        }
      },
      close: { label: "Fermer" }
    },
    default: "apply",
    render: (html) => {
      html.find("select[name='prefill']").on("change", (ev) => {
        const k = ev.currentTarget.value;
        if (!k || k === "none") return;

        let cfg = null;
        for (const t of tokens) {
          const flags = t.document.getFlag(SCOPE, FLAG_ROOT) ?? {};
          if (flags[k]) { cfg = flags[k]; break; }
        }
        if (!cfg) return;

        html.find("input[name='key']").val(k);
        html.find("input[name='label']").val(cfg.label ?? k);
        html.find("select[name='tag']").val(cfg.tag ?? "");
        html.find("input[name='min']").val(cfg.min ?? 0);
        html.find("input[name='max']").val(cfg.max ?? 3);
        html.find("input[name='color']").val(cfg.color ?? "#45d4ff");
        html.find("input[name='enabled']").prop("checked", !!cfg.enabled);

        html.find("select[name='removeKey']").val(k);
      });
    }
  }).render(true);
})();
