// Tiny toast helper, plus "carry-over" support via sessionStorage
(function () {
  const root = document.createElement('div');
  root.id = 'toast-root';
  root.setAttribute('aria-live', 'polite');
  root.setAttribute('aria-atomic', 'true');

  function ensureRoot() {
    if (!document.body.contains(root)) document.body.appendChild(root);
  }

  function show(msg, type = 'info', ms = 2600) {
    ensureRoot();
    const el = document.createElement('div');
    el.className = `toast ${type}`;
    el.innerHTML = `
      <div class="toast-content">
        <span class="dot"></span>
        <div class="text">${msg}</div>
        <button class="close" aria-label="Dismiss">✕</button>
      </div>`;
    root.appendChild(el);
    const remove = () => { el.classList.add('out'); setTimeout(() => el.remove(), 220); };
    el.querySelector('.close').onclick = remove;
    setTimeout(remove, ms);
    return el;
  }

  // Read a pending "carry-over" toast set before a redirect
  function playCarryOver() {
    try {
      const raw = sessionStorage.getItem('toast_msg');
      if (!raw) return;
      const { msg, type, ms } = JSON.parse(raw);
      sessionStorage.removeItem('toast_msg');
      show(msg, type, ms);
    } catch {}
  }

  // Expose API
  window.notify = {
    show,
    success: (m, ms) => show(m, 'success', ms),
    error:   (m, ms) => show(m, 'error', ms),
    info:    (m, ms) => show(m, 'info', ms),
    warn:    (m, ms) => show(m, 'warn', ms),
    carryNext(msg, type = 'info', ms = 2600) {
      try { sessionStorage.setItem('toast_msg', JSON.stringify({ msg, type, ms })); } catch {}
    }
  };

  // Mount root + show carry-over after the DOM is ready
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => { document.body.appendChild(root); playCarryOver(); });
  } else {
    document.body.appendChild(root); playCarryOver();
  }
})();
