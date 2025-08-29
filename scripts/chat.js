/* scripts/chat.js
   PURPOSE
   - Real chat wired to Postgres RPCs with RLS enforcement.

   RPCs USED
   - get_or_create_direct_conversation(other_user uuid) -> uuid
   - list_messages(p_conversation_id uuid, p_limit int, p_before timestamptz) -> setof rows
   - send_message(p_conversation_id uuid, p_body text) -> uuid

   DOM CONTRACT
   - #chat-log: scrolling container for messages
   - #chat-form: form to send
   - #chat-text: input text
   - Optional: ?with=<uuid> in URL to target a specific user; otherwise uses seeded TestUser.

   REQUIREMENTS
   - scripts/sb-client.js loaded and configured
*/
(function () {
  const TEST_USER = "11111111-1111-1111-1111-111111111111";
  const qs = (s, r = document) => r.querySelector(s);
  const log = qs("#chat-log");
  const form = qs("#chat-form");
  const input = qs("#chat-text");

  let cid = null, me = null, sub = null;

  function fmt(ts){ try { return new Date(ts).toLocaleString(); } catch { return ts; } }
  function esc(s){ return String(s ?? "").replace(/[&<>]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;'}[c])); }
  function param(name){ return new URLSearchParams(location.search).get(name); }
  function scrollBottom(){ if (log) log.scrollTop = (log.scrollHeight || 0) + 999; }

  async function requireAuth(sb) {
    const { data } = await sb.auth.getSession();
    const user = data?.session?.user || null;
    if (!user) { location.replace("index.html?signin=1&next=" + encodeURIComponent(location.pathname)); throw new Error("Not signed in"); }
    me = user.id; return me;
  }

  async function ensureConversation(sb) {
    const other = (param("with") || TEST_USER).trim();
    const { data, error } = await sb.rpc("get_or_create_direct_conversation", { other_user: other });
    if (error) throw error;
    cid = data; return cid;
  }

  async function paint(sb) {
    const { data, error } = await sb.rpc("list_messages", { p_conversation_id: cid, p_limit: 200, p_before: null });
    if (error) throw error;
    if (!log) return;
    log.innerHTML = "";
    for (const m of data) {
      const mine = m.sender_id === me;
      const p = document.createElement("p");
      p.className = mine ? "msg mine" : "msg";
      p.innerHTML = `<strong>${mine ? "You" : esc(m.sender_id)}</strong>: ${esc(m.body)} <span class="muted">• ${fmt(m.created_at)}</span>`;
      log.appendChild(p);
    }
    scrollBottom();
  }

  function subscribeRealtime(sb) {
    if (!cid) return;
    if (sub) { sb.removeChannel(sub); sub = null; }
    sub = sb.channel("chat:" + cid).on(
      "postgres_changes",
      { event: "INSERT", schema: "public", table: "messages", filter: "conversation_id=eq." + cid },
      async () => { try { await paint(sb); } catch (e) { console.warn(e); } }
    ).subscribe();
  }

  document.addEventListener("DOMContentLoaded", async () => {
    const sb = (typeof window.getSB === "function" ? window.getSB() : null);
    if (!sb) { alert("Supabase not initialized."); return; }
    try {
      await requireAuth(sb);
      await ensureConversation(sb);
      await paint(sb);
      subscribeRealtime(sb);
    } catch (e) {
      console.error("[chat]", e);
      return;
    }

    form?.addEventListener("submit", async (e) => {
      e.preventDefault();
      const text = (input?.value || "").trim(); if (!text) return;
      input.disabled = true;
      try {
        const { error } = await sb.rpc("send_message", { p_conversation_id: cid, p_body: text });
        if (error) throw error;
        input.value = "";
        await paint(sb);
      } catch (err) {
        console.error("[send]", err); alert(err.message || "Failed to send");
      } finally {
        input.disabled = false; input.focus();
      }
    });
  });
})();
