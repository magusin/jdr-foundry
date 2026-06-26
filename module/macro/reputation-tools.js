/**
 * Macro "JDR — Réputation & Marché Régional (MJ)"
 *
 * Permet au MJ d'ajuster la réputation d'un PJ avec une région OU avec
 * n'importe quelle entité sociale (un PNJ précis, une faction, une
 * guilde, un vendeur...) — le champ est libre, pas limité aux marchands.
 * Sert aussi à fixer la tendance générale du marché d'une région
 * (pénurie/abondance). Ces valeurs ne sont jamais montrées aux joueurs —
 * elles servent uniquement au MJ pour calculer le prix ou la réaction
 * qu'il annonce en jeu.
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

  const pjs = game.actors
    .filter(a => a.type === "character")
    .sort((a, b) => (a.name ?? "").localeCompare(b.name ?? "", "fr"));

  if (!pjs.length) {
    ui.notifications.warn("Aucun personnage dans le monde.");
    return;
  }

  const pjOptions = pjs.map(p => `<option value="${p.id}">${htmlEscape(p.name)}</option>`).join("");
  const knownRegions = repAPI.listAllKnownRegions();
  const knownVendors = repAPI.listAllKnownVendors();

  const content = `
    <div style="display:flex;flex-direction:column;gap:14px">
      <div>
        <label style="font-weight:600;display:block;margin-bottom:4px">Personnage</label>
        <select id="rep-pj" style="width:100%">${pjOptions}</select>
      </div>

      <hr/>

      <div>
        <label style="font-weight:600;display:block;margin-bottom:4px">Réputation — Région</label>
        <div style="display:flex;gap:8px;margin-bottom:4px">
          <input id="rep-region" type="text" list="rep-region-list" placeholder="Nom de la région" style="flex:1" />
          <datalist id="rep-region-list">${knownRegions.map(r => `<option value="${htmlEscape(r)}">`).join("")}</datalist>
          <span id="rep-region-val" style="min-width:60px;text-align:center;font-weight:600">—</span>
        </div>
        <div style="display:flex;gap:6px">
          <button type="button" class="rep-adj" data-target="region" data-delta="-10" style="flex:1">-10</button>
          <button type="button" class="rep-adj" data-target="region" data-delta="-1"  style="flex:1">-1</button>
          <button type="button" class="rep-adj" data-target="region" data-delta="1"   style="flex:1">+1</button>
          <button type="button" class="rep-adj" data-target="region" data-delta="10"  style="flex:1">+10</button>
        </div>
      </div>

      <hr/>

      <div>
        <label style="font-weight:600;display:block;margin-bottom:4px">Réputation — Entité (PNJ / Faction / Vendeur)</label>
        <div style="display:flex;gap:8px;margin-bottom:4px">
          <input id="rep-vendor" type="text" list="rep-vendor-list" placeholder="Nom du PNJ, de la faction ou du vendeur" style="flex:1" />
          <datalist id="rep-vendor-list">${knownVendors.map(v => `<option value="${htmlEscape(v)}">`).join("")}</datalist>
          <span id="rep-vendor-val" style="min-width:60px;text-align:center;font-weight:600">—</span>
        </div>
        <div style="display:flex;gap:6px">
          <button type="button" class="rep-adj" data-target="vendor" data-delta="-10" style="flex:1">-10</button>
          <button type="button" class="rep-adj" data-target="vendor" data-delta="-1"  style="flex:1">-1</button>
          <button type="button" class="rep-adj" data-target="vendor" data-delta="1"   style="flex:1">+1</button>
          <button type="button" class="rep-adj" data-target="vendor" data-delta="10"  style="flex:1">+10</button>
        </div>
      </div>

      <hr/>

      <div>
        <label style="font-weight:600;display:block;margin-bottom:4px">📊 Compteur — toutes les réputations de ce PJ</label>
        <div id="rep-summary" style="max-height:180px;overflow-y:auto;font-size:12px;border:1px solid var(--color-border-tertiary);border-radius:6px;padding:6px"></div>
      </div>

      <hr/>

      <div>
        <label style="font-weight:600;display:block;margin-bottom:4px">Tendance du marché (région, indépendant du PJ)</label>
        <div style="display:flex;gap:8px;margin-bottom:4px">
          <input id="rep-trend-region" type="text" list="rep-region-list" placeholder="Nom de la région" style="flex:1" />
          <span id="rep-trend-val" style="min-width:80px;text-align:center;font-weight:600">—</span>
        </div>
        <div style="display:flex;gap:6px">
          <button type="button" class="trend-adj" data-delta="-10">-10%</button>
          <button type="button" class="trend-adj" data-delta="-5">-5%</button>
          <button type="button" class="trend-adj" data-delta="5">+5%</button>
          <button type="button" class="trend-adj" data-delta="10">+10%</button>
        </div>
        <div style="font-size:11px;color:var(--color-text-secondary);margin-top:4px">
          Positif = pénurie (prix plus élevés) · Négatif = abondance (prix plus bas)
        </div>
      </div>
    </div>`;

  new Dialog({
    title: "Réputation & Marché Régional (MJ)",
    content,
    buttons: { close: { label: "Fermer" } },
    render: (html) => {
      const root = html?.[0] ?? html;
      const pjSel = root.querySelector("#rep-pj");
      const regionInput = root.querySelector("#rep-region");
      const vendorInput = root.querySelector("#rep-vendor");
      const trendRegionInput = root.querySelector("#rep-trend-region");

      const refreshSummary = () => {
        const pj = game.actors.get(pjSel.value);
        const summaryEl = root.querySelector("#rep-summary");
        if (!pj) { summaryEl.innerHTML = "—"; return; }

        const regions = repAPI.listKnownRegionsFor(pj).map(r => ({ type: "Région", name: r, value: repAPI.getRegionRep(pj, r) }));
        const vendors = repAPI.listKnownVendorsFor(pj).map(v => ({ type: "Entité", name: v, value: repAPI.getVendorRep(pj, v) }));
        const all = [...regions, ...vendors].sort((a, b) => b.value - a.value);

        if (!all.length) { summaryEl.innerHTML = `<i style="opacity:.7">Aucune réputation enregistrée pour ce PJ.</i>`; return; }

        summaryEl.innerHTML = all.map(r => {
          const color = r.value > 0 ? "#1d9e75" : r.value < 0 ? "#c0392b" : "var(--color-text-secondary)";
          return `<div style="display:flex;justify-content:space-between;padding:2px 0">
            <span>${htmlEscape(r.type)} — <b>${htmlEscape(r.name)}</b></span>
            <b style="color:${color}">${r.value > 0 ? "+" : ""}${r.value}</b>
          </div>`;
        }).join("");
      };

      const refreshRegion = () => {
        const pj = game.actors.get(pjSel.value);
        const val = pj ? repAPI.getRegionRep(pj, regionInput.value.trim()) : 0;
        root.querySelector("#rep-region-val").textContent = regionInput.value.trim() ? val : "—";
      };
      const refreshVendor = () => {
        const pj = game.actors.get(pjSel.value);
        const val = pj ? repAPI.getVendorRep(pj, vendorInput.value.trim()) : 0;
        root.querySelector("#rep-vendor-val").textContent = vendorInput.value.trim() ? val : "—";
      };
      const refreshTrend = () => {
        const region = trendRegionInput.value.trim();
        const val = region ? repAPI.getRegionTrend(region) : 0;
        root.querySelector("#rep-trend-val").textContent = region ? `${val > 0 ? "+" : ""}${val}%` : "—";
      };

      pjSel.addEventListener("change", () => { refreshRegion(); refreshVendor(); refreshSummary(); });
      regionInput.addEventListener("input", refreshRegion);
      vendorInput.addEventListener("input", refreshVendor);
      trendRegionInput.addEventListener("input", refreshTrend);

      refreshSummary();

      root.querySelectorAll(".rep-adj").forEach(btn => {
        btn.addEventListener("click", async () => {
          const pj = game.actors.get(pjSel.value);
          if (!pj) return;
          const target = btn.dataset.target;
          const delta = Number(btn.dataset.delta) || 0;

          if (target === "region") {
            const region = regionInput.value.trim();
            if (!region) { ui.notifications.warn("Indique une région."); return; }
            await repAPI.adjustRegionRep(pj, region, delta);
            refreshRegion();
            refreshSummary();
          } else {
            const vendor = vendorInput.value.trim();
            if (!vendor) { ui.notifications.warn("Indique un vendeur."); return; }
            await repAPI.adjustVendorRep(pj, vendor, delta);
            refreshVendor();
            refreshSummary();
          }
        });
      });

      root.querySelectorAll(".trend-adj").forEach(btn => {
        btn.addEventListener("click", async () => {
          const region = trendRegionInput.value.trim();
          if (!region) { ui.notifications.warn("Indique une région."); return; }
          const cur = repAPI.getRegionTrend(region);
          const delta = Number(btn.dataset.delta) || 0;
          await repAPI.setRegionTrend(region, cur + delta);
          refreshTrend();
        });
      });
    }
  }, { width: 420, height: 560 }).render(true);
})();
