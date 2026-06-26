// module/rules/reputation.js
//
// Réputation d'un PJ par région et par vendeur, + tendance du marché par
// région. Stocké en flags (méta-donnée MJ, hors du data model du PJ) —
// jamais montré tel quel aux joueurs : seul le MJ le consulte pour ajuster
// le prix final qu'il annonce en jeu.

const FLAG_SCOPE = "rpg";
const FLAG_REP   = "reputation";

const n = (v, d = 0) => { const x = Number(v); return Number.isFinite(x) ? x : d; };

function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }

// ── Réputation PJ ↔ région / vendeur ───────────────────────────────────

function getRepBlock(actor) {
  return foundry.utils.deepClone(actor.getFlag(FLAG_SCOPE, FLAG_REP) ?? { regions: {}, vendors: {} });
}

export function getRegionRep(actor, region) {
  const block = getRepBlock(actor);
  return n(block.regions?.[region], 0);
}

export function getVendorRep(actor, vendor) {
  const block = getRepBlock(actor);
  return n(block.vendors?.[vendor], 0);
}

export async function adjustRegionRep(actor, region, delta) {
  const block = getRepBlock(actor);
  block.regions = block.regions ?? {};
  block.regions[region] = clamp(n(block.regions[region], 0) + n(delta, 0), -100, 100);
  await actor.setFlag(FLAG_SCOPE, FLAG_REP, block);
  return block.regions[region];
}

export async function adjustVendorRep(actor, vendor, delta) {
  const block = getRepBlock(actor);
  block.vendors = block.vendors ?? {};
  block.vendors[vendor] = clamp(n(block.vendors[vendor], 0) + n(delta, 0), -100, 100);
  await actor.setFlag(FLAG_SCOPE, FLAG_REP, block);
  return block.vendors[vendor];
}

export function listKnownRegionsFor(actor) {
  return Object.keys(getRepBlock(actor).regions ?? {});
}

export function listKnownVendorsFor(actor) {
  return Object.keys(getRepBlock(actor).vendors ?? {});
}

/** Toutes les régions/vendeurs jamais utilisés, tous PJ confondus (pour les listes déroulantes). */
export function listAllKnownRegions() {
  const set = new Set();
  for (const a of game.actors.filter(a => a.type === "character")) {
    for (const r of listKnownRegionsFor(a)) set.add(r);
  }
  for (const r of Object.keys(getAllRegionTrends())) set.add(r);
  return Array.from(set).sort((a, b) => a.localeCompare(b, "fr"));
}

export function listAllKnownVendors() {
  const set = new Set();
  for (const a of game.actors.filter(a => a.type === "character")) {
    for (const v of listKnownVendorsFor(a)) set.add(v);
  }
  return Array.from(set).sort((a, b) => a.localeCompare(b, "fr"));
}

// ── Tendance du marché par région (monde, pas par PJ) ──────────────────

export function getAllRegionTrends() {
  return foundry.utils.deepClone(game.settings?.get?.("rpg", "regionMarketTrend") ?? {});
}

export function getRegionTrend(region) {
  const all = getAllRegionTrends();
  return n(all[region], 0);
}

export async function setRegionTrend(region, pct) {
  const all = getAllRegionTrends();
  all[region] = clamp(n(pct, 0), -50, 100);
  await game.settings.set("rpg", "regionMarketTrend", all);
  return all[region];
}

// ── Calcul du prix ajusté ────────────────────────────────────────────────

/**
 * Combine réputation région + vendeur en un % de remise (positif = moins cher).
 * Chaque point de réputation = 0.3% de remise, plafonné à 30% au total.
 */
export function computeReputationDiscountPct(actor, region, vendor) {
  const regionRep = region ? getRegionRep(actor, region) : 0;
  const vendorRep  = vendor ? getVendorRep(actor, vendor)  : 0;
  const combined = regionRep * 0.5 + vendorRep; // le vendeur compte plus que la région générale
  const pct = combined * 0.3;
  return clamp(pct, -30, 30); // une mauvaise réputation peut aussi RENCHÉRIR le prix
}

/**
 * Calcule le prix final suggéré (en cuivre) à partir du prix de base,
 * de la tendance régionale et de la réputation. Le MJ peut toujours
 * l'ajuster manuellement avant de valider la transaction.
 */
export function computeAdjustedPrice(basePriceCopper, { actor, region, vendor } = {}) {
  const trendPct = region ? getRegionTrend(region) : 0;
  const repPct   = actor ? computeReputationDiscountPct(actor, region, vendor) : 0;

  let price = n(basePriceCopper, 0);
  price *= (1 + trendPct / 100);
  price *= (1 - repPct / 100);

  return Math.max(0, Math.round(price));
}
