/**
 * Macro "JDR — Marché (MJ)"
 *
 * Achat : un PJ achète un objet du monde (prix défini sur l'item).
 * Vente : un PJ vend un objet de son inventaire (à un % du prix listé).
 * Le MJ valide toujours la transaction — l'argent et l'objet ne changent
 * de main qu'après son clic.
 */
(async () => {
  if (!game.user.isGM) {
    ui.notifications.warn("Réservé au MJ.");
    return;
  }

  const htmlEscape = (s) =>
    String(s ?? "").replaceAll("&","&amp;").replaceAll("<","&lt;").replaceAll(">","&gt;");

  // ── Conversion monnaie : 100 cuivre = 1 argent, 100 argent = 1 or ──────
  const toCopper = (m) => (Number(m?.cuivre) || 0) + (Number(m?.argent) || 0) * 100 + (Number(m?.or) || 0) * 10000;
  const fromCopper = (total) => {
    total = Math.max(0, Math.round(total));
    const or = Math.floor(total / 10000);
    total -= or * 10000;
    const argent = Math.floor(total / 100);
    total -= argent * 100;
    return { or, argent, cuivre: total };
  };
  const fmtMonnaie = (m) => `🥇${m.or ?? 0} 🥈${m.argent ?? 0} 🥉${m.cuivre ?? 0}`;

  const SELLABLE_TYPES = ["weapon", "armor", "consumable", "loot"];

  const pjs = game.actors
    .filter(a => a.type === "character")
    .sort((a, b) => (a.name ?? "").localeCompare(b.name ?? "", "fr"));

  if (!pjs.length) {
    ui.notifications.warn("Aucun personnage dans le monde.");
    return;
  }

  const worldItems = game.items
    .filter(i => SELLABLE_TYPES.includes(i.type))
    .sort((a, b) => (a.name ?? "").localeCompare(b.name ?? "", "fr"));

  const pjOptions = pjs.map(p => `<option value="${p.id}">${htmlEscape(p.name)} (${fmtMonnaie(p.system?.monnaie ?? {})})</option>`).join("");
  const buyItemOptions = worldItems.map(i => {
    const cost = toCopper(i.system?.prix);
    return `<option value="${i.id}">${htmlEscape(i.name)} — ${fmtMonnaie(fromCopper(cost))}</option>`;
  }).join("");

  const buildSellItemOptions = (pjId) => {
    const pj = game.actors.get(pjId);
    if (!pj) return "";
    return pj.items
      .filter(i => SELLABLE_TYPES.includes(i.type))
      .map(i => {
        const cost = toCopper(i.system?.prix);
        return `<option value="${i.id}">${htmlEscape(i.name)} — valeur ${fmtMonnaie(fromCopper(cost))}</option>`;
      }).join("");
  };

  const content = `
    <div style="display:flex;flex-direction:column;gap:12px">
      <div style="display:flex;gap:8px">
        <button type="button" id="mk-tab-buy" class="mk-tab active" style="flex:1;padding:6px;cursor:pointer">🛒 Achat</button>
        <button type="button" id="mk-tab-sell" class="mk-tab" style="flex:1;padding:6px;cursor:pointer">💰 Vente</button>
      </div>

      <div>
        <label style="font-weight:600;display:block;margin-bottom:4px">Personnage</label>
        <select id="mk-pj" style="width:100%">${pjOptions}</select>
      </div>

      <div id="mk-buy-panel">
        <label style="font-weight:600;display:block;margin-bottom:4px">Objet à acheter (Objets du monde)</label>
        <select id="mk-buy-item" style="width:100%">${buyItemOptions}</select>
        <div style="font-size:11px;color:var(--color-text-secondary);margin-top:4px">
          L'argent est déduit du PJ ; si insuffisant, le MJ peut quand même valider.
        </div>
      </div>

      <div id="mk-sell-panel" style="display:none">
        <label style="font-weight:600;display:block;margin-bottom:4px">Objet à vendre (inventaire du PJ)</label>
        <select id="mk-sell-item" style="width:100%">${buildSellItemOptions(pjs[0]?.id)}</select>
        <label style="font-weight:600;display:block;margin:8px 0 4px">Taux de rachat (%)</label>
        <input id="mk-sell-rate" type="number" min="0" max="100" value="50" style="width:100%" />
      </div>
    </div>`;

  const dlg = new Dialog({
    title: "Marché (MJ)",
    content,
    buttons: {
      confirm: {
        label: "✅ Valider la transaction",
        callback: async (html) => {
          const root = html?.[0] ?? html;
          const mode = root.querySelector("#mk-tab-sell").classList.contains("active") ? "sell" : "buy";
          const pj = game.actors.get(root.querySelector("#mk-pj").value);
          if (!pj) return;

          if (mode === "buy") {
            const item = worldItems.find(i => i.id === root.querySelector("#mk-buy-item").value);
            if (!item) return;

            const cost = toCopper(item.system?.prix);
            const cur  = toCopper(pj.system?.monnaie);
            const next = Math.max(0, cur - cost);

            await pj.update({ "system.monnaie": fromCopper(next) });

            const itemData = item.toObject();
            delete itemData._id;
            const [created] = await pj.createEmbeddedDocuments("Item", [itemData]);

            const insufficientTxt = cur < cost ? ` <span style="color:#c0392b">(crédit accordé par le MJ — fonds insuffisants)</span>` : "";

            await ChatMessage.create({
              content: `🛒 <b>${pj.name}</b> achète <b>${created.name}</b> pour ${fmtMonnaie(fromCopper(cost))}.${insufficientTxt}<br>Solde : ${fmtMonnaie(fromCopper(cur))} → <b>${fmtMonnaie(fromCopper(next))}</b>`
            });
            game.rpg?.journal?.appendToCampaignJournal(`<b>${pj.name}</b> achète <b>${created.name}</b>.`).catch(() => {});

          } else {
            const itemId = root.querySelector("#mk-sell-item").value;
            const item = pj.items.get(itemId);
            if (!item) return;

            const rate = Math.max(0, Math.min(100, Number(root.querySelector("#mk-sell-rate").value) || 0));
            const baseValue = toCopper(item.system?.prix);
            const saleValue = Math.round(baseValue * rate / 100);

            const cur = toCopper(pj.system?.monnaie);
            const next = cur + saleValue;

            await pj.update({ "system.monnaie": fromCopper(next) });
            await pj.deleteEmbeddedDocuments("Item", [itemId]);

            await ChatMessage.create({
              content: `💰 <b>${pj.name}</b> vend <b>${item.name}</b> pour ${fmtMonnaie(fromCopper(saleValue))} (${rate}% de la valeur).<br>Solde : ${fmtMonnaie(fromCopper(cur))} → <b>${fmtMonnaie(fromCopper(next))}</b>`
            });
            game.rpg?.journal?.appendToCampaignJournal(`<b>${pj.name}</b> vend <b>${item.name}</b>.`).catch(() => {});
          }

          ui.notifications.info("Transaction validée.");
        }
      },
      cancel: { label: "Annuler" }
    },
    default: "confirm",
    render: (html) => {
      const root = html?.[0] ?? html;
      const tabBuy  = root.querySelector("#mk-tab-buy");
      const tabSell = root.querySelector("#mk-tab-sell");
      const panelBuy  = root.querySelector("#mk-buy-panel");
      const panelSell = root.querySelector("#mk-sell-panel");
      const pjSel = root.querySelector("#mk-pj");

      tabBuy.addEventListener("click", () => {
        tabBuy.classList.add("active"); tabSell.classList.remove("active");
        tabBuy.style.background = "#1d9e75"; tabBuy.style.color = "#fff";
        tabSell.style.background = ""; tabSell.style.color = "";
        panelBuy.style.display = ""; panelSell.style.display = "none";
      });
      tabSell.addEventListener("click", () => {
        tabSell.classList.add("active"); tabBuy.classList.remove("active");
        tabSell.style.background = "#1d9e75"; tabSell.style.color = "#fff";
        tabBuy.style.background = ""; tabBuy.style.color = "";
        panelSell.style.display = ""; panelBuy.style.display = "none";
      });
      tabBuy.click();
      pjSel.addEventListener("change", () => {
        root.querySelector("#mk-sell-item").innerHTML = buildSellItemOptions(pjSel.value);
      });
    }
  }, { width: 460, height: 480 });

  dlg.render(true);
})();
