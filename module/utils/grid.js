export function gridPosFromToken(token) {
  if (!token?.center || !canvas?.grid) return { gx: 0, gy: 0 };

  const { x, y } = token.center;

  // v12+ : canvas.grid.getOffset({x,y}) => {i,j}
  if (typeof canvas.grid.getOffset === "function") {
    const o = canvas.grid.getOffset({ x, y });
    // Foundry renvoie souvent {i, j}
    const gx = Number(o?.i ?? o?.x ?? 0);
    const gy = Number(o?.j ?? o?.y ?? 0);
    return { gx, gy };
  }

  // fallback ancien (devrait être rare)
  const size = canvas.grid.size || 100;
  return { gx: Math.floor(x / size), gy: Math.floor(y / size) };
}

export function manhattanDistanceTokens(a, b) {
  const A = gridPosFromToken(a);
  const B = gridPosFromToken(b);
  return Math.abs(A.gx - B.gx) + Math.abs(A.gy - B.gy);
}