/* =========================================================================
   scripts/theme-toggle.js
   - Toggles site theme by setting <html data-theme="dark"> (light = unset)
   - Persists to localStorage, follows system if no manual choice
   - Listens to and emits 'pinged:theme' for map style sync
=========================================================================== */
(function () {
  const STORAGE_KEY = 'pinged.theme';
  const root = document.documentElement;
  // Support either id in legacy markup; normalized to #theme-toggle now:
  const btn  = document.getElementById('theme-toggle') || document.getElementById('themeToggle');
  if (!btn) return;

  function apply(theme) {
    try { window.dispatchEvent(new CustomEvent('pinged:theme', { detail: theme })); } catch(e) {}
    if (theme === 'dark') root.setAttribute('data-theme', 'dark');
    else root.removeAttribute('data-theme'); // light is default
    localStorage.setItem(STORAGE_KEY, theme);
  }

  function current() { return root.getAttribute('data-theme') === 'dark' ? 'dark' : 'light'; }

  // Initialize from saved pref (or system)
  let theme = localStorage.getItem(STORAGE_KEY);
  if (!theme) theme = matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  apply(theme);

  btn.addEventListener('click', () => apply(current() === 'dark' ? 'light' : 'dark'));

  // If user hasn’t chosen, follow system changes
  matchMedia('(prefers-color-scheme: dark)').addEventListener('change', e => {
    if (!localStorage.getItem(STORAGE_KEY)) apply(e.matches ? 'dark' : 'light');
  });
})();
