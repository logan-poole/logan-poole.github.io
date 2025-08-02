// theme-toggle.js
const btn = document.getElementById('themeToggle');
const root = document.documentElement;

function setTheme(theme) {
  root.setAttribute('data-theme', theme);
  localStorage.setItem('theme', theme);
}

btn.addEventListener('click', () => {
  const current = root.getAttribute('data-theme') || 'light';
  const next = current === 'dark' ? 'light' : 'dark';
  setTheme(next);
});

const saved = localStorage.getItem('theme');
if (saved) setTheme(saved);
else setTheme(window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
