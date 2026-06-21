// ============================================================
//  input.js — touch + keyboard bindings for the control deck
// ============================================================

// Fire on pointerdown for the snappiest "trigger" feel; prevent the
// 300ms touch delay and any scroll/zoom side-effects.
function tap(el, fn) {
  if (!el) return;
  const handler = (e) => { e.preventDefault(); fn(); };
  el.addEventListener('pointerdown', handler, { passive: false });
}

export function bindControls(actions) {
  tap(document.getElementById('btn-fire'), actions.fire);
  tap(document.getElementById('btn-dodge'), actions.dodge);
  tap(document.getElementById('btn-move'), actions.move);
  tap(document.getElementById('btn-skill'), actions.skill);
  tap(document.getElementById('btn-shell'), actions.shell);
  tap(document.getElementById('btn-weapon'), actions.weapon);
  tap(document.getElementById('btn-halt'), actions.halt);

  // keyboard for desktop testing
  // ✕=Space/J fire, L dodge, M move, K Maximum Attack, C switch shell
  window.addEventListener('keydown', (e) => {
    if (e.repeat) return;
    switch (e.key.toLowerCase()) {
      case ' ': case 'j': case 'x': e.preventDefault(); actions.fire(); break;
      case 'l': case 'shift': actions.dodge(); break;
      case 'm': actions.move(); break;
      case 'k': actions.skill(); break;
      case 'c': actions.shell(); break;
      case 'r': case 't': actions.target(); break;
      case 'q': actions.weapon(); break;
      case 'h': actions.halt(); break;
    }
  });

  // block pinch-zoom / double-tap zoom on the game surface
  document.addEventListener('gesturestart', (e) => e.preventDefault());
  document.addEventListener('dblclick', (e) => e.preventDefault());
}
