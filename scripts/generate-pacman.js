const https = require("https");
const fs = require("fs");
const path = require("path");

const USERNAME = process.env.USERNAME || "sxddhxrthg";
const TOKEN = process.env.GITHUB_TOKEN;
const OUTPUT_FILE = process.env.OUTPUT_FILE || "pacman-dark.svg";

// ─── Fetch contribution data via GitHub GraphQL ───────────────────────────────
function fetchContributions() {
  return new Promise((resolve, reject) => {
    const query = JSON.stringify({
      query: `query {
        user(login: "${USERNAME}") {
          contributionsCollection {
            contributionCalendar {
              weeks {
                contributionDays {
                  contributionCount
                  date
                }
              }
            }
          }
        }
      }`
    });

    const options = {
      hostname: "api.github.com",
      path: "/graphql",
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `bearer ${TOKEN}`,
        "User-Agent": "pacman-generator"
      }
    };

    const req = https.request(options, (res) => {
      let data = "";
      res.on("data", (chunk) => data += chunk);
      res.on("end", () => {
        try {
          const parsed = JSON.parse(data);
          const weeks = parsed.data.user.contributionsCollection.contributionCalendar.weeks;
          resolve(weeks);
        } catch (e) {
          reject(new Error("Failed to parse GitHub API response: " + data));
        }
      });
    });
    req.on("error", reject);
    req.write(query);
    req.end();
  });
}

// ─── Build grid from weeks ────────────────────────────────────────────────────
function buildGrid(weeks) {
  // grid[col][row], col=0..51, row=0..6 (Mon=0..Sun=6)
  const grid = [];
  for (const week of weeks) {
    const col = [];
    for (const day of week.contributionDays) {
      col.push(day.contributionCount);
    }
    // pad to 7 if needed
    while (col.length < 7) col.push(0);
    grid.push(col);
  }
  return grid;
}

// ─── Map count → level 0-4 ───────────────────────────────────────────────────
function toLevel(count) {
  if (count === 0) return 0;
  if (count <= 2) return 1;
  if (count <= 5) return 2;
  if (count <= 9) return 3;
  return 4;
}

// ─── Build Pac-Man path: snake across grid row by row ────────────────────────
function buildPath(grid) {
  const path = [];
  const COLS = grid.length;
  for (let row = 0; row < 7; row++) {
    if (row % 2 === 0) {
      for (let col = 0; col < COLS; col++) path.push({ col, row });
    } else {
      for (let col = COLS - 1; col >= 0; col--) path.push({ col, row });
    }
  }
  return path;
}

// ─── SVG constants ────────────────────────────────────────────────────────────
const CELL = 13;       // cell size
const GAP  = 2;        // gap between cells
const STEP = CELL + GAP;
const COLS_MAX = 53;
const ROWS = 7;
const PAD_X = 20;
const PAD_Y = 30;
const W = PAD_X * 2 + COLS_MAX * STEP;
const H = PAD_Y * 2 + ROWS * STEP + 30;
const PACMAN_R = 7;
const PELLET_R = 2.5;
const GHOST_W = 13;
const GHOST_H = 14;

const COLORS = {
  bg:     "#0d1117",
  level0: "#161b22",
  level1: "#0e4429",
  level2: "#006d32",
  level3: "#26a641",
  level4: "#39d353",
  pacman: "#FFD700",
  ghost1: "#FF0000",  // Blinky
  ghost2: "#FFB8FF",  // Pinky
  ghost3: "#00FFFF",  // Inky
  ghost4: "#FFB852",  // Clyde
  pellet: "#39d353",
  text:   "#8b949e",
};

function levelColor(l) {
  return [COLORS.level0, COLORS.level1, COLORS.level2, COLORS.level3, COLORS.level4][l];
}

// ─── Cell pixel position ──────────────────────────────────────────────────────
function cellX(col) { return PAD_X + col * STEP; }
function cellY(row) { return PAD_Y + row * STEP; }
function cellCX(col) { return cellX(col) + CELL / 2; }
function cellCY(row) { return cellY(row) + CELL / 2; }

// ─── Ghost SVG path at position ───────────────────────────────────────────────
function ghostPath(cx, cy, color, id, delay, pathPoints) {
  const gw = GHOST_W, gh = GHOST_H;
  const x = cx - gw / 2, y = cy - gh / 2;
  // Ghost shape: rounded top, wavy bottom
  const shape = `M${x + gw/2},${y} 
    a${gw/2},${gw/2} 0 0,1 ${gw},0 
    l0,${gh * 0.65}
    q-${gw/6},${gh*0.2} -${gw/3},0
    q-${gw/6},-${gh*0.2} -${gw/3},0
    q-${gw/6},${gh*0.2} -${gw/3},0
    z`;

  // Build keyTimes and keySplines for smooth movement along path
  const n = pathPoints.length;
  const keyTimes = pathPoints.map((_, i) => (i / (n - 1)).toFixed(3)).join(";");
  const xVals = pathPoints.map(p => cellCX(p.col).toFixed(1)).join(";");
  const yVals = pathPoints.map(p => cellCY(p.row).toFixed(1)).join(";");

  const dur = (n * 0.12).toFixed(1) + "s";

  return `
  <g id="ghost-${id}" opacity="0.92">
    <path d="${shape}" fill="${color}" />
    <!-- eyes -->
    <circle cx="${x + gw*0.3}" cy="${y + gh*0.35}" r="2" fill="white"/>
    <circle cx="${x + gw*0.7}" cy="${y + gh*0.35}" r="2" fill="white"/>
    <circle cx="${x + gw*0.3 + 0.5}" cy="${y + gh*0.35 + 0.5}" r="1" fill="#00f"/>
    <circle cx="${x + gw*0.7 + 0.5}" cy="${y + gh*0.35 + 0.5}" r="1" fill="#00f"/>
    <animateMotion dur="${dur}" repeatCount="indefinite" begin="${delay}s" calcMode="linear">
      <mpath href="#pacman-path-${id}"/>
    </animateMotion>
  </g>
  <path id="pacman-path-${id}" d="M${pathPoints.map(p => `${cellCX(p.col).toFixed(1)},${cellCY(p.row).toFixed(1)}`).join(" L")}" fill="none" stroke="none"/>`;
}

// ─── Main SVG generator ───────────────────────────────────────────────────────
function generateSVG(grid) {
  const COLS = grid.length;
  const path = buildPath(grid);
  const n = path.length;
  const dur = (n * 0.12).toFixed(1);

  // ── Pellets (contribution squares as circles) ──
  let pellets = "";
  let pelletAnims = "";
  
  for (let col = 0; col < COLS; col++) {
    for (let row = 0; row < 7; row++) {
      const level = toLevel(grid[col][row]);
      const cx = cellCX(col);
      const cy = cellCY(row);
      const pid = `p${col}_${row}`;
      
      // Find when pacman reaches this cell
      const pathIdx = path.findIndex(p => p.col === col && p.row === row);
      const eatTime = pathIdx >= 0 ? (pathIdx / (n - 1)) : -1;
      
      if (level === 0) {
        // Empty cell - just dim square
        pellets += `<rect x="${cellX(col)}" y="${cellY(row)}" width="${CELL}" height="${CELL}" rx="2" fill="${COLORS.level0}" opacity="0.5"/>`;
      } else {
        // Active pellet - circle that gets eaten
        const r = level >= 3 ? PELLET_R + 1 : PELLET_R;
        pellets += `<circle id="${pid}" cx="${cx}" cy="${cy}" r="${r}" fill="${levelColor(level)}"/>`;
        
        if (eatTime >= 0) {
          const t0 = Math.max(0, eatTime - 0.01).toFixed(3);
          const t1 = Math.min(1, eatTime + 0.005).toFixed(3);
          // Animate opacity: visible → eaten (disappear)
          pelletAnims += `
  <animate href="#${pid}" attributeName="opacity" 
    values="1;1;0;0" 
    keyTimes="0;${t0};${t1};1"
    dur="${dur}s" repeatCount="indefinite" begin="0s"/>
  <animate href="#${pid}" attributeName="r"
    values="${r};${r};0;0"
    keyTimes="0;${t0};${t1};1"
    dur="${dur}s" repeatCount="indefinite" begin="0s"/>`;
        }
      }
    }
  }

  // ── Pac-Man mouth animation keyframes ──
  const mouthFrames = [];
  const mouthTimes = [];
  const xFrames = [];
  const yFrames = [];
  
  for (let i = 0; i < n; i++) {
    const t = i / (n - 1);
    const p = path[i];
    const cx = cellCX(p.col);
    const cy = cellCY(p.row);
    // Determine direction
    let dx = 0, dy = 0;
    if (i < n - 1) {
      dx = path[i+1].col - p.col;
      dy = path[i+1].row - p.row;
    } else if (i > 0) {
      dx = p.col - path[i-1].col;
      dy = p.row - path[i-1].row;
    }
    // Angle of movement
    const angle = Math.atan2(dy, dx) * 180 / Math.PI;
    // Chomp: alternate open/closed
    const chomp = (i % 2 === 0) ? 40 : 5;
    // Pac-Man as arc path
    const rad = PACMAN_R;
    const mouthOpen = chomp * Math.PI / 180;
    const x1 = cx + rad * Math.cos(mouthOpen);
    const y1 = cy + rad * Math.sin(mouthOpen);
    const x2 = cx + rad * Math.cos(-mouthOpen);
    const y2 = cy - rad * Math.sin(mouthOpen);
    const d = `M${cx},${cy} L${x1.toFixed(2)},${y1.toFixed(2)} A${rad},${rad} 0 1,0 ${x2.toFixed(2)},${y2.toFixed(2)} Z`;
    mouthFrames.push(d);
    mouthTimes.push(t.toFixed(3));
    xFrames.push(cx.toFixed(1));
    yFrames.push(cy.toFixed(1));
  }

  const pacmanPath = path.map(p => `${cellCX(p.col).toFixed(1)},${cellCY(p.row).toFixed(1)}`).join(" L");

  // Ghost paths (offset behind pacman)
  const ghostColors = [COLORS.ghost1, COLORS.ghost2, COLORS.ghost3, COLORS.ghost4];
  const ghostDelays = [0.8, 1.6, 2.4, 3.2];
  let ghostsSVG = "";
  for (let g = 0; g < 4; g++) {
    ghostsSVG += ghostPath(
      cellCX(path[0].col), cellCY(path[0].row),
      ghostColors[g], g + 1, ghostDelays[g], path
    );
  }

  // Month labels
  const months = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
  const now = new Date();
  let monthLabels = "";
  for (let col = 0; col < COLS; col += 4) {
    const d = new Date(now);
    d.setDate(d.getDate() - (COLS - col) * 7);
    const label = months[d.getMonth()];
    monthLabels += `<text x="${cellCX(col)}" y="${PAD_Y - 8}" font-size="10" fill="${COLORS.text}" text-anchor="middle" font-family="JetBrains Mono,monospace">${label}</text>`;
  }

  // Day labels  
  const days = ["Mon","","Wed","","Fri","","Sun"];
  let dayLabels = "";
  for (let row = 0; row < 7; row++) {
    if (days[row]) {
      dayLabels += `<text x="${PAD_X - 5}" y="${cellCY(row) + 4}" font-size="9" fill="${COLORS.text}" text-anchor="end" font-family="JetBrains Mono,monospace">${days[row]}</text>`;
    }
  }

  return `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink"
  width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
  
  <!-- Background -->
  <rect width="${W}" height="${H}" fill="${COLORS.bg}" rx="6"/>
  
  <!-- Month labels -->
  ${monthLabels}
  
  <!-- Day labels -->
  ${dayLabels}

  <!-- Pellets (contribution squares) -->
  ${pellets}

  <!-- Pellet eat animations -->
  ${pelletAnims}

  <!-- Ghost paths and ghosts -->
  ${ghostsSVG}

  <!-- Pac-Man -->
  <g id="pacman">
    <path id="pm-mouth" fill="${COLORS.pacman}">
      <animate attributeName="d"
        values="${mouthFrames.join(";")}"
        keyTimes="${mouthTimes.join(";")}"
        dur="${dur}s"
        repeatCount="indefinite"
        calcMode="discrete"/>
    </path>
    <!-- Eye -->
    <circle id="pm-eye" r="1.5" fill="#0d1117">
      <animate attributeName="cx"
        values="${xFrames.join(";")}"
        keyTimes="${mouthTimes.join(";")}"
        dur="${dur}s" repeatCount="indefinite" calcMode="linear"/>
      <animate attributeName="cy"
        values="${yFrames.map(y => (parseFloat(y) - PACMAN_R * 0.4).toFixed(1)).join(";")}"
        keyTimes="${mouthTimes.join(";")}"
        dur="${dur}s" repeatCount="indefinite" calcMode="linear"/>
    </circle>
  </g>

  <!-- Border glow -->
  <rect width="${W}" height="${H}" fill="none" rx="6" stroke="#00ff4120" stroke-width="1"/>
</svg>`;
}

// ─── Main ─────────────────────────────────────────────────────────────────────
async function main() {
  console.log(`Fetching contributions for ${USERNAME}...`);
  const weeks = await fetchContributions();
  console.log(`Got ${weeks.length} weeks`);
  const grid = buildGrid(weeks);
  console.log(`Built grid: ${grid.length} cols`);
  const svg = generateSVG(grid);

  const outDir = path.dirname(OUTPUT_FILE);
  if (outDir && outDir !== ".") fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(OUTPUT_FILE, svg);
  console.log(`Written to ${OUTPUT_FILE} (${svg.length} bytes)`);
}

main().catch(err => { console.error(err); process.exit(1); });
