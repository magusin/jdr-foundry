/**
 * Macro "JDR — Réputation & Marché Régional (MJ)"
 *
 * Permet au MJ d'ajuster la réputation d'un PJ avec une région ou un
 * vendeur précis, et la tendance générale du marché d'une région
 * (pénurie/abondance). Ces valeurs ne sont jamais montrées aux joueurs —
 * elles servent uniquement au MJ pour calculer le prix qu'il annonce.
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
        <label style="font-weight:600;display:block;margin-bottom:4px">Réputation — Vendeur / PNJ</label>
        <div style="display:flex;gap:8px;margin-bottom:4px">
          <input id="rep-vendor" type="text" list="rep-vendor-list" placeholder="Nom du vendeur/PNJ" style="flex:1" />
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

      pjSel.addEventListener("change", () => { refreshRegion(); refreshVendor(); });
      regionInput.addEventListener("input", refreshRegion);
      vendorInput.addEventListener("input", refreshVendor);
      trendRegionInput.addEventListener("input", refreshTrend);

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
          } else {
            const vendor = vendorInput.value.trim();
            if (!vendor) { ui.notifications.warn("Indique un vendeur."); return; }
            await repAPI.adjustVendorRep(pj, vendor, delta);
            refreshVendor();
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
