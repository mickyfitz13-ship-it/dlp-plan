const fs = require("fs");
const code = fs.readFileSync("index.html", "utf8").match(/<script type="text\/babel">([\s\S]*?)<\/script>/)[1];
const HOURLY_SHAPE = eval(code.match(/const HOURLY_SHAPE = (\[[^\]]*\]);/)[1]);
const RIDE_STATS = eval("(" + code.match(/const RIDE_STATS = (\{[\s\S]*?\n        \});/)[1] + ")");
const normName = (s) => (s || "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9]+/g, " ").trim();
const IDX = {};
Object.keys(RIDE_STATS).forEach(pid => { IDX[pid] = Object.keys(RIDE_STATS[pid].r).map(k => ({ _n: k, _t: k.split(" ").filter(t => t.length > 2), v: RIDE_STATS[pid].r[k] })); });
const rideStat = (pid, name) => {
  const list = IDX[pid]; const q = normName(name); if (!list || !q) return null;
  let hit = list.find(g => g._n === q);
  if (!hit) hit = list.find(g => (q.includes(g._n) || g._n.includes(q)) && Math.min(q.length, g._n.length) >= 5);
  if (!hit) { const qt = new Set(q.split(" ").filter(t => t.length > 2)); let best = null, bestC = 0; list.forEach(g => { const c = g._t.filter(t => qt.has(t)).length; if (c > bestC) { bestC = c; best = g; } }); hit = bestC >= 2 ? best : null; }
  return hit ? { avg: hit.v[0], max: hit.v[1] } : null;
};
const statCurve = (pid, name) => { const s = rideStat(pid, name); if (!s) return null; const c = new Array(24).fill(null); for (let h = 7; h < 24; h++) c[h] = Math.min(s.max, Math.max(0, Math.round(s.avg * HOURLY_SHAPE[h]))); return c; };
const crowdDowFactor = (pid, dow) => { const st = RIDE_STATS[pid]; if (!st || !st.d) return 1; const mean = st.d.reduce((a, b) => a + b, 0) / st.d.length; return mean > 0 ? st.d[dow] / mean : 1; };

console.log("parks loaded:", Object.keys(RIDE_STATS).length, "| HOURLY_SHAPE len:", HOURLY_SHAPE.length);
const tests = [[4, "Big Thunder Mountain"], [4, "Peter Pan’s Flight"], [4, "it's a small world"], [4, "Indiana Jones™ and the Temple of Peril"], [4, "Blanche-Neige et les Sept Nains®"], [28, "Crush's Coaster"], [28, "Ratatouille : L’Aventure Totalement Toquée de Rémy"], [6, "Seven Dwarfs Mine Train"], [8, "Avatar Flight of Passage"], [275, "Tower of Terror"], [4, "Totally Made Up Ride"]];
console.log("\n--- name matching (last is intentionally unknown) ---");
let matched = 0;
for (const [pid, nm] of tests) { const s = rideStat(pid, nm); if (s) matched++; console.log("  p" + pid + " " + nm.slice(0, 40).padEnd(40) + " -> " + (s ? JSON.stringify(s) : "NO MATCH")); }
console.log("matched " + matched + "/" + (tests.length - 1) + " real names");

const c = statCurve(4, "Big Thunder Mountain");
console.log("\n--- statCurve Big Thunder (avg44/max71) ---");
console.log("  09h:" + c[9] + " 13h:" + c[13] + " 17h:" + c[17] + " 20h:" + c[20] + " | max in curve:" + Math.max(...c.filter(x => x != null)) + " (cap 71 ok:" + (Math.max(...c.filter(x => x != null)) <= 71) + ")");

console.log("\n--- anchor-on-live / follow-shape ---");
const histNow = c[13], histFut = c[20];
const calib = Math.max(0.5, Math.min(2, 60 / histNow));
const pred = Math.round(histFut * calib);
console.log("  live 60m at 13h peak; hist13h=" + histNow + " hist20h=" + histFut + " calib=" + calib.toFixed(2) + " -> predicted 20h = " + pred + "m (expect < 60, queue eases by evening)");

console.log("\n--- crowdDowFactor park 4 (Sat = busiest) ---");
const days = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
console.log("  " + days.map((d, i) => d + ":" + crowdDowFactor(4, i).toFixed(2)).join(" "));
const f = days.map((d, i) => crowdDowFactor(4, i));
console.log("  quietest weekday:", days[f.indexOf(Math.min(...f))], "| busiest:", days[f.indexOf(Math.max(...f))]);
