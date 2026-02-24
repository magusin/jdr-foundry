// systems/rpg/module/rules/distance.js

function getGridPosFromPixels(x, y) {
    // v11/v12 selon
    if (canvas.grid?.getGridPositionFromPixels) return canvas.grid.getGridPositionFromPixels(x, y);
    if (canvas.grid?.grid?.getGridPositionFromPixels) return canvas.grid.grid.getGridPositionFromPixels(x, y);
    // fallback grossier
    const gs = canvas.grid.size;
    return [Math.floor(y / gs), Math.floor(x / gs)];
  }
  
  export function manhattanSquares(a, b) {
    // a/b: {x,y} en pixels (ex: token.center)
    const [r1, c1] = getGridPosFromPixels(a.x, a.y);
    const [r2, c2] = getGridPosFromPixels(b.x, b.y);
    return Math.abs(r1 - r2) + Math.abs(c1 - c2);
  }
  
  // Pour quand tu veux une “distance en cases”
  export function measureDistanceManhattan(a, b) {
    return manhattanSquares(a, b);
  }
  