export function gridPosFromToken(token) {
    const t = token?.document ? token : canvas.tokens?.get(token?.id) ?? token;
    if (!t) return null;
  
    const g = canvas.grid.grid;
    const { x, y } = t.center;
  
    if (g?.getGridPositionFromPixels) {
      const [gx, gy] = g.getGridPositionFromPixels(x, y);
      return { gx, gy };
    }
  
    const size = canvas.grid.size;
    return { gx: Math.floor(x / size), gy: Math.floor(y / size) };
  }
  
  export function manhattanDistanceTokens(tokenA, tokenB) {
    const a = gridPosFromToken(tokenA);
    const b = gridPosFromToken(tokenB);
    if (!a || !b) return 0;
    return Math.abs(a.gx - b.gx) + Math.abs(a.gy - b.gy);
  }