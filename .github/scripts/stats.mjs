// Generates self-hosted GitHub stats SVGs (no third-party services).
// Usage: GITHUB_TOKEN=... node .github/scripts/stats.mjs <login> <outDir>
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const login = process.argv[2] || 'Nethrapalmjali';
const outDir = process.argv[3] || 'dist';
const token = process.env.GITHUB_TOKEN;
if (!token) { console.error('GITHUB_TOKEN is required'); process.exit(1); }

const query = `query($login:String!){
  user(login:$login){
    name
    followers{ totalCount }
    repositories(ownerAffiliations:OWNER, isFork:false, privacy:PUBLIC, first:100){
      totalCount
      nodes{
        stargazerCount
        languages(first:10, orderBy:{field:SIZE, direction:DESC}){ edges{ size node{ name color } } }
      }
    }
    contributionsCollection{
      totalCommitContributions
      totalPullRequestContributions
      totalIssueContributions
      restrictedContributionsCount
      contributionCalendar{ totalContributions weeks{ contributionDays{ contributionCount date } } }
    }
  }
}`;

const res = await fetch('https://api.github.com/graphql', {
  method: 'POST',
  headers: { Authorization: `bearer ${token}`, 'Content-Type': 'application/json', 'User-Agent': 'profile-stats' },
  body: JSON.stringify({ query, variables: { login } }),
});
const json = await res.json();
if (!res.ok || json.errors) { console.error(JSON.stringify(json.errors || json)); process.exit(1); }
const u = json.data.user;

const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const fmt = n => n >= 1000 ? (n / 1000).toFixed(1).replace(/\.0$/, '') + 'k' : String(n);

// ---- current streak (days with >=1 contribution, allowing today to be empty) ----
const days = u.contributionsCollection.contributionCalendar.weeks.flatMap(w => w.contributionDays);
let streak = 0;
for (let i = days.length - 1; i >= 0; i--) {
  if (days[i].contributionCount > 0) streak++;
  else if (i === days.length - 1) continue;
  else break;
}

const stars = u.repositories.nodes.reduce((a, r) => a + r.stargazerCount, 0);
const cc = u.contributionsCollection;
const items = [
  ['Contributions (last year)', cc.contributionCalendar.totalContributions],
  ['Commits (last year)', cc.totalCommitContributions],
  ['Current streak (days)', streak],
  ['Pull requests', cc.totalPullRequestContributions],
  ['Public repositories', u.repositories.totalCount],
  ['Stars earned', stars],
];

const W = 440, H = 200;
const bg = '#0F172A', title = '#38BDF8', text = '#CBD5E1', muted = '#64748B';
const rows = items.map(([k, v], i) => {
  const y = 64 + i * 22;
  return `<circle cx="28" cy="${y - 4}" r="3" fill="${title}"/>` +
    `<text x="40" y="${y}" fill="${text}" font-size="13">${esc(k)}</text>` +
    `<text x="${W - 26}" y="${y}" fill="#FFFFFF" font-size="13" font-weight="700" text-anchor="end">${esc(fmt(v))}</text>`;
}).join('');
const statsSvg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" font-family="Segoe UI,Ubuntu,Helvetica,Arial,sans-serif" role="img" aria-label="GitHub stats">
<rect x="0.5" y="0.5" width="${W - 1}" height="${H - 1}" rx="10" fill="${bg}" stroke="#1E293B"/>
<text x="24" y="34" fill="${title}" font-size="17" font-weight="700">${esc(u.name || login)}'s GitHub Stats</text>
${rows}
</svg>`;

// ---- top languages by bytes across public repos ----
const langs = new Map();
for (const r of u.repositories.nodes) for (const e of r.languages.edges) {
  const cur = langs.get(e.node.name) || { size: 0, color: e.node.color || '#94A3B8' };
  cur.size += e.size; langs.set(e.node.name, cur);
}
const top = [...langs.entries()].sort((a, b) => b[1].size - a[1].size).slice(0, 6);
const total = top.reduce((a, [, v]) => a + v.size, 0) || 1;
let x = 24; const barW = W - 48;
const bar = top.map(([, v]) => { const w = (v.size / total) * barW; const r = `<rect x="${x.toFixed(2)}" y="52" width="${w.toFixed(2)}" height="10" fill="${v.color}"/>`; x += w; return r; }).join('');
const legend = top.map(([name, v], i) => {
  const col = i % 2, row = Math.floor(i / 2);
  const lx = 24 + col * 200, ly = 92 + row * 26;
  return `<circle cx="${lx + 5}" cy="${ly - 4}" r="5" fill="${v.color}"/>` +
    `<text x="${lx + 16}" y="${ly}" fill="${text}" font-size="13">${esc(name)} <tspan fill="${muted}">${(v.size / total * 100).toFixed(1)}%</tspan></text>`;
}).join('');
const langSvg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" font-family="Segoe UI,Ubuntu,Helvetica,Arial,sans-serif" role="img" aria-label="Top languages">
<rect x="0.5" y="0.5" width="${W - 1}" height="${H - 1}" rx="10" fill="${bg}" stroke="#1E293B"/>
<text x="24" y="34" fill="${title}" font-size="17" font-weight="700">Most Used Languages</text>
<clipPath id="c"><rect x="24" y="52" width="${barW}" height="10" rx="5"/></clipPath>
<g clip-path="url(#c)">${bar}</g>
${legend}
</svg>`;

mkdirSync(outDir, { recursive: true });
writeFileSync(join(outDir, 'stats.svg'), statsSvg);
writeFileSync(join(outDir, 'top-langs.svg'), langSvg);
console.log('Wrote stats.svg and top-langs.svg', { streak, stars, langs: top.map(t => t[0]) });
