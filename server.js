// UzPay — сервер для Render / Railway / любого Node-хостинга (Node 20+, база Postgres)
//
// Переменные окружения:
//   DATABASE_URL   — строка подключения к Postgres (например, из Neon). ОБЯЗАТЕЛЬНО
//   ADMIN_PASS     — пароль админ-панели. ОБЯЗАТЕЛЬНО
//   BOT_TOKEN, ADMIN_CHAT_ID — по желанию: Telegram-уведомления вам о новых заказах
//   DELIVER_URL, SECRET      — по желанию: адрес вашего сервера/поставщика для выдачи заказов
//   PORT           — задаёт хостинг сам

import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const DEFAULT = {
  name: "UzPay", accent: "#1f73c9", maintenance: false, timer: 5, regPerIp: 5, gameCap: 3000,
  premium: [
    { m: 1, price: 45000, old: 0, badge: "admin" },
    { m: 3, price: 156000, old: 170000, badge: "-8%" },
    { m: 6, price: 208000, old: 0, badge: "-10%" },
    { m: 12, price: 377000, old: 0, badge: "-6%" },
    { m: 12, price: 300000, old: 0, badge: "admin" },
  ],
  starPrice: 190, starMin: 50,
  starPresets: [50, 75, 100, 250, 500, 1000, 1500, 2000, 5000, 6666],
  gifts: [
    { e: "🧸", price: 2850, old: 3000 }, { e: "💝", price: 2850, old: 3000 },
    { e: "🌹", price: 5000, old: 7000 }, { e: "🎁", price: 5000, old: 7000 },
    { e: "🎂", price: 10000, old: 0 }, { e: "💐", price: 10000, old: 0 },
  ],
  pay: { balans: true, karta: true, click: true, uzumcard: true },
  req: { karta: { number: "", holder: "" }, click: { number: "", holder: "" }, uzumcard: { number: "", holder: "" } },
  ref: { every: 5, emoji: "🧸", mode: "first_order" },
  upg: { on: true, chances: [60, 52, 45, 38, 32, 26, 20, 15, 10] },
  games: {
    wheel:  { on: true, big: true,  win: 30,  min: 100, max: 500, cd: 60, day: 3 },
    boxes:  { on: true, big: true,  win: 33,  min: 100, max: 500, cd: 60, day: 3 },
    tap:    { on: true, big: false, win: 100, min: 20,  max: 50,  cd: 20, day: 5 },
    memory: { on: true, big: false, win: 100, min: 20,  max: 50,  cd: 20, day: 5 },
    flip:   { on: true, big: false, win: 50,  min: 20,  max: 50,  cd: 10, day: 10 },
  },
};
const SKILL = { tap: 1, memory: 1 };
const TAP = { target: 30, seconds: 10, minMs: 3000, maxMs: 40000 };
const MEMORY = { minMs: 6000, maxMs: 300000 };

const UPG = { tiers: ["🧸", "💝", "🌹", "🎁", "🍾", "💐", "🎂", "🚀", "🏆", "💎"], chance: [60, 52, 45, 38, 32, 26, 20, 15, 10] };
const giftOf = (item) => { const m = /^(?:🎁 )?Gift\s+(\S+)/u.exec(String(item || "")); if (!m) return null; const t = UPG.tiers.indexOf(m[1]); return { e: m[1], tier: Math.max(0, t) }; };
const invView = (rows, cfg) => rows.map((r) => ({ id: r.id, e: r.e, tier: r.tier, p: r.tier < UPG.tiers.length - 1 && cfg.upg.on ? cfg.upg.chances[r.tier] : 0, next: UPG.tiers[r.tier + 1] || "" }));
function clean(c) {
  c = c || {};
  const d = DEFAULT;
  const n = (v, def, min = 0, max = 1e9) => { v = Math.round(Number(v)); return Number.isFinite(v) ? Math.min(max, Math.max(min, v)) : def; };
  const s = (v, max) => String(v == null ? "" : v).slice(0, max);
  const o = {
    name: s(c.name, 30).trim() || d.name,
    accent: /^#[0-9a-fA-F]{6}$/.test(c.accent) ? c.accent : d.accent,
    maintenance: !!c.maintenance, timer: n(c.timer, 5, 1, 60), regPerIp: n(c.regPerIp, 5, 0, 1000), gameCap: n(c.gameCap, 3000, 0, 1e7),
    starPrice: n(c.starPrice, 190, 1, 1e6), starMin: n(c.starMin, 50, 1, 1e5),
    premium: (Array.isArray(c.premium) ? c.premium : d.premium).slice(0, 12).map((p) => ({ m: n(p.m, 1, 1, 120), price: n(p.price, 0), old: n(p.old, 0), badge: s(p.badge, 12) })),
    starPresets: (Array.isArray(c.starPresets) ? c.starPresets : d.starPresets).slice(0, 30).map((x) => n(x, 0, 0, 1e5)).filter((x) => x > 0),
    gifts: (Array.isArray(c.gifts) ? c.gifts : d.gifts).slice(0, 30).map((g) => ({ e: s(g.e, 8), price: n(g.price, 0), old: n(g.old, 0) })),
    pay: {}, req: {}, ref: {}, upg: {}, games: {},
  };
  if (!o.premium.length) o.premium = structuredClone(d.premium);
  if (!o.starPresets.length) o.starPresets = d.starPresets.slice();
  for (const k in d.pay) o.pay[k] = c.pay && k in c.pay ? !!c.pay[k] : d.pay[k];
  for (const k in d.req) { const r = (c.req && c.req[k]) || {}; o.req[k] = { number: s(r.number, 40), holder: s(r.holder, 40) }; }
  const r = c.ref || {};
  o.ref = { every: n(r.every, 5, 1, 1000), emoji: s(r.emoji, 8) || "🧸", mode: r.mode === "register" ? "register" : "first_order" };
  const u0 = c.upg || {};
  o.upg = { on: u0.on === undefined ? true : !!u0.on, chances: d.upg.chances.map((v, i) => n(Array.isArray(u0.chances) ? u0.chances[i] : v, v, 0, 100)) };
  for (const k in d.games) {
    const dg = d.games[k], g = (c.games && c.games[k]) || dg;
    const x = { on: !!g.on, big: dg.big, win: n(g.win, dg.win, 0, 100), min: n(g.min, dg.min, 0, 1e6), max: n(g.max, dg.max, 0, 1e6), cd: n(g.cd, dg.cd, 0, 86400), day: n(g.day, dg.day, 0, 1000) };
    if (x.max < x.min) x.max = x.min;
    o.games[k] = x;
  }
  return o;
}


const SCHEMA = [
  "CREATE TABLE IF NOT EXISTS kv(k TEXT PRIMARY KEY, v TEXT)",
  "CREATE TABLE IF NOT EXISTS users(username TEXT PRIMARY KEY, name TEXT, salt TEXT, hash TEXT, balance BIGINT DEFAULT 0, ref_by TEXT, ref_count INTEGER DEFAULT 0, ref_counted INTEGER DEFAULT 0, created BIGINT, ip TEXT)",
  "CREATE TABLE IF NOT EXISTS sessions(token TEXT PRIMARY KEY, username TEXT, created BIGINT)",
  "CREATE TABLE IF NOT EXISTS orders(id TEXT PRIMARY KEY, username TEXT, type TEXT, item TEXT, sum BIGINT, who TEXT, pay TEXT, status TEXT, created BIGINT, err TEXT)",
  "CREATE INDEX IF NOT EXISTS ord_user ON orders(username, created)",
  "CREATE TABLE IF NOT EXISTS plays(username TEXT, game TEXT, day TEXT, n INTEGER, last BIGINT, paid BIGINT, PRIMARY KEY(username, game, day))",
  "CREATE TABLE IF NOT EXISTS gstate(username TEXT PRIMARY KEY, game TEXT, ts BIGINT)",
  "CREATE TABLE IF NOT EXISTS rl(k TEXT PRIMARY KEY, n INTEGER, ts BIGINT)",
  "CREATE TABLE IF NOT EXISTS rewards(username TEXT, idx INTEGER, PRIMARY KEY(username, idx))",
  "CREATE TABLE IF NOT EXISTS inv(id TEXT PRIMARY KEY, owner TEXT, e TEXT, tier INTEGER, created BIGINT)",
  "CREATE INDEX IF NOT EXISTS inv_owner ON inv(owner)",
];

const CORS = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Methods": "GET, POST, OPTIONS", "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Admin", "Access-Control-Max-Age": "86400" };
const J = (d, s = 200) => new Response(JSON.stringify(d), { status: s, headers: { "Content-Type": "application/json", "Cache-Control": "no-store", ...CORS } });
const bad = (err = "badreq", s = 400) => J({ ok: false, err }, s);
const rnd = (n) => { const a = new Uint32Array(1); crypto.getRandomValues(a); return a[0] % n; };
const hex = (buf) => [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
const sha = async (s) => hex(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s)));
const rid = () => hex(crypto.getRandomValues(new Uint8Array(16)));
const dayKey = () => new Date(Date.now() + 5 * 3600e3).toISOString().slice(0, 10);
const normUser = (s) => { s = String(s || "").trim().replace(/^@/, "").toLowerCase(); return /^[a-z0-9_]{4,32}$/.test(s) ? s : ""; };
const money = (n) => String(n).replace(/\B(?=(\d{3})+(?!\d))/g, " ");
const ORDER_COLS = "id,username,type,item,sum,who,pay,status,created,err";
const newOrder = (o) => ({ id: rid().slice(0, 12), status: "pending", created: Date.now(), err: "", ...o });
const orderVals = (o) => [o.id, o.username, o.type, o.item, o.sum, o.who, o.pay, o.status, o.created, o.err];

// db = { query(sql, args) -> {rows,rowCount}, tx(fn(query)) }
export function makeApp({ db, html, env }) {
  const q = db.query;
  const first = async (sql, a) => (await q(sql, a)).rows[0] || null;
  const all = async (sql, a) => (await q(sql, a)).rows;
  const run = async (sql, a) => (await q(sql, a)).rowCount;
  const body = async (req) => { try { return (await req.json()) || {}; } catch (e) { return {}; } };
  const ipOf = (req) => (req.headers.get("cf-connecting-ip") || "?").slice(0, 60);

  let ready = null;
  const init = () => { if (!ready) ready = (async () => { for (const s of SCHEMA) await q(s); })().catch((e) => { ready = null; throw e; }); return ready; };

  /* ---------- config ---------- */
  let cfgCache = { t: 0, v: null };
  async function getCfg() {
    if (cfgCache.v && Date.now() - cfgCache.t < 3000) return cfgCache.v;
    const row = await first("SELECT v FROM kv WHERE k='cfg'");
    let c = {}; try { c = row ? JSON.parse(row.v) : {}; } catch (e) {}
    cfgCache = { t: Date.now(), v: clean(c) };
    return cfgCache.v;
  }
  async function setCfg(c) {
    const v = clean(c);
    await q("INSERT INTO kv(k,v) VALUES('cfg',$1) ON CONFLICT(k) DO UPDATE SET v=EXCLUDED.v", [JSON.stringify(v)]);
    cfgCache = { t: Date.now(), v };
    return v;
  }

  /* ---------- notifications & delivery ---------- */
  async function tg(text) {
    if (!env.BOT_TOKEN || !env.ADMIN_CHAT_ID) return;
    try { await fetch(`https://api.telegram.org/bot${env.BOT_TOKEN}/sendMessage`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ chat_id: env.ADMIN_CHAT_ID, text }) }); } catch (e) {}
  }
  async function deliver(o) {
    if (env.DELIVER_URL) {
      const r = await fetch(env.DELIVER_URL, { method: "POST", headers: { "Content-Type": "application/json", "X-Secret": env.SECRET || "" },
        body: JSON.stringify({ event: "order.approved", order: { id: o.id, item: o.item, sum: o.sum, recipient: o.who, payment: o.pay, buyer: o.username, type: o.type } }) });
      if (!r.ok) throw new Error("deliver " + r.status);
    }
  }

  /* ---------- rate limit ---------- */
  async function blocked(k, limit = 10) {
    const r = await first("SELECT n,ts FROM rl WHERE k=$1", [k]);
    return !!(r && r.n >= limit && Date.now() - r.ts < 600000);
  }
  async function fail(k) {
    await q("INSERT INTO rl(k,n,ts) VALUES($1,1,$2::bigint) ON CONFLICT(k) DO UPDATE SET n=CASE WHEN $2::bigint-rl.ts>600000 THEN 1 ELSE rl.n+1 END, ts=$2::bigint", [k, Date.now()]);
  }

  /* ---------- auth ---------- */
  async function authUser(req) {
    const h = req.headers.get("authorization") || "";
    const tok = h.startsWith("Bearer ") ? h.slice(7) : "";
    if (tok.length < 20) return null;
    return await first("SELECT u.* FROM sessions s JOIN users u ON u.username=s.username WHERE s.token=$1", [tok]);
  }
  async function adminCheck(req) {
    const exp = env.ADMIN_PASS;
    if (!exp) return "nopass";
    const ip = ipOf(req);
    if ((await blocked("adm:" + ip)) || (await blocked("adm:all", 40))) return "blocked";
    const given = req.headers.get("x-admin") || "";
    if ((await sha("a:" + given)) === (await sha("a:" + exp))) return "ok";
    await fail("adm:" + ip); await fail("adm:all");
    return "bad";
  }

  /* ---------- profile ---------- */
  async function meOf(u, cfg) {
    const now = Date.now(), day = dayKey();
    const row = await first("SELECT username,name,balance,ref_count FROM users WHERE username=$1", [u.username]);
    const ord = await all("SELECT id,type,item,sum,who,pay,status,created FROM orders WHERE username=$1 ORDER BY created DESC LIMIT 30", [u.username]);
    const pl = await all("SELECT game,n,last,paid FROM plays WHERE username=$1 AND day=$2", [u.username, day]);
    const rw = await first("SELECT COUNT(*) c FROM rewards WHERE username=$1", [u.username]);
    const inv = await first("SELECT COUNT(*) c FROM users WHERE ref_by=$1", [u.username]);
    const gi = await all("SELECT id,e,tier FROM inv WHERE owner=$1 ORDER BY tier DESC, created DESC LIMIT 100", [u.username]);
    const games = {}; let paidToday = 0;
    for (const id in cfg.games) {
      const g = cfg.games[id], r = pl.find((x) => x.game === id);
      games[id] = { left: Math.max(0, g.day - (r ? r.n : 0)), wait: r ? Math.max(0, Math.ceil((r.last + g.cd * 1000 - now) / 1000)) : 0 };
    }
    for (const r of pl) paidToday += r.paid || 0;
    const every = cfg.ref.every;
    return { username: row.username, name: row.name, balance: row.balance, invited: inv.c, counted: row.ref_count, every, toNext: every - (row.ref_count % every), rewards: rw.c,
      emoji: cfg.ref.emoji, mode: cfg.ref.mode, inv: invView(gi, cfg), upOn: cfg.upg.on, orders: ord, games, paidToday, cap: cfg.gameCap };
  }

  /* ---------- orders ---------- */
  const insertOrder = (o) => q(`INSERT INTO orders(${ORDER_COLS}) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`, orderVals(o));
  async function orderRoute(ctx, cfg, u, b) {
    if (cfg.maintenance) return bad("maint", 503);
    const kind = b.kind, method = String(b.method || "");
    let item, sum, who, type = "buy";
    if (kind === "premium") { const p = Number.isInteger(b.idx) ? cfg.premium[b.idx] : null; if (!p) return bad(); item = `Premium ${p.m}M`; sum = p.price; }
    else if (kind === "gift") { const g = Number.isInteger(b.idx) ? cfg.gifts[b.idx] : null; if (!g) return bad(); item = `Gift ${g.e}`; sum = g.price; }
    else if (kind === "stars") { const n = Math.floor(Number(b.qty)); if (!(n >= cfg.starMin && n <= 100000)) return bad(); item = `Stars ${n}`; sum = n * cfg.starPrice; }
    else if (kind === "topup") { const a = Math.floor(Number(b.amount)); if (!(a >= 1000 && a <= 50000000)) return bad("minTop"); item = "Top-up"; sum = a; type = "topup"; }
    else return bad();
    if (!(sum > 0)) return bad();
    if (type === "topup") who = "@" + u.username;
    else { const w = normUser(b.who); if (!w) return bad("baduser"); who = "@" + w; }
    if (!cfg.pay[method] || (type === "topup" && method === "balans")) return bad("badmethod");
    if (method !== "balans") { const r = cfg.req[method]; if (!r || !String(r.number).trim()) return bad("noreq"); }
    const o = newOrder({ username: u.username, type, item, sum, who, pay: method });
    if (method === "balans") {
      const n = await run(`WITH d AS (UPDATE users SET balance=balance-$1::bigint WHERE username=$2 AND balance>=$1::bigint RETURNING username)
        INSERT INTO orders(${ORDER_COLS}) SELECT $3::text,$4::text,$5::text,$6::text,$7::bigint,$8::text,$9::text,$10::text,$11::bigint,$12::text WHERE EXISTS(SELECT 1 FROM d)`,
        [sum, u.username, ...orderVals(o)]);
      if (!n) return bad("insufficient", 402);
    } else await insertOrder(o);
    ctx(tg(`🆕 Новый заказ\n${item} — ${money(sum)} so'm\nПолучатель: ${who}\nОплата: ${method}\nПокупатель: @${u.username}\nТип: ${type === "topup" ? "пополнение" : "покупка"}`));
    return J({ ok: true, me: await meOf(u, cfg) });
  }

  /* ---------- referrals ---------- */
  async function bumpRef(ctx, cfg, refUser) {
    const r = await first("UPDATE users SET ref_count=ref_count+1 WHERE username=$1 RETURNING ref_count c", [refUser]);
    if (!r || r.c % cfg.ref.every !== 0) return;
    const idx = r.c / cfg.ref.every;
    const n = await run("INSERT INTO rewards(username,idx) VALUES($1,$2) ON CONFLICT DO NOTHING", [refUser, idx]);
    if (!n) return;
    const o = newOrder({ username: refUser, type: "reward", item: `Gift ${cfg.ref.emoji} (ref)`, sum: 0, who: "@" + refUser, pay: "bonus" });
    await insertOrder(o);
    ctx(tg(`🎁 Реферальная награда\n${o.item} → ${o.who}\nДрузей приглашено: ${r.c}`));
  }

  /* ---------- admin order actions ---------- */
  const addInv = (owner, item) => { const g = giftOf(item); return g ? q("INSERT INTO inv(id,owner,e,tier,created) VALUES($1,$2,$3,$4,$5)", [rid().slice(0, 12), owner, g.e, g.tier, Date.now()]) : null; };
  async function invRoute(cfg, u, p, b) {
    const id = String(b.id || "");
    const it = await first("SELECT * FROM inv WHERE id=$1 AND owner=$2", [id, u.username]);
    if (!it) return bad("noitem", 404);
    if (p === "/api/inv/upgrade") {
      if (!cfg.upg.on) return bad("off");
      if (it.tier >= UPG.tiers.length - 1) return bad("maxtier");
      if (!(await run("DELETE FROM inv WHERE id=$1 AND owner=$2", [id, u.username]))) return bad("noitem", 404);
      const win = rnd(100) < cfg.upg.chances[it.tier], nt = it.tier + 1;
      if (win) await q("INSERT INTO inv(id,owner,e,tier,created) VALUES($1,$2,$3,$4,$5)", [id, u.username, UPG.tiers[nt], nt, it.created]);
      return J({ ok: true, win, from: it.e, to: win ? UPG.tiers[nt] : "", me: await meOf(u, cfg) });
    }
    if (p === "/api/inv/transfer") {
      const to = normUser(b.to); if (!to || to === u.username) return bad("baduser");
      if (!(await first("SELECT username FROM users WHERE username=$1", [to]))) return bad("nouser", 404);
      if (!(await run("UPDATE inv SET owner=$1 WHERE id=$2 AND owner=$3", [to, id, u.username]))) return bad("noitem", 404);
      return J({ ok: true, me: await meOf(u, cfg) });
    }
    if (p === "/api/inv/withdraw") {
      if (!(await run("DELETE FROM inv WHERE id=$1 AND owner=$2", [id, u.username]))) return bad("noitem", 404);
      await insertOrder(newOrder({ username: u.username, type: "withdraw", item: "🎁 Gift " + it.e, sum: 0, who: "@" + u.username, pay: "inv" }));
      return J({ ok: true, me: await meOf(u, cfg) });
    }
    return bad("notfound", 404);
  }
  async function approve(ctx, cfg, id) {
    const o = await first("SELECT * FROM orders WHERE id=$1", [id]);
    if (!o) return bad("notfound", 404);
    if (!(await run("UPDATE orders SET status='processing', err='' WHERE id=$1 AND status='pending'", [id]))) return bad("state", 409);
    try {
      if (o.type === "topup") {
        await db.tx(async (t) => { await t("UPDATE users SET balance=balance+$1 WHERE username=$2", [o.sum, o.username]); await t("UPDATE orders SET status='done' WHERE id=$1", [id]); });
      } else { await deliver(o); await q("UPDATE orders SET status='done' WHERE id=$1", [id]); if (o.type === "buy" || o.type === "reward") await addInv(o.username, o.item); }
    } catch (e) {
      await q("UPDATE orders SET status='pending', err=$1 WHERE id=$2", [String(e.message || e).slice(0, 200), id]);
      return bad("deliver", 502);
    }
    if (o.type !== "reward" && o.sum > 0 && cfg.ref.mode === "first_order") {
      const u = await first("SELECT ref_by FROM users WHERE username=$1", [o.username]);
      if (u && u.ref_by && (await run("UPDATE users SET ref_counted=1 WHERE username=$1 AND ref_counted=0", [o.username]))) await bumpRef(ctx, cfg, u.ref_by);
    }
    return J({ ok: true });
  }
  async function reject(id) {
    const o = await first("SELECT * FROM orders WHERE id=$1", [id]);
    if (!o) return bad("notfound", 404);
    if (!(await run("UPDATE orders SET status='canceled' WHERE id=$1 AND status='pending'", [id]))) return bad("state", 409);
    if (o.type !== "topup" && o.pay === "balans" && o.sum > 0) await q("UPDATE users SET balance=balance+$1 WHERE username=$2", [o.sum, o.username]);
    if (o.type === "withdraw") await addInv(o.username, o.item);
    return J({ ok: true });
  }

  /* ---------- games ---------- */
  async function claimPlay(u, cfg, id) {
    const g = cfg.games[id];
    if (!g || !g.on) return { err: "off" };
    if (g.day <= 0) return { err: "limit" };
    const day = dayKey(), now = Date.now();
    const row = await first("SELECT n,last FROM plays WHERE username=$1 AND game=$2 AND day=$3", [u.username, id, day]);
    if (row && now < row.last + g.cd * 1000) return { err: "cooldown", wait: Math.ceil((row.last + g.cd * 1000 - now) / 1000) };
    const n = await run("INSERT INTO plays(username,game,day,n,last,paid) VALUES($1,$2,$3,1,$4::bigint,0) ON CONFLICT(username,game,day) DO UPDATE SET n=plays.n+1, last=EXCLUDED.last WHERE plays.n<$5", [u.username, id, day, now, g.day]);
    return n ? { ok: true } : { err: "limit" };
  }
  function pickAmount(g) {
    const step = g.max > 100 ? 50 : 10, lo = Math.ceil(g.min / step), hi = Math.floor(g.max / step);
    return hi < lo ? g.min : (lo + rnd(hi - lo + 1)) * step;
  }
  async function payout(u, cfg, id) {
    const day = dayKey(), g = cfg.games[id];
    const t = await first("SELECT COALESCE(SUM(paid),0)::bigint s FROM plays WHERE username=$1 AND day=$2", [u.username, day]);
    const left = cfg.gameCap - Number(t.s);
    if (left < g.min || left <= 0) return 0;
    const amt = Math.min(pickAmount(g), left);
    await db.tx(async (x) => {
      await x("UPDATE users SET balance=balance+$1 WHERE username=$2", [amt, u.username]);
      await x("UPDATE plays SET paid=paid+$1 WHERE username=$2 AND game=$3 AND day=$4", [amt, u.username, id, day]);
    });
    return amt;
  }
  async function gameRoute(cfg, u, p, b) {
    const id = String(b.game || "");
    if (!cfg.games[id]) return bad();
    if (cfg.maintenance) return bad("maint", 503);
    if (p === "/api/game/play") {
      if (SKILL[id]) return bad();
      const c = await claimPlay(u, cfg, id);
      if (!c.ok) return J({ ok: false, err: c.err, wait: c.wait }, 429);
      const win = rnd(100) < cfg.games[id].win;
      const amount = win ? await payout(u, cfg, id) : 0;
      const res = { ok: true, win: amount > 0, amount, reason: win && !amount ? "cap" : "" };
      if (id === "boxes") { const pick = Math.min(2, Math.max(0, b.pick | 0)); res.box = res.win ? pick : (pick + 1 + rnd(2)) % 3; }
      if (id === "flip") { const pick = b.pick ? 1 : 0; res.side = res.win ? pick : 1 - pick; }
      res.me = await meOf(u, cfg);
      return J(res);
    }
    if (p === "/api/game/start") {
      if (!SKILL[id]) return bad();
      const c = await claimPlay(u, cfg, id);
      if (!c.ok) return J({ ok: false, err: c.err, wait: c.wait }, 429);
      await q("INSERT INTO gstate(username,game,ts) VALUES($1,$2,$3::bigint) ON CONFLICT(username) DO UPDATE SET game=EXCLUDED.game, ts=EXCLUDED.ts", [u.username, id, Date.now()]);
      return J({ ok: true, target: TAP.target, seconds: TAP.seconds, me: await meOf(u, cfg) });
    }
    if (p === "/api/game/finish") {
      if (!SKILL[id]) return bad();
      const st = await first("SELECT game,ts FROM gstate WHERE username=$1", [u.username]);
      const del = await run("DELETE FROM gstate WHERE username=$1 AND game=$2", [u.username, id]);
      if (!st || st.game !== id || !del) return bad("nostart");
      const el = Date.now() - st.ts;
      let ok = false;
      if (id === "tap") ok = (b.score | 0) >= TAP.target && el >= TAP.minMs && el <= TAP.maxMs + 5000;
      if (id === "memory") ok = el >= MEMORY.minMs && el <= MEMORY.maxMs;
      const amount = ok ? await payout(u, cfg, id) : 0;
      return J({ ok: true, win: amount > 0, amount, reason: ok && !amount ? "cap" : ok ? "" : "time", me: await meOf(u, cfg) });
    }
    return bad();
  }

  /* ---------- auth route ---------- */
  async function authRoute(ctx, cfg, req) {
    const b = await body(req), ip = ipOf(req);
    const un = normUser(b.username), name = String(b.name || "").trim().slice(0, 40), pw = String(b.password || "");
    if (!un) return bad("baduser");
    if (pw.length < 4 || pw.length > 64) return bad("badpass");
    if (await blocked("login:" + ip)) return bad("toomany", 429);
    let u = await first("SELECT * FROM users WHERE username=$1", [un]);
    if (u) {
      if ((await sha(u.salt + ":" + pw)) !== u.hash) { await fail("login:" + ip); return bad("wrongpass", 401); }
    } else {
      if (name.length < 2) return bad("badname");
      if (cfg.regPerIp > 0) {
        const c = await first("SELECT COUNT(*) c FROM users WHERE ip=$1 AND created>$2", [ip, Date.now() - 864e5]);
        if (c.c >= cfg.regPerIp) return bad("iplimit", 429);
      }
      const salt = rid();
      let refBy = normUser(b.ref);
      if (refBy === un) refBy = "";
      if (refBy && !(await first("SELECT username FROM users WHERE username=$1", [refBy]))) refBy = "";
      await q("INSERT INTO users(username,name,salt,hash,balance,ref_by,ref_count,ref_counted,created,ip) VALUES($1,$2,$3,$4,0,$5,0,0,$6,$7)", [un, name, salt, await sha(salt + ":" + pw), refBy || null, Date.now(), ip]);
      if (refBy && cfg.ref.mode === "register") { await q("UPDATE users SET ref_counted=1 WHERE username=$1", [un]); await bumpRef(ctx, cfg, refBy); }
      u = await first("SELECT * FROM users WHERE username=$1", [un]);
    }
    const tok = rid() + rid();
    await q("INSERT INTO sessions(token,username,created) VALUES($1,$2,$3)", [tok, un, Date.now()]);
    await q("DELETE FROM sessions WHERE created<$1", [Date.now() - 90 * 864e5]);
    return J({ ok: true, token: tok, me: await meOf(u, cfg) });
  }

  /* ---------- router ---------- */
  return async function handle(req, ctx = (p) => p.catch(() => {})) {
    const url = new URL(req.url), p = url.pathname;
    try {
      if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS });
      if (p === "/" || p === "/index.html") return new Response(html, { headers: { "Content-Type": "text/html;charset=utf-8", "Cache-Control": "no-cache" } });
      if (p === "/healthz") return new Response("ok");
      if (!p.startsWith("/api/")) return new Response("Not found", { status: 404 });
      await init();
      const cfg = await getCfg();

      if (p === "/api/sync") { const u = await authUser(req); return J({ ok: true, cfg, me: u ? await meOf(u, cfg) : null }); }
      if (req.method !== "POST" && !p.startsWith("/api/admin/")) return bad("badreq", 405);
      if (p === "/api/auth") return await authRoute(ctx, cfg, req);

      if (p.startsWith("/api/admin/")) {
        const a = await adminCheck(req);
        if (a === "nopass") return bad("nopass", 500);
        if (a === "blocked") return bad("toomany", 429);
        if (a !== "ok") return bad("forbidden", 403);
        if (p === "/api/admin/login") return J({ ok: true });
        if (p === "/api/admin/orders") return J({ ok: true, orders: await all(`SELECT ${ORDER_COLS} FROM orders ORDER BY CASE status WHEN 'pending' THEN 0 WHEN 'processing' THEN 1 ELSE 2 END, created DESC LIMIT 100`) });
        if (p === "/api/admin/users") return J({ ok: true, users: await all("SELECT username,name,balance,ref_count,ref_by,created FROM users ORDER BY created DESC LIMIT 200") });
        const b = await body(req);
        if (p === "/api/admin/order") {
          const id = String(b.id || "");
          if (b.action === "approve") return await approve(ctx, cfg, id);
          if (b.action === "reject") return await reject(id);
          return bad();
        }
        if (p === "/api/admin/config") return J({ ok: true, cfg: await setCfg(b.reset ? {} : b.cfg) });
        if (p === "/api/admin/grant") {
          const un = normUser(b.username);
          const usr = un && await first("SELECT username FROM users WHERE username=$1", [un]);
          if (!usr) return bad("nouser", 404);
          if (b.kind === "balance") {
            const d = Math.trunc(Number(b.amount));
            if (!d || Math.abs(d) > 1e9) return bad();
            await q("UPDATE users SET balance=GREATEST(0,balance+$1) WHERE username=$2", [d, un]);
            return J({ ok: true });
          }
          const item = String(b.item || "").trim().slice(0, 80);
          if (!item) return bad();
          const o = newOrder({ username: un, type: "reward", item: "🎁 " + item, sum: 0, who: "@" + un, pay: "admin" });
          await insertOrder(o);
          return await approve(ctx, cfg, o.id);
        }
        if (p === "/api/admin/balance") {
          const un = normUser(b.username), v = Math.floor(Number(b.balance));
          if (!un || !(v >= 0 && v <= 1e10)) return bad();
          await q("UPDATE users SET balance=$1 WHERE username=$2", [v, un]);
          return J({ ok: true });
        }
        return bad("notfound", 404);
      }

      const u = await authUser(req);
      if (!u) return bad("auth", 401);
      const b = await body(req);
      if (p === "/api/order") return await orderRoute(ctx, cfg, u, b);
      if (p.startsWith("/api/inv/")) return await invRoute(cfg, u, p, b);
      if (p.startsWith("/api/game/")) return await gameRoute(cfg, u, p, b);
      if (p === "/api/logout") { await q("DELETE FROM sessions WHERE token=$1", [(req.headers.get("authorization") || "").slice(7)]); return J({ ok: true }); }
      return bad("notfound", 404);
    } catch (e) {
      console.error("API error:", e);
      return J({ ok: false, err: "server", msg: String((e && e.message) || e).slice(0, 200) }, 500);
    }
  };
}

/* ---------------- запуск (Render / Railway / локально) ---------------- */
async function start() {
  if (!process.env.DATABASE_URL) { console.error("Не задана переменная DATABASE_URL"); process.exit(1); }
  const pg = (await import("pg")).default;
  pg.types.setTypeParser(20, (v) => parseInt(v, 10));
  pg.types.setTypeParser(1700, (v) => parseFloat(v));
  let url = process.env.DATABASE_URL;
  try { const u = new URL(url); u.searchParams.delete("channel_binding"); url = u.toString(); } catch (e) {}
  const local = /localhost|127\.0\.0\.1/.test(url);
  const pool = new pg.Pool({ connectionString: url, ssl: local ? false : { rejectUnauthorized: false }, max: 5 });
  pool.on("error", (e) => console.error("pg pool error", e.message));
  const wrap = (c) => async (sql, a) => { const r = await c.query(sql, a); return { rows: r.rows, rowCount: r.rowCount }; };
  const db = {
    query: wrap(pool),
    tx: async (fn) => { const c = await pool.connect(); try { await c.query("BEGIN"); const r = await fn(wrap(c)); await c.query("COMMIT"); return r; } catch (e) { try { await c.query("ROLLBACK"); } catch (x) {} throw e; } finally { c.release(); } },
  };
  const dir = path.dirname(fileURLToPath(import.meta.url));
  const html = fs.readFileSync(path.join(dir, "index.html"), "utf8");
  const app = makeApp({ db, html, env: process.env });
  if (!process.env.ADMIN_PASS) console.warn("ВНИМАНИЕ: ADMIN_PASS не задан — админ-панель будет недоступна");
  http.createServer(async (req, res) => {
    try {
      const chunks = []; let size = 0;
      for await (const c of req) { size += c.length; if (size > 1e6) { res.writeHead(413); return res.end(); } chunks.push(c); }
      const headers = new Headers();
      for (const [k, v] of Object.entries(req.headers)) if (typeof v === "string") headers.set(k, v);
      headers.set("cf-connecting-ip", ((req.headers["x-forwarded-for"] || "").split(",")[0].trim() || req.socket.remoteAddress || "?"));
      const r = await app(new Request("http://localhost" + req.url, { method: req.method, headers, body: ["GET", "HEAD"].includes(req.method) ? undefined : Buffer.concat(chunks) }));
      res.writeHead(r.status, Object.fromEntries(r.headers));
      res.end(Buffer.from(await r.arrayBuffer()));
    } catch (e) { console.error(e); res.writeHead(500); res.end("error"); }
  }).listen(process.env.PORT || 3000, () => console.log("UzPay запущен на порту " + (process.env.PORT || 3000)));
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) start();
