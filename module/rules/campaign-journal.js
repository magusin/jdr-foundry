// module/rules/campaign-journal.js
//
// Journal de campagne automatique. Consigne les événements marquants
// (combats, niveaux, morts, forges...) dans une JournalEntry Foundry,
// sans aucune action du MJ — pure observation, zéro contrôle requis,
// donc compatible avec "le MJ valide tout" (rien n'est mécaniquement
// affecté ici, juste de la prise de notes automatique).

const JOURNAL_NAME = "Journal de Campagne";
const PAGE_NAME = "Chronique";

function todayLabel() {
  const d = new Date();
  return d.toLocaleDateString("fr-FR", { day: "2-digit", month: "long", year: "numeric" });
}

function nowLabel() {
  const d = new Date();
  return d.toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" });
}

async function getOrCreateJournal() {
  let entry = game.journal.find(j => j.name === JOURNAL_NAME);
  if (!entry) {
    entry = await JournalEntry.create({
      name: JOURNAL_NAME,
      pages: [{ name: PAGE_NAME, type: "text", text: { content: "<p><i>La chronique commence...</i></p>", format: 1 } }]
    });
  }
  return entry;
}

async function getOrCreatePage(entry, pageName = PAGE_NAME) {
  const name = String(pageName ?? "").trim() || PAGE_NAME;
  let page = entry.pages.find(p => p.name === name);
  if (!page) {
    const [created] = await entry.createEmbeddedDocuments("JournalEntryPage", [
      { name, type: "text", text: { content: "<p><i>La chronique commence...</i></p>", format: 1 } }
    ]);
    page = created;
  }
  return page;
}

/**
 * Nom de la page où consigner les événements d'une trame narrative
 * (system.arc d'une quête). Une trame nommée a sa PROPRE page : c'est ce
 * qui transforme la chronique en récit suivi par arc, plutôt qu'en une
 * seule liste où l'intrigue principale se noie entre les repos et les
 * forges. Une quête sans arc retombe sur la page commune.
 */
export function arcPageName(arc) {
  const a = String(arc ?? "").trim();
  return a ? `Trame — ${a}` : PAGE_NAME;
}

/**
 * Ajoute une ligne au journal de campagne. GM only (silencieux pour les joueurs).
 * @param {string} html - contenu HTML de la ligne (sans <p> englobant, ajouté automatiquement)
 * @param {object} [opts]
 * @param {string} [opts.page] - page de destination (défaut : « Chronique »).
 *   Voir arcPageName() : une quête portant une trame écrit sur la page de
 *   cette trame. Paramètre optionnel — les appelants historiques gardent
 *   la page commune sans changer d'un caractère.
 */
export async function appendToCampaignJournal(html, { page: pageName = PAGE_NAME } = {}) {
  if (!game.user.isGM) return;
  try {
    const entry = await getOrCreateJournal();
    const page  = await getOrCreatePage(entry, pageName);

    const current = String(page.text?.content ?? "");
    const line = `<p><b>[${todayLabel()} — ${nowLabel()}]</b> ${html}</p>`;
    const updated = current + line;

    await page.update({ "text.content": updated });
  } catch (e) {
    console.warn("[RPG] Journal de campagne : échec d'écriture", e);
  }
}
