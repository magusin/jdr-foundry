export function getStates(actor) {
    return Array.isArray(actor.system?.etatsActifs) ? actor.system.etatsActifs : [];
  }
  
  export async function removeState(actor, id) {
    const next = getStates(actor).filter(e => e?.id !== id);
    await actor.update({ "system.etatsActifs": next });
  }
  