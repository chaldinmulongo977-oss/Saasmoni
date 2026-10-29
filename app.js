import { createClient } from "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.45.4/+esm";
const { SUPABASE_URL, SUPABASE_ANON_KEY, API_URL } = window.ENV;
const sb = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
const $ = (s) => document.querySelector(s);
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const fmt = (d) => (d ? new Date(d).toLocaleString("fr-FR") : "—");
const standalone = matchMedia("(display-mode: standalone)").matches || navigator.standalone;
const st = { user: null, role: null, view: "home", maint: null, adminLogin: false, signup: false, deferred: null, payPlan: null, plans: [] };
const toast = (m) => { const t = $("#toast"); t.textContent = m; t.classList.remove("hidden"); setTimeout(() => t.classList.add("hidden"), 3500); };

async function api(path, init = {}) {
  const { data } = await sb.auth.getSession();
  const r = await fetch(API_URL + path, { ...init, headers: { "Content-Type": "application/json", Authorization: `Bearer ${data.session?.access_token}` } });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.message || j.error || "Erreur");
  return j;
}
const kpi = (l, v, s = "") => `<div class="rounded-2xl border bg-white p-4 shadow-sm"><p class="text-xs text-slate-500">${l}</p><p class="mt-1 text-2xl font-semibold">${v ?? "—"}</p>${s ? `<p class="text-xs text-slate-400">${s}</p>` : ""}</div>`;
const BADGE = { up: ["bg-emerald-100 text-emerald-700", "En ligne"], down: ["bg-red-100 text-red-700", "En panne"], pending: ["bg-amber-100 text-amber-700", "En attente"] };
const badge = (s) => `<span class="rounded-full px-2 py-0.5 text-xs ${BADGE[s][0]}">${BADGE[s][1]}</span>`;
const btn = "rounded-xl bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700";
const inp = "w-full rounded-xl border p-2.5 text-sm";

// ---------- Session & maintenance ----------
async function setUser(u) {
  st.user = u; st.role = null;
  if (u) {
    const { data } = await sb.from("profiles").select("role").eq("id", u.id).maybeSingle();
    st.role = data?.role ?? "client";
    if (!(st.view in (st.role === "superadmin" ? ADMIN_MENU : CLIENT_MENU))) st.view = st.role === "superadmin" ? "a_home" : "home";
  }
}
async function loadMaint() {
  const { data } = await sb.from("app_settings").select("*").eq("id", 1).maybeSingle();
  const changed = JSON.stringify([data?.maintenance, data?.maintenance_message]) !== JSON.stringify([st.maint?.maintenance, st.maint?.maintenance_message]);
  st.maint = data; return changed;
}
const CLIENT_MENU = { home: "Tableau de bord", monitors: "Mes sites", billing: "Abonnement", notifs: "Notifications" };
const ADMIN_MENU = { a_home: "Dashboard", a_pay: "Paiements & API", a_maint: "Maintenance", a_quotes: "Demandes sur mesure" };

// ---------- Écrans publics ----------
function maintScreen() {
  const m = st.maint;
  $("#app").innerHTML = `<div class="grid min-h-screen place-items-center bg-slate-900 p-6 text-center text-white"><div class="fi max-w-md space-y-4">
    <div class="fl text-5xl">🛠️</div><h1 class="text-2xl font-semibold">Le système est en maintenance</h1>
    <p class="text-slate-300">${esc(m?.maintenance_message || "Nous revenons très bientôt.")}</p>
    ${m?.maintenance_eta ? `<p class="text-sm text-indigo-300">Retour estimé : ${fmt(m.maintenance_eta)}</p>` : ""}
    <button data-act="adminLogin" class="text-xs text-slate-500 underline">Accès super administrateur</button></div></div>`;
}
function landing() {
  const cards = st.plans.map((p) => `<div class="rounded-2xl border bg-white p-6 shadow-sm"><h3 class="font-semibold">${esc(p.name)}</h3>
    <p class="mt-2 text-3xl font-bold">${p.price_monthly} <span class="text-sm font-normal text-slate-500">${p.currency}/mois</span></p>
    <p class="mt-2 text-sm text-slate-500">Jusqu'à ${p.max_monitors} moniteurs · contrôle toutes les ${p.interval_seconds} s</p>
    <button data-act="auth" class="${btn} mt-4 w-full">Choisir</button></div>`).join("");
  $("#app").innerHTML = `<header class="sticky top-0 z-10 border-b bg-white/90 backdrop-blur"><div class="mx-auto flex max-w-6xl items-center justify-between p-4">
    <b class="text-indigo-600">MoniSaaS</b><div class="flex gap-2">${st.deferred ? `<button data-act="install" class="rounded-xl border px-3 py-2 text-sm">Installer l'app</button>` : ""}
    <button data-act="auth" class="${btn}">Se connecter</button></div></div></header>
    <section class="mx-auto max-w-4xl px-4 py-20 text-center"><h1 class="fi text-4xl font-bold md:text-6xl">Votre application est surveillée pendant que vous dormez</h1>
    <p class="fi mx-auto mt-6 max-w-2xl text-slate-600">Ajoutez l'URL de votre site ou de votre API : MoniSaaS la vérifie en continu, confirme les pannes et vous alerte avec les informations utiles.</p>
    <button data-act="auth" class="${btn} mt-8 px-8 py-3">Commencer</button></section>
    <section class="mx-auto grid max-w-6xl gap-4 px-4 pb-16 md:grid-cols-3">${["Disponibilité & temps de réponse","Panne confirmée après 3 contrôles","Historique des incidents"].map((t) => `<div class="rounded-2xl border bg-white p-6"><h3 class="font-semibold">${t}</h3></div>`).join("")}</section>
    <section class="mx-auto max-w-6xl px-4 pb-20"><h2 class="mb-6 text-center text-2xl font-semibold">Offres</h2><div class="grid gap-4 md:grid-cols-4">${cards}
    <div class="rounded-2xl border border-indigo-200 bg-indigo-50 p-6"><h3 class="font-semibold">Entreprise / sur mesure</h3><p class="mt-2 text-sm text-slate-600">Quotas, équipes et intégrations selon votre besoin.</p><button data-act="auth" class="mt-4 w-full rounded-xl border border-indigo-600 px-4 py-2 text-sm text-indigo-700">Sur demande</button></div></div></section>
    <footer class="border-t p-6 text-center text-xs text-slate-500">La surveillance réduit le délai de détection mais ne garantit ni l'absence de panne ni une détection instantanée.</footer>`;
}
const SLIDES = [["📡", "Ajoutez votre site", "Collez l'URL de votre site ou API, nous la vérifions automatiquement."], ["🔔", "Soyez alerté", "Une panne confirmée vous est signalée, puis le rétablissement."], ["📊", "Suivez vos rapports", "Disponibilité, temps de réponse et incidents dans un tableau de bord."]];
let slide = 0;
function onboarding() {
  const [i, t, d] = SLIDES[slide];
  $("#app").innerHTML = `<div class="grid min-h-screen place-items-center bg-gradient-to-b from-indigo-600 to-indigo-900 p-6 text-center text-white"><div class="fi max-w-sm space-y-5" key="${slide}">
    <div class="fl text-7xl">${i}</div><h1 class="text-2xl font-semibold">${t}</h1><p class="text-indigo-100">${d}</p>
    <div class="flex justify-center gap-2">${SLIDES.map((_, n) => `<span class="h-2 rounded-full transition-all ${n === slide ? "w-6 bg-white" : "w-2 bg-white/40"}"></span>`).join("")}</div>
    <button data-act="next" class="w-full rounded-xl bg-white py-3 font-medium text-indigo-700">${slide === SLIDES.length - 1 ? "Commencer" : "Suivant"}</button>
    <button data-act="skip" class="text-sm text-indigo-200">Passer</button></div></div>`;
}
function authScreen() {
  $("#app").innerHTML = `<div class="grid min-h-screen place-items-center p-4"><div class="fi w-full max-w-sm space-y-4 rounded-2xl border bg-white p-6 shadow-sm">
    <h1 class="text-xl font-semibold">${st.signup ? "Créer un compte" : "Connexion"}</h1>
    <button data-act="google" class="flex w-full items-center justify-center gap-2 rounded-xl border py-2.5 text-sm">Continuer avec Google</button>
    <p class="text-center text-xs text-slate-400">ou avec vos informations</p>
    <form data-form="auth" class="space-y-3">${st.signup ? `<input name="name" required placeholder="Nom complet" class="${inp}">` : ""}
    <input name="email" type="email" required placeholder="E-mail" class="${inp}"><input name="password" type="password" minlength="8" required placeholder="Mot de passe" class="${inp}">
    <button class="${btn} w-full">${st.signup ? "S'inscrire" : "Se connecter"}</button></form>
    <button data-act="toggleSignup" class="w-full text-sm text-indigo-600">${st.signup ? "J'ai déjà un compte" : "Créer un compte"}</button></div></div>`;
}

// ---------- Coquille avec menu burger ----------
function shell() {
  const menu = st.role === "superadmin" ? ADMIN_MENU : CLIENT_MENU;
  $("#app").innerHTML = `<header class="sticky top-0 z-20 flex items-center gap-3 border-b bg-white p-3" style="padding-top:max(.75rem,env(safe-area-inset-top))">
    <button data-act="burger" aria-label="Menu" class="rounded-lg p-2 hover:bg-slate-100">☰</button><b class="text-indigo-600">MoniSaaS</b></header>
    <div id="ov" data-act="burger" class="fixed inset-0 z-30 hidden bg-black/40"></div>
    <nav id="drawer" class="fixed inset-y-0 left-0 z-40 w-64 -translate-x-full space-y-1 bg-white p-4 shadow-xl transition-transform">
    <p class="mb-3 truncate text-xs text-slate-400">${esc(st.user.email)}</p>
    ${Object.entries(menu).map(([k, l]) => `<button data-act="go" data-v="${k}" class="block w-full rounded-lg px-3 py-2 text-left text-sm ${st.view === k ? "bg-indigo-50 font-medium text-indigo-700" : "hover:bg-slate-100"}">${l}</button>`).join("")}
    <button data-act="logout" class="mt-4 block w-full rounded-lg px-3 py-2 text-left text-sm text-red-600 hover:bg-red-50">Déconnexion</button></nav>
    <main id="main" class="mx-auto max-w-5xl"></main>`;
}
async function getSub() {
  const { data } = await sb.from("subscriptions").select("plan_id,status,current_period_end").maybeSingle();
  return data && data.status === "active" && new Date(data.current_period_end) > new Date() ? data : null;
}

// ---------- Vues ----------
const V = {
  async home() {
    const [{ data: k }, { data: inc }, sub] = await Promise.all([sb.rpc("client_kpis"), sb.from("incidents").select("opened_at,resolved_at,last_error,monitors(name)").order("opened_at", { ascending: false }).limit(5), getSub()]);
    return `<div class="space-y-4 p-4"><h2 class="text-lg font-semibold">Tableau de bord</h2>
    ${sub ? "" : `<div class="rounded-xl bg-amber-50 p-3 text-sm text-amber-800">Sans abonnement actif : 1 site, contrôle toutes les 5 minutes. <button data-act="go" data-v="billing" class="underline">Voir les offres</button></div>`}
    <div class="grid grid-cols-2 gap-3 md:grid-cols-4">${kpi("Sites surveillés", k.monitors)}${kpi("En ligne", k.up)}${kpi("En panne", k.down)}${kpi("Incidents ouverts", k.open_incidents)}
    ${kpi("Disponibilité 24 h", k.uptime_24h == null ? null : k.uptime_24h + " %")}${kpi("Réponse moyenne 24 h", k.avg_ms_24h == null ? null : k.avg_ms_24h + " ms")}</div>
    <h3 class="pt-2 font-medium">Derniers incidents</h3>${(inc ?? []).map((i) => `<div class="rounded-xl border bg-white p-3 text-sm"><b>${esc(i.monitors?.name)}</b> — ${esc(i.last_error)}<br><span class="text-xs text-slate-500">${fmt(i.opened_at)} → ${i.resolved_at ? fmt(i.resolved_at) : "en cours"}</span></div>`).join("") || `<p class="text-sm text-slate-400">Aucun incident.</p>`}</div>`;
  },
  async monitors() {
    const { data } = await sb.from("monitors").select("*").order("created_at", { ascending: false });
    return `<div class="space-y-4 p-4"><h2 class="text-lg font-semibold">Mes sites</h2>
    <form data-form="monitor" class="grid gap-2 rounded-2xl border bg-white p-4 md:grid-cols-[1fr_2fr_auto]"><input name="name" required placeholder="Nom" class="${inp}"><input name="url" type="url" required placeholder="https://monsite.com" class="${inp}"><button class="${btn}">Ajouter</button></form>
    ${(data ?? []).map((m) => `<div class="flex items-center justify-between gap-2 rounded-xl border bg-white p-3 text-sm"><div class="min-w-0"><b>${esc(m.name)}</b> ${badge(m.status)}<p class="truncate text-xs text-slate-500">${esc(m.url)}</p>
    <p class="text-xs text-slate-400">${m.last_checked_at ? `${m.last_response_ms} ms · ${fmt(m.last_checked_at)}${m.last_error ? " · " + esc(m.last_error) : ""}` : "Première vérification en cours…"}</p></div>
    <button data-act="delMon" data-id="${m.id}" class="text-xs text-red-600">Supprimer</button></div>`).join("") || `<p class="text-sm text-slate-400">Aucun site. Ajoutez votre première URL.</p>`}</div>`;
  },
  async billing() {
    const [sub, { data: plans }] = await Promise.all([getSub(), sb.from("plans").select("*").eq("active", true).order("price_monthly")]);
    const p = st.payPlan && plans.find((x) => x.id === st.payPlan);
    return `<div class="space-y-4 p-4"><h2 class="text-lg font-semibold">Abonnement</h2>
    <p class="text-sm">${sub ? `Offre <b>${esc(sub.plan_id)}</b> active jusqu'au ${fmt(sub.current_period_end)}. Renouvelez en payant à nouveau : la durée s'ajoute.` : "Aucun abonnement actif."}</p>
    <div class="grid gap-3 md:grid-cols-3">${plans.map((x) => `<div class="rounded-2xl border bg-white p-4"><b>${esc(x.name)}</b><p class="text-2xl font-bold">${x.price_monthly} <span class="text-xs font-normal">${x.currency}/mois</span></p><p class="text-xs text-slate-500">${x.max_monitors} moniteurs · ${x.interval_seconds} s</p>
    <button data-act="pick" data-id="${x.id}" class="${btn} mt-3 w-full">${sub?.plan_id === x.id ? "Renouveler" : "Choisir"}</button></div>`).join("")}</div>
    ${p ? `<form data-form="pay" class="space-y-2 rounded-2xl border bg-white p-4"><b>Payer ${esc(p.name)} (${p.price_monthly} ${p.currency})</b>
    <select name="period" class="${inp}"><option value="monthly">Mensuel</option>${p.price_annual ? `<option value="annual">Annuel (${p.price_annual} ${p.currency})</option>` : ""}</select>
    <div class="grid grid-cols-2 gap-2"><input name="first_name" required placeholder="Prénom" class="${inp}"><input name="last_name" required placeholder="Nom" class="${inp}"></div>
    <input name="phone" required placeholder="+243…" class="${inp}"><div class="grid grid-cols-2 gap-2"><input name="country" required maxlength="2" placeholder="Pays (CD)" class="${inp}"><input name="network" required placeholder="Réseau (code SasPay)" class="${inp}"></div>
    <input type="hidden" name="plan_id" value="${p.id}"><button class="${btn} w-full">Payer</button><p id="payMsg" class="text-xs text-slate-500">L'abonnement s'active uniquement après confirmation du paiement par le serveur.</p></form>` : ""}
    <form data-form="quote" class="space-y-2 rounded-2xl border border-indigo-200 bg-indigo-50 p-4"><b>Offre entreprise / sur mesure</b>
    <input name="company" required placeholder="Entreprise" class="${inp}"><textarea name="need" required placeholder="Votre besoin" class="${inp}"></textarea><input name="contact" required placeholder="E-mail ou WhatsApp" class="${inp}"><button class="${btn}">Envoyer la demande</button></form></div>`;
  },
  async notifs() {
    const { data } = await sb.from("notifications").select("*").order("created_at", { ascending: false }).limit(50);
    sb.from("notifications").update({ read: true }).eq("read", false).then(() => {});
    return `<div class="space-y-2 p-4"><h2 class="text-lg font-semibold">Notifications</h2><p class="text-xs text-slate-400">Alertes dans l'application. E-mail et WhatsApp : fournisseur à brancher.</p>
    ${(data ?? []).map((n) => `<div class="rounded-xl border bg-white p-3 text-sm ${n.read ? "" : "border-indigo-300"}"><b>${esc(n.title)}</b><p>${esc(n.body)}</p><span class="text-xs text-slate-400">${fmt(n.created_at)}</span></div>`).join("") || `<p class="text-sm text-slate-400">Rien pour l'instant.</p>`}</div>`;
  },
  async a_home() {
    const [{ data: k }, { data: pays }, { data: s }] = await Promise.all([sb.rpc("admin_kpis"), sb.from("payments").select("amount,currency,status,plan_id,created_at").order("created_at", { ascending: false }).limit(10), sb.from("app_settings").select("worker_seen_at,maintenance").eq("id", 1).single()]);
    const alive = s.worker_seen_at && Date.now() - Date.parse(s.worker_seen_at) < 90000;
    const rev = Object.entries(k.revenue).map(([c, v]) => `${v} ${c}`).join(" · ") || "0";
    return `<div class="space-y-4 p-4"><h2 class="text-lg font-semibold">Dashboard super administrateur</h2>
    <div class="grid grid-cols-2 gap-3 md:grid-cols-4">${kpi("Utilisateurs", k.users)}${kpi("Abonnements actifs", k.active_subs, `${k.expiring_7d} expirent sous 7 j`)}${kpi("Revenus confirmés", rev)}${kpi("Paiements", k.payments_success, `${k.payments_pending} en attente · ${k.payments_failed} échoués`)}
    ${kpi("Sites surveillés", k.monitors, `${k.monitors_down} en panne`)}${kpi("Incidents ouverts", k.open_incidents)}${kpi("Moteur de surveillance", alive ? "Actif" : "Arrêté ?", fmt(s.worker_seen_at))}${kpi("Maintenance", s.maintenance ? "ACTIVE" : "Inactive")}</div>
    <h3 class="font-medium">Derniers paiements</h3>${(pays ?? []).map((p) => `<div class="flex justify-between rounded-xl border bg-white p-3 text-sm"><span>${esc(p.plan_id)} · ${p.amount} ${p.currency}</span><span>${p.status} · ${fmt(p.created_at)}</span></div>`).join("")}</div>`;
  },
  async a_pay() {
    const s = await api("/api/admin/payment-settings");
    return `<form data-form="settings" class="space-y-3 p-4"><h2 class="text-lg font-semibold">Paiements SasPay</h2>
    <label class="block text-sm">Clé API (sk_test_… / sk_live_…)<input name="api_key" type="password" autocomplete="off" class="${inp}" placeholder="${s.api_key_last4 ? `•••• ${s.api_key_last4} (${s.api_mode})` : "Non configurée"}"></label>
    <label class="block text-sm">Secret de signature du webhook<input name="webhook_secret" type="password" autocomplete="off" class="${inp}" placeholder="${s.webhook_secret_last4 ? `•••• ${s.webhook_secret_last4}` : "Non configuré"}"></label>
    <p class="break-all rounded-lg bg-slate-100 p-2 text-xs">URL du webhook à créer dans app.saspay.me : ${esc(s.webhook_url)}</p>
    <label class="block text-sm">Frais<select name="fee_charge_mode" class="${inp}"><option value="ADD_ON" ${s.fee_charge_mode === "ADD_ON" ? "selected" : ""}>Payés par le client (ADD_ON)</option><option value="DEDUCTED" ${s.fee_charge_mode === "DEDUCTED" ? "selected" : ""}>Déduits (DEDUCTED)</option></select></label>
    <label class="flex items-center gap-2 text-sm"><input type="checkbox" name="enabled" ${s.enabled ? "checked" : ""}> Paiements activés</label>
    <div class="flex gap-2"><button class="${btn}">Enregistrer</button><button type="button" data-act="testKey" class="rounded-xl border px-4 py-2 text-sm">Tester la clé</button></div></form>`;
  },
  async a_maint() {
    const { data: s } = await sb.from("app_settings").select("*").eq("id", 1).single();
    return `<form data-form="maint" class="space-y-3 p-4"><h2 class="text-lg font-semibold">Mode maintenance</h2><p class="text-sm text-slate-500">Quand il est actif, les clients et visiteurs voient « système en maintenance ». Les super administrateurs restent connectés.</p>
    <label class="flex items-center gap-2 text-sm"><input type="checkbox" name="maintenance" ${s.maintenance ? "checked" : ""}> Mettre le système en pause</label>
    <textarea name="message" class="${inp}" placeholder="Message affiché">${esc(s.maintenance_message)}</textarea>
    <label class="block text-sm">Retour estimé<input name="eta" type="datetime-local" class="${inp}" value="${s.maintenance_eta ? new Date(s.maintenance_eta).toISOString().slice(0, 16) : ""}"></label><button class="${btn}">Enregistrer</button></form>`;
  },
  async a_quotes() {
    const { data } = await sb.from("quote_requests").select("*").order("created_at", { ascending: false });
    return `<div class="space-y-2 p-4"><h2 class="text-lg font-semibold">Demandes sur mesure</h2>${(data ?? []).map((q) => `<div class="rounded-xl border bg-white p-3 text-sm"><b>${esc(q.company)}</b> · ${esc(q.contact)}<p>${esc(q.need)}</p><span class="text-xs text-slate-400">${fmt(q.created_at)}</span></div>`).join("") || `<p class="text-sm text-slate-400">Aucune demande.</p>`}</div>`;
  },
};
async function show() {
  shell(); $("#main").innerHTML = `<p class="p-6 text-slate-400">Chargement…</p>`;
  try { $("#main").innerHTML = await V[st.view](); } catch (e) { $("#main").innerHTML = `<p class="p-6 text-red-600">${esc(e.message)}</p>`; }
}
function render() {
  if (st.maint?.maintenance && st.role !== "superadmin" && !(st.adminLogin && !st.user)) { if (st.user) sb.auth.signOut(); return maintScreen(); }
  if (!st.user) return st.view === "auth" || st.adminLogin ? authScreen() : standalone ? (localStorage.onb ? authScreen() : onboarding()) : landing();
  show();
}

// ---------- Actions ----------
const A = {
  burger: () => { $("#drawer").classList.toggle("-translate-x-full"); $("#ov").classList.toggle("hidden"); },
  go: (el) => { st.view = el.dataset.v; show(); },
  auth: () => { st.view = "auth"; render(); },
  adminLogin: () => { st.adminLogin = true; render(); },
  toggleSignup: () => { st.signup = !st.signup; authScreen(); },
  next: () => { if (slide < SLIDES.length - 1) { slide++; onboarding(); } else A.skip(); },
  skip: () => { localStorage.onb = "1"; render(); },
  google: () => sb.auth.signInWithOAuth({ provider: "google", options: { redirectTo: location.origin + location.pathname } }),
  logout: async () => { await sb.auth.signOut(); st.view = "home"; st.adminLogin = false; },
  install: async () => { st.deferred?.prompt(); st.deferred = null; render(); },
  pick: (el) => { st.payPlan = el.dataset.id; show(); },
  delMon: async (el) => { if (confirm("Supprimer ce site ?")) { await sb.from("monitors").delete().eq("id", el.dataset.id); show(); } },
  testKey: () => api("/api/admin/payment-settings/test", { method: "POST" }).then(() => toast("Clé valide")).catch((e) => toast(e.message)),
};
const F = {
  async auth(d) {
    const r = st.signup ? await sb.auth.signUp({ email: d.email, password: d.password, options: { data: { full_name: d.name } } }) : await sb.auth.signInWithPassword({ email: d.email, password: d.password });
    if (r.error) return toast(r.error.message);
    if (st.signup && !r.data.session) toast("Vérifiez votre e-mail pour confirmer le compte");
  },
  async monitor(d) { const { error } = await sb.from("monitors").insert({ user_id: st.user.id, name: d.name, url: d.url }); toast(error ? (error.message.includes("monitor_limit_reached") ? "Limite atteinte : passez à une offre supérieure" : error.message) : "Site ajouté, vérification en cours"); show(); },
  async quote(d) { const { error } = await sb.from("quote_requests").insert(d); toast(error ? error.message : "Demande envoyée"); },
  async settings(d, f) {
    const body = { enabled: !!d.enabled, fee_charge_mode: d.fee_charge_mode, ...(d.api_key && { api_key: d.api_key }), ...(d.webhook_secret && { webhook_secret: d.webhook_secret }) };
    try { await api("/api/admin/payment-settings", { method: "PUT", body: JSON.stringify(body) }); toast("Enregistré"); show(); } catch (e) { toast(e.message); }
  },
  async maint(d) {
    const { error } = await sb.from("app_settings").update({ maintenance: !!d.maintenance, maintenance_message: d.message || null, maintenance_eta: d.eta ? new Date(d.eta).toISOString() : null }).eq("id", 1);
    toast(error ? error.message : "Enregistré"); await loadMaint(); show();
  },
  async pay(d) {
    const msg = $("#payMsg");
    try {
      const r = await api("/api/checkout", { method: "POST", body: JSON.stringify(d) });
      if (r.checkout_url) return (location.href = r.checkout_url);       // redirection requise par SasPay
      msg.textContent = "Confirmez le paiement sur votre téléphone…";
      for (let i = 0; i < 60; i++) {                                      // le statut vient du serveur (verify), jamais du navigateur
        await new Promise((ok) => setTimeout(ok, 5000));
        const { status } = await api(`/api/payments/${r.payment_id}/status`);
        if (status === "SUCCESS") { toast("Paiement confirmé, abonnement activé"); st.payPlan = null; return show(); }
        if (status === "FAILED") return (msg.textContent = "Paiement échoué. Vous pouvez réessayer.");
      }
      msg.textContent = "Toujours en attente : vous pouvez fermer cette page, l'abonnement s'activera à la confirmation.";
    } catch (e) { msg.textContent = e.message; }
  },
};
document.addEventListener("click", (e) => { const a = e.target.closest("[data-act]"); if (a) A[a.dataset.act]?.(a); });
document.addEventListener("submit", (e) => { const f = e.target.closest("[data-form]"); if (!f) return; e.preventDefault(); F[f.dataset.form]?.(Object.fromEntries(new FormData(f)), f); });
addEventListener("beforeinstallprompt", (e) => { e.preventDefault(); st.deferred = e; if (!st.user && !standalone) render(); });
if ("serviceWorker" in navigator) navigator.serviceWorker.register("./sw.js");

(async function boot() {
  const { data: pl } = await sb.from("plans").select("*").eq("active", true).order("price_monthly"); st.plans = pl ?? [];
  const { data } = await sb.auth.getSession(); await setUser(data.session?.user ?? null); await loadMaint(); render();
  sb.auth.onAuthStateChange(async (ev, s) => { if (ev === "SIGNED_IN" || ev === "SIGNED_OUT") { await setUser(s?.user ?? null); render(); } });
  setInterval(async () => { if (await loadMaint()) render(); }, 30000);
})();
