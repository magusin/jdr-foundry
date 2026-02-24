function toHexColor(c) {
    const s = String(c ?? "").trim();
    if (/^#[0-9a-fA-F]{6}$/.test(s)) return s;
    return "#33aaff";
  }
  
  function findExistingAuraTemplate(token) {
    // On tag les templates avec un flag
    return canvas.templates.placeables.find(t => {
      const f = t.document.getFlag("rpg", "gmAura");
      return f && f.tokenId === token.id;
    }) ?? null;
  }
  
  export const GM_AURA = {
    async toggle(token, { radius = 3, color = "#33aaff", alpha = 0.2, mode = "add" } = {}) {
      if (!game.user.isGM) return;
  
      color = toHexColor(color);
      radius = Math.max(0, Number(radius) || 0);
      alpha = Math.max(0, Math.min(1, Number(alpha) || 0.2));
  
      const existing = findExistingAuraTemplate(token);
  
      if (mode === "remove") {
        if (existing) await existing.document.delete();
        return ui.notifications.info("Aura supprimée.");
      }
  
      // distance: radius en cases -> Foundry attend souvent en unités scène
      // canvas.grid.size = px ; gridDistance = distance unité
      const gridDist = canvas.scene.grid.distance || 1;
      const distance = radius * gridDist;
  
      const docData = {
        t: "circle",
        user: game.user.id,
        x: token.center.x,
        y: token.center.y,
        distance,
        direction: 0,
        angle: 360,
        fillColor: color,
        fillAlpha: alpha,
        borderColor: color,
        borderAlpha: Math.min(1, alpha + 0.35)
      };
  
      if (existing) {
        await existing.document.update(docData);
        await existing.document.setFlag("rpg", "gmAura", { tokenId: token.id });
        ui.notifications.info("Aura mise à jour.");
        return;
      }
  
      const [created] = await canvas.scene.createEmbeddedDocuments("MeasuredTemplate", [docData]);
      const tmpl = canvas.templates.get(created.id);
      if (tmpl) await tmpl.document.setFlag("rpg", "gmAura", { tokenId: token.id });
  
      ui.notifications.info("Aura créée.");
    },
  
    async moveWithToken(tokenDocument) {
      // Quand le token bouge, on bouge l’aura
      const token = canvas.tokens.get(tokenDocument.id);
      if (!token) return;
  
      const existing = findExistingAuraTemplate(token);
      if (!existing) return;
  
      await existing.document.update({ x: token.center.x, y: token.center.y });
    }
  };
  