/**
 * Macro "JDR — Marché (MJ)"
 *
 * Le prix de base d'un objet n'est JAMAIS montré aux joueurs. Le MJ choisit
 * une région et un vendeur, le système suggère un prix ajusté selon la
 * tendance régionale du marché et la réputation du PJ (région + vendeur),
 * et le MJ peut encore l'ajuster à la main avant de valider. Seul le
 * message final, narratif, apparaît dans le chat — jamais le détail du calcul.
 */
(async () => {
  if (!game.user.isGM) {
    ui.notifications.warn("Réservé au MJ.");
    return;
  }

  const repAPI = game.rpg?.reputation;
  if (!repAPI) {
    ui.notifications.error("API reputation introuvable.");
    return;
  }

  const htmlEscape = (s) =>
    String(s ?? "").replaceAll("&","&amp;").replaceAll("<","&lt;").replaceAll(">","&gt;");

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

  if (!pjs.length) { ui.notifications.warn("Aucun personnage dans le monde."); return; }

  const worldItems = game.items
    .filter(i => SELLABLE_TYPES.includes(i.type))
    .sort((a, b) => (a.name ?? "").localeCompare(b.name ?? "", "fr"));

  const knownRegions = repAPI.listAllKnownRegions();
  const knownVendors = repAPI.listAllKnownVendors();

  const pjOptions = pjs.map(p => `<option value="${p.id}">${htmlEscape(p.name)}</option>`).join("");
  const buyItemOptions = worldItems.map(i => `<option value="${i.id}">${htmlEscape(i.name)}</option>`).join("");

  const buildSellItemOptions = (pjId) => {
    const pj = game.actors.get(pjId);
    if (!pj) return "";
    return pj.items.filter(i => SELLABLE_TYPES.includes(i.type))
      .map(i => `<option value="${i.id}">${htmlEscape(i.name)}</option>`).join("");
  };

  const content = `
    <div style="display:flex;flex-direction:column;gap:10px">
      <div style="display:flex;gap:8px">
        <button type="button" id="mk-tab-buy" style="flex:1;padding:6px;cursor:pointer">🛒 Achat</button>
        <button type="button" id="mk-tab-sell" style="flex:1;padding:6px;cursor:pointer">💰 Vente</button>
      </div>

      <div>
        <label style="font-weight:600;display:block;margin-bottom:4px">Personnage</label>
        <select id="mk-pj" style="width:100%">${pjOptions}</select>
      </div>

      <div style="display:flex;gap:8px">
        <div style="flex:1">
          <label style="font-weight:600;display:block;margin-bottom:4px">Région</label>
          <input id="mk-region" type="text" list="mk-region-list" placeholder="Nom de la région" style="width:100%" />
          <datalist id="mk-region-list">${knownRegions.map(r => `<option value="${htmlEscape(r)}">`).join("")}</datalist>
        </div>
        <div style="flex:1">
          <label style="font-weight:600;display:block;margin-bottom:4px">Vendeur</label>
          <input id="mk-vendor" type="text" list="mk-vendor-list" placeholder="Nom du vendeur" style="width:100%" />
          <datalist id="mk-vendor-list">${knownVendors.map(v => `<option value="${htmlEscape(v)}">`).join("")}</datalist>
        </div>
      </div>

      <div id="mk-buy-panel">
        <label style="font-weight:600;display:block;margin-bottom:4px">Objet à acheter (Objets du monde)</label>
        <select id="mk-buy-item" style="width:100%">${buyItemOptions}</select>
      </div>

      <div id="mk-sell-panel" style="display:none">
        <label style="font-weight:600;display:block;margin-bottom:4px">Objet à vendre (inventaire du PJ)</label>
        <select id="mk-sell-item" style="width:100%">${buildSellItemOptions(pjs[0]?.id)}</select>
        <label style="font-weight:600;display:block;margin:8px 0 4px">Taux de rachat (%)</label>
        <input id="mk-sell-rate" type="number" min="0" max="100" value="50" style="width:100%" />
      </div>

      <hr/>
      <div style="font-size:12px;background:var(--color-background-secondary);padding:8px;border-radius:6px">
        <div>Prix de base (MJ uniquement) : <b id="mk-base-price">—</b></div>
        <div>Tendance régionale : <b id="mk-trend">—</b></div>
        <div>Réputation (région + vendeur) : <b id="mk-rep">—</b></div>
        <div style="margin-top:4px;font-size:14px">Prix suggéré : <b id="mk-suggested">—</b></div>
      </div>

      <div>
        <label style="font-weight:600;display:block;margin-bottom:4px">Prix final (modifiable)</label>
        <div style="display:flex;gap:6px">
          <input id="mk-final-or" type="number" min="0" value="0" placeholder="Or" style="flex:1" />
          <input id="mk-final-argent" type="number" min="0" value="0" placeholder="Argent" style="flex:1" />
          <input id="mk-final-cuivre" type="number" min="0" value="0" placeholder="Cuivre" style="flex:1" />
        </div>
      </div>

      <div>
        <label style="font-weight:600;display:block;margin-bottom:4px">Phrase d'ambiance (visible des joueurs)</label>
        <input id="mk-flavor" type="text" style="width:100%" placeholder="ex: Le marchand vous fait un prix d'ami..." />
      </div>
    </div>`;

  let mode = "buy";

  const dlg = new Dialog({
    title: "Marché (MJ)",
    content,
    buttons: {
      confirm: {
        label: "✅ Valider la transaction",
        callback: async (html) => {
          const root = html?.[0] ?? html;
          const pj = game.actors.get(root.querySelector("#mk-pj").value);
          if (!pj) return;

          const finalPrice = toCopper({
            or: root.querySelector("#mk-final-or").value,
            argent: root.querySelector("#mk-final-argent").value,
            cuivre: root.querySelector("#mk-final-cuivre").value
          });
          const flavor = String(root.querySelector("#mk-flavor").value ?? "").trim();

          if (mode === "buy") {
            const item = worldItems.find(i => i.id === root.querySelector("#mk-buy-item").value);
            if (!item) return;

            const cur  = toCopper(pj.system?.monnaie);
            const next = Math.max(0, cur - finalPrice);
            await pj.update({ "system.monnaie": fromCopper(next) });

            const itemData = item.toObject();
            delete itemData._id;
            const [created] = await pj.createEmbeddedDocuments("Item", [itemData]);

            const insufficientTxt = cur < finalPrice
              ? `<br><span style="color:#c0392b">(Le vendeur fait crédit — fonds insuffisants couverts par le MJ)</span>` : "";

            await ChatMessage.create({
              content: `🛒 <b>${pj.name}</b> acquiert <b>${created.name}</b>` +
                (flavor ? `<br><i>${htmlEscape(flavor)}</i>` : "") +
                insufficientTxt
            });
            game.rpg?.journal?.appendToCampaignJournal(`<b>${pj.name}</b> achète <b>${created.name}</b>.`).catch(() => {});

          } else {
            const itemId = root.querySelector("#mk-sell-item").value;
            const item = pj.items.get(itemId);
            if (!item) return;

            const cur = toCopper(pj.system?.monnaie);
            const next = cur + finalPrice;
            await pj.update({ "system.monnaie": fromCopper(next) });
            await pj.deleteEmbeddedDocuments("Item", [itemId]);

            await ChatMessage.create({
              content: `💰 <b>${pj.name}</b> vend <b>${item.name}</b>` +
                (flavor ? `<br><i>${htmlEscape(flavor)}</i>` : "")
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
      const regionInput = root.querySelector("#mk-region");
      const vendorInput = root.querySelector("#mk-vendor");

      const setMode = (m) => {
        mode = m;
        tabBuy.style.background  = m === "buy"  ? "#1d9e75" : "";
        tabBuy.style.color       = m === "buy"  ? "#fff" : "";
        tabSell.style.background = m === "sell" ? "#1d9e75" : "";
        tabSell.style.color      = m === "sell" ? "#fff" : "";
        panelBuy.style.display  = m === "buy"  ? "" : "none";
        panelSell.style.display = m === "sell" ? "" : "none";
        recompute();
      };

      const currentItem = () => {
        if (mode === "buy") return worldItems.find(i => i.id === root.querySelector("#mk-buy-item").value);
        const pj = game.actors.get(pjSel.value);
        return pj?.items.get(root.querySelector("#mk-sell-item").value);
      };

      const recompute = () => {
        const pj = game.actors.get(pjSel.value);
        const item = currentItem();
        const region = regionInput.value.trim();
        const vendor = vendorInput.value.trim();

        const base = toCopper(item?.system?.prix);
        const trendPct = region ? repAPI.getRegionTrend(region) : 0;
        const repPct   = pj ? repAPI.computeReputationDiscountPct(pj, region, vendor) : 0;

        let suggested = repAPI.computeAdjustedPrice(base, { actor: pj, region, vendor });
        if (mode === "sell") {
          const rate = Math.max(0, Math.min(100, Number(root.querySelector("#mk-sell-rate")?.value) || 50));
          suggested = Math.round(suggested * rate / 100);
        }

        root.querySelector("#mk-base-price").textContent = fmtMonnaie(fromCopper(base));
        root.querySelector("#mk-trend").textContent = region ? `${trendPct > 0 ? "+" : ""}${trendPct}%` : "—";
        root.querySelector("#mk-rep").textContent = (region || vendor) ? `${repPct > 0 ? "+" : ""}${repPct.toFixed(1)}%` : "—";
        root.querySelector("#mk-suggested").textContent = fmtMonnaie(fromCopper(suggested));

        const fc = fromCopper(suggested);
        root.querySelector("#mk-final-or").value = fc.or;
        root.querySelector("#mk-final-argent").value = fc.argent;
        root.querySelector("#mk-final-cuivre").value = fc.cuivre;
      };

      tabBuy.addEventListener("click", () => setMode("buy"));
      tabSell.addEventListener("click", () => setMode("sell"));
      pjSel.addEventListener("change", () => {
        root.querySelector("#mk-sell-item").innerHTML = buildSellItemOptions(pjSel.value);
        recompute();
      });
      regionInput.addEventListener("input", recompute);
      vendorInput.addEventListener("input", recompute);
      root.querySelector("#mk-buy-item").addEventListener("change", recompute);
      root.querySelector("#mk-sell-item").addEventListener("change", recompute);
      root.querySelector("#mk-sell-rate").addEventListener("input", recompute);

      setMode("buy");
    }
  }, { width: 460, height: 640 });

  dlg.render(true);
})();
