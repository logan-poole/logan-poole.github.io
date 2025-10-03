/* Compact reactions with + picker (Feed + Chat)
 * Usage: window.mountReactions(container, { type: 'post'|'message', id })
 * Tables & RLS: post_reactions, message_reactions
 */
(function () {
  const EMOJIS = [
    "👍","❤️","😂","😮","😢","🔥","🎉","👏","🙌","🤝",
    "✅","❌","⭐","🤩","😍","🤔","😅","🤗","😴","😎",
    "😡","😭","🤯","😬","😇","😉","😁","🙏","💯","🎯",
    "🥳","🚀","🌟","🤘","🧠","😤","😱","😆","😏","🥰",
    "😘","😒","🤨","👀","😐","💩","😜","😋","🤤","😈"
  ];

  const TABLES = {
    post:    { table: 'post_reactions',    fk: 'post_id'    },
    message: { table: 'message_reactions', fk: 'message_id' },
  };

  function getSB() {
    if (typeof window.getSB === 'function') return window.getSB();
    if (window.__sb && window.__sb.auth) return window.__sb;
    if (window.supabase && window.supabase.auth) return window.supabase;
    return null;
  }

  /* ---------- DOM helpers ---------- */
  const el = (tag, cls, html) => {
    const n = document.createElement(tag);
    if (cls) n.className = cls;
    if (html != null) n.innerHTML = html;
    return n;
  };

  /* ---------- Data ops ---------- */
  async function fetchAll(sb, type, id) {
    const { table, fk } = TABLES[type];
    const { data, error } = await sb.from(table).select('emoji, user_id').eq(fk, id);
    if (error) throw error;
    return data || [];
  }

  function aggregate(rows, myId) {
    const counts = new Map();
    const mine = new Set();
    for (const r of rows) {
      counts.set(r.emoji, (counts.get(r.emoji) || 0) + 1);
      if (r.user_id === myId) mine.add(r.emoji);
    }
    return { counts, mine };
  }

  async function toggle(sb, type, id, emoji, hasMine) {
    const { table, fk } = TABLES[type];
    if (hasMine) {
      const { data: { user } } = await sb.auth.getUser();
      return sb.from(table).delete()
        .eq(fk, id).eq('emoji', emoji).eq('user_id', user.id);
    } else {
      return sb.from(table).insert({ [fk]: id, emoji });
    }
  }

  /* ---------- Picker ---------- */
  let openPickerEl = null;
  function closePicker() {
    if (openPickerEl) {
      openPickerEl.remove();
      openPickerEl = null;
      document.removeEventListener('keydown', onEsc);
      document.removeEventListener('click', onOutside, true);
    }
  }
  function onEsc(e){ if (e.key === 'Escape') closePicker(); }
  function onOutside(e){ if (openPickerEl && !openPickerEl.contains(e.target)) closePicker(); }

  function openPicker(anchorBtn, mine, onPick) {
    closePicker();

    const picker = el('div', 'react-picker');
    const grid = el('div', 'react-grid');
    picker.appendChild(grid);

    for (const emoji of EMOJIS) {
      const b = el('button', null, emoji);
      if (mine.has(emoji)) b.classList.add('active');
      b.addEventListener('click', () => { onPick(emoji); closePicker(); });
      grid.appendChild(b);
    }

    document.body.appendChild(picker);

    // position near anchor
    const r = anchorBtn.getBoundingClientRect();
    const pad = 8;
    const top = Math.min(window.innerHeight - picker.offsetHeight - pad, Math.max(pad, r.bottom + 6));
    const left = Math.min(window.innerWidth - picker.offsetWidth - pad, Math.max(pad, r.left));
    picker.style.top = `${top}px`;
    picker.style.left = `${left}px`;

    openPickerEl = picker;
    setTimeout(() => { // defer to avoid immediate close on same click
      document.addEventListener('keydown', onEsc);
      document.addEventListener('click', onOutside, true);
    }, 0);
  }

  /* ---------- Bar rendering ---------- */
  function renderChips(root, counts, mine, onToggle) {
    const addBtn = root.querySelector('.react-add');
    root.innerHTML = '';
    if (addBtn) root.appendChild(addBtn);

    // show emojis with count>0 (sorted by count desc)
    const sorted = Array.from(counts.entries())
      .filter(([, c]) => c > 0)
      .sort((a, b) => b[1] - a[1]);

    for (const [emoji, count] of sorted) {
      const chip = el('button', 'react-chip', `
        <span class="emoji">${emoji}</span><span class="count">${count}</span>
      `);
      chip.type = 'button';
      chip.dataset.emoji = emoji;
      if (mine.has(emoji)) chip.classList.add('active');
      chip.addEventListener('click', () => onToggle(emoji, chip.classList.contains('active')));
      root.appendChild(chip);
    }
  }

  function buildBar(root, sb, type, id, refresh) {
    const add = el('button', 'react-add', '+');
    add.type = 'button';
    add.setAttribute('aria-label', 'Add reaction');
    root.appendChild(add);

    const LONG_MS = 350;
    let pressTimer = null;

    const open = async () => {
      const rows = await fetchAll(sb, type, id);
      const { data: { user } } = await sb.auth.getUser();
      const { counts, mine } = aggregate(rows, user?.id);
      openPicker(add, mine, async (emoji) => {
        const hasMine = mine.has(emoji);
        try {
          await toggle(sb, type, id, emoji, hasMine);
        } finally {
          await refresh();          // <— optimistic refresh after picking
        }
      });
    };

    add.addEventListener('click', open);
    add.addEventListener('pointerdown', () => { pressTimer = setTimeout(open, LONG_MS); });
    ['pointerup','pointercancel','pointerleave'].forEach(ev =>
      add.addEventListener(ev, () => { if (pressTimer) { clearTimeout(pressTimer); pressTimer = null; } })
    );

    return add;
  }

  /* ---------- Mount ---------- */
  async function mountReactions(container, { type, id }) {
    const sb = getSB(); if (!sb) return;
    const { data: sess } = await sb.auth.getSession(); if (!sess?.session) return;

    let channel;

    async function refresh() {
      try {
        const rows = await fetchAll(sb, type, id);
        const { data: { user } } = await sb.auth.getUser();
        const { counts, mine } = aggregate(rows, user?.id);

        renderChips(container, counts, mine, async (emoji, hasMine) => {
          try {
            await toggle(sb, type, id, emoji, hasMine);
          } finally {
            await refresh();        // <— optimistic refresh after clicking a chip
          }
        });

        // Keep + button first
        const addBtn = container.querySelector('.react-add');
        if (!addBtn) buildBar(container, sb, type, id, refresh);
        else container.prepend(addBtn);
      } catch (e) { console.error('[reactions] refresh', e); }
    }

    // Build bar (+) and do first draw
    buildBar(container, sb, type, id, refresh);
    await refresh();

    // Realtime: listen for INSERT/DELETE on this item
    try {
      const { table, fk } = TABLES[type];
      channel = sb.channel(`reactions:${type}:${id}`);
      channel.on(
        'postgres_changes',
        { event: '*', schema: 'public', table, filter: `${fk}=eq.${id}` },
        () => refresh()
      ).subscribe();
    } catch (e) {
      console.warn('[reactions] realtime unavailable:', e?.message || e);
    }

    // Optional: clean up if container is removed
    const obs = new MutationObserver(() => {
      if (!document.body.contains(container) && channel) {
        try { sb.removeChannel(channel); } catch {}
        obs.disconnect();
      }
    });
    obs.observe(document.body, { childList: true, subtree: true });

    return { refresh };
  }

  window.mountReactions = mountReactions;
})();
