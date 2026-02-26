(async () => {
    const SCOPE = "rpg";
    const FLAG_ROOT = "aurasGrid";
  
    const notify = (type, msg) => ui.notifications?.[type]?.(msg) ?? console.log(`[${type}]`, msg);
  
    // ✅ force reset pour éviter de garder l’ancien manager
    if (globalThis.RPG_AURA_GRID?._inited) {
      try { globalThis.RPG_AURA_GRID._destroy?.(); } catch (e) {}
    }
    globalThis.RPG_AURA_GRID = null;
  
    const M = {
      _inited: false,
      _gfxByToken: new Map(),
      _container: null,
      _hookIds: [],
  
      _destroy() {
        for (const h of this._hookIds) {
          try { Hooks.off(h[0], h[1]); } catch (e) {}
        }
        this._hookIds = [];
        for (const byKey of this._gfxByToken.values()) {
          for (const gfx of byKey.values()) gfx.destroy({ children: true });
        }
        this._gfxByToken.clear();
        if (this._container) this._container.destroy({ children: true });
        this._container = null;
        this._inited = false;
      },
  
      hexToNumber(hex) {
        const s = String(hex ?? "#ffffff").replace("#", "").trim();
        const v = parseInt(s, 16);
        return Number.isFinite(v) ? v : 0xffffff;
      },
  
      // ✅ container click-through + derrière tokens
      ensureContainer() {
        if (!canvas?.tokens) return;
        if (!this._container) {
          this._container = new PIXI.Container();
          this._container.name = "RPG_AURA_GRID_CONTAINER";
          this._container.eventMode = "none";
          this._container.interactiveChildren = false;
          this._container.hitArea = null;
          canvas.tokens.addChildAt(this._container, 0);
        }
      },
  
      resolveToken(tokenDocOrObj) {
        if (!tokenDocOrObj) return null;
        if (tokenDocOrObj.document && tokenDocOrObj.center) return tokenDocOrObj;
        const id = tokenDocOrObj.id ?? tokenDocOrObj._id;
        return canvas.tokens?.placeables?.find(t => t?.document?.id === id || t?.id === id) ?? null;
      },
  
      tokenToGrid(placeable) {
        const center = placeable.center;
        const g = canvas.grid.grid;
        if (g?.getGridPositionFromPixels) {
          const [gx, gy] = g.getGridPositionFromPixels(center.x, center.y);
          return { gx, gy };
        }
        const size = canvas.grid.size;
        return { gx: Math.round(center.x / size), gy: Math.round(center.y / size) };
      },
  
      gridToPixels(gx, gy) {
        const g = canvas.grid.grid;
        if (g?.getPixelsFromGridPosition) {
          const [px, py] = g.getPixelsFromGridPosition(gx, gy);
          return { x: px, y: py };
        }
        const size = canvas.grid.size;
        return { x: gx * size, y: gy * size };
      },
  
      manhattanCells(gx, gy, r) {
        const cells = [];
        for (let dx = -r; dx <= r; dx++) {
          const rem = r - Math.abs(dx);
          for (let dy = -rem; dy <= rem; dy++) cells.push([gx + dx, gy + dy]);
        }
        return cells;
      },
  
      getTokenGraphics(tokenId, key) {
        let byKey = this._gfxByToken.get(tokenId);
        if (!byKey) {
          byKey = new Map();
          this._gfxByToken.set(tokenId, byKey);
        }
        let gfx = byKey.get(key);
        if (!gfx) {
          gfx = new PIXI.Graphics();
          gfx.name = `RPG_AURA_${tokenId}_${key}`;
          gfx.eventMode = "none";
          gfx.interactive = false;
          gfx.hitArea = null;
          byKey.set(key, gfx);
          this._container.addChild(gfx);
        }
        return gfx;
      },
  
      removeTokenGraphics(tokenId, key = null) {
        const byKey = this._gfxByToken.get(tokenId);
        if (!byKey) return;
  
        if (key) {
          const gfx = byKey.get(key);
          if (gfx) {
            gfx.destroy({ children: true });
            byKey.delete(key);
          }
        } else {
          for (const gfx of byKey.values()) gfx.destroy({ children: true });
          byKey.clear();
        }
  
        if (byKey.size === 0) this._gfxByToken.delete(tokenId);
      },
  
      drawToken(tokenDocOrObj) {
        const t = this.resolveToken(tokenDocOrObj);
        if (!t) return;
  
        const tokenId = t.document.id;
        const flags = t.document.getFlag(SCOPE, FLAG_ROOT) ?? {};
        const entries = Object.entries(flags);
  
        if (!entries.length) {
          this.removeTokenGraphics(tokenId);
          return;
        }
  
        this.ensureContainer();
        const { gx, gy } = this.tokenToGrid(t);
  
        const size = canvas.grid.size;
        const pad = 1;
  
        for (const [key, cfg] of entries) {
          if (!cfg?.enabled) {
            this.removeTokenGraphics(tokenId, key);
            continue;
          }
  
          const radius = Math.max(0, Math.floor(Number(cfg?.radius ?? 0)));
          const color = this.hexToNumber(cfg?.color ?? "#45d4ff");
          const alpha = Math.max(0, Math.min(1, Number(cfg?.alpha ?? 0.18)));
          const lineAlpha = Math.max(0, Math.min(1, Number(cfg?.lineAlpha ?? 0.85)));
          const lineWidth = Math.max(0, Number(cfg?.lineWidth ?? 2));
  
          const gfx = this.getTokenGraphics(tokenId, key);
          gfx.clear();
  
          const cells = this.manhattanCells(gx, gy, radius);
  
          gfx.beginFill(color, alpha);
          gfx.lineStyle({ width: lineWidth, color, alpha: lineAlpha, alignment: 0.5 });
  
          for (const [cx, cy] of cells) {
            const { x, y } = this.gridToPixels(cx, cy);
            gfx.drawRect(x + pad, y + pad, size - pad * 2, size - pad * 2);
          }
  
          gfx.endFill();
          gfx.blendMode = PIXI.BLEND_MODES.ADD;
        }
      },
  
      redrawAll() {
        for (const t of canvas.tokens?.placeables ?? []) this.drawToken(t);
      },
  
      init() {
        if (this._inited) return;
        this._inited = true;
  
        const onCanvasReady = () => {
          this._container = null;
          this.redrawAll();
        };
  
        const onUpdateToken = (doc, change) => {
          const moved = ("x" in change) || ("y" in change) || ("width" in change) || ("height" in change);
          const flagChanged = !!change?.flags?.[SCOPE]?.[FLAG_ROOT];
          if (moved || flagChanged) this.drawToken(doc);
        };
  
        const onRefreshToken = (token) => this.drawToken(token);
        const onDeleteToken = (doc) => this.removeTokenGraphics(doc.id);
  
        this._hookIds.push(["canvasReady", onCanvasReady]);
        this._hookIds.push(["updateToken", onUpdateToken]);
        this._hookIds.push(["refreshToken", onRefreshToken]);
        this._hookIds.push(["deleteToken", onDeleteToken]);
  
        Hooks.on("canvasReady", onCanvasReady);
        Hooks.on("updateToken", onUpdateToken);
        Hooks.on("refreshToken", onRefreshToken);
        Hooks.on("deleteToken", onDeleteToken);
  
        notify("info", "Aura Grid (Manhattan) OK — suit les tokens.");
        this.redrawAll();
      }
    };
  
    globalThis.RPG_AURA_GRID = M;
    M.init();
  
    // ---------------- UI (création/édition) ----------------
    const controlled = canvas.tokens?.controlled ?? [];
    const targeted = Array.from(game.user.targets ?? []);
    const tokens = [...controlled, ...targeted].filter((t, i, arr) => t && arr.findIndex(x => x.id === t.id) === i);
  
    if (!tokens.length) return notify("warn", "Contrôle un token et/ou cible des tokens (T) pour appliquer l’aura.");
  
    const unionKeys = (() => {
      const set = new Set();
      for (const t of tokens) {
        const flags = t.document.getFlag(SCOPE, FLAG_ROOT) ?? {};
        for (const k of Object.keys(flags)) set.add(k);
      }
      return Array.from(set).sort((a, b) => a.localeCompare(b, "fr"));
    })();
  
    const defaultKey = unionKeys[0] ?? "aura";
  
    const content = `
    <form class="rpg-aura-grid-form">
      <div style="display:flex;gap:10px;align-items:flex-end;">
        <div style="flex:1;">
          <label>Clé d’aura (création / update)</label>
          <input type="text" name="key" placeholder="ex: aura-feu" value="${defaultKey}" />
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
  
      <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:10px;">
        <div><label>Portée</label><input type="number" name="radius" min="0" step="1" value="3" /></div>
        <div><label>Couleur</label><input type="color" name="color" value="#45d4ff" /></div>
        <div><label>Remplissage</label><input type="number" name="alpha" min="0" max="1" step="0.05" value="0.18" /></div>
      </div>
  
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-top:10px;">
        <div><label>Contour</label><input type="number" name="lineAlpha" min="0" max="1" step="0.05" value="0.85" /></div>
        <div><label>Épaisseur</label><input type="number" name="lineWidth" min="0" step="1" value="2" /></div>
      </div>
  
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
          radius: cfg.radius,
          color: cfg.color,
          alpha: cfg.alpha,
          lineAlpha: cfg.lineAlpha,
          lineWidth: cfg.lineWidth
        };
        await t.document.setFlag(SCOPE, FLAG_ROOT, next);
        M.drawToken(t);
      }
    };
  
    // ✅ FIX IMPORTANT : suppression fiable via unsetFlag("aurasGrid.<key>")
    const removeKeyFromTokens = async (key) => {
      for (const t of tokens) {
        const before = t.document.getFlag(SCOPE, FLAG_ROOT) ?? {};
        if (!before?.[key]) continue;
  
        // supprime la clé directement
        await t.document.unsetFlag(SCOPE, `${FLAG_ROOT}.${key}`);
  
        // si plus aucune aura -> nettoie la racine
        const after = t.document.getFlag(SCOPE, FLAG_ROOT) ?? {};
        if (!after || Object.keys(after).length === 0) {
          await t.document.unsetFlag(SCOPE, FLAG_ROOT);
        }
  
        M.drawToken(t);
      }
    };
  
    const removeAllFromTokens = async () => {
      for (const t of tokens) {
        await t.document.unsetFlag(SCOPE, FLAG_ROOT);
        M.drawToken(t);
      }
    };
  
    new Dialog({
      title: `Aura en cases (Manhattan)`,
      content,
      buttons: {
        apply: {
          label: "Appliquer / Mettre à jour",
          callback: async (html) => {
            const fd = new FormData(html.find("form")[0]);
  
            const key = String(fd.get("key") ?? "aura").trim() || "aura";
            const cfg = {
              key,
              enabled: fd.get("enabled") === "on",
              radius: Math.max(0, Math.floor(Number(fd.get("radius")) || 0)),
              color: String(fd.get("color") || "#45d4ff"),
              alpha: Math.max(0, Math.min(1, Number(fd.get("alpha")) || 0)),
              lineAlpha: Math.max(0, Math.min(1, Number(fd.get("lineAlpha")) || 0)),
              lineWidth: Math.max(0, Number(fd.get("lineWidth")) || 0),
            };
  
            await applyToTokens(cfg);
            notify("info", `Aura "${cfg.key}" appliquée (portée ${cfg.radius}).`);
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
            notify("info", "Toutes les auras retirées.");
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
          html.find("input[name='radius']").val(cfg.radius ?? 0);
          html.find("input[name='color']").val(cfg.color ?? "#45d4ff");
          html.find("input[name='alpha']").val(cfg.alpha ?? 0.18);
          html.find("input[name='lineAlpha']").val(cfg.lineAlpha ?? 0.85);
          html.find("input[name='lineWidth']").val(cfg.lineWidth ?? 2);
          html.find("input[name='enabled']").prop("checked", !!cfg.enabled);
  
          html.find("select[name='removeKey']").val(k);
        });
      }
    }).render(true);
  })();