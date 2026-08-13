// systems/rpg/module/rules/distance.js
//
// ⚠️ OBSOLÈTE — plus aucun appelant dans le système.
// Ces fonctions comptent des CASES en distance de Manhattan (diagonale = 2),
// ce qui ne correspond ni aux mètres utilisés partout ailleurs, ni aux cercles
// dessinés sur le canevas. Toute vérification de portée passe désormais par
// `checkRange()` / `pointDistanceMeters()` dans utils/grid.js.
// Conservé en l'état au cas où une macro de monde l'appellerait encore.

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
  