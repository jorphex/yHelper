import fs from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import crypto from 'node:crypto';
import { chromium, devices } from 'playwright';

const baseUrl = process.env.UI_AUDIT_BASE_URL || 'http://127.0.0.1:3010';
const runId = new Date().toISOString().replace(/[:.]/g, '-');
const outDir = process.env.UI_AUDIT_OUT_DIR || path.join('tmp', 'ui-audit', runId);
const baselineDir = process.env.UI_AUDIT_BASELINE_DIR || path.join('tmp', 'ui-baseline', 'current');
const captureBaseline = process.env.UI_AUDIT_CAPTURE_BASELINE === '1';
const compareBaseline = process.env.UI_AUDIT_COMPARE_BASELINE === '1';
const strictCompare = process.env.UI_AUDIT_STRICT === '1';

const pages = [
  { id: 'overview', route: '/' },
  { id: 'discover', route: '/discover' },
  { id: 'assets', route: '/assets' },
  { id: 'composition', route: '/composition' },
  { id: 'changes', route: '/changes' },
  { id: 'regimes', route: '/regimes' },
  { id: 'chains', route: '/chains' },
];

const modeConfigs = [
  { id: 'noob', storageValue: 'guide' },
  { id: 'pro', storageValue: 'analyst' },
];

const viewportConfigs = [
  {
    id: 'desktop',
    contextOptions: {
      viewport: { width: 1440, height: 900 },
      deviceScaleFactor: 1,
    },
  },
  {
    id: 'mobile',
    contextOptions: {
      ...devices['iPhone 13'],
    },
  },
];

async function ensureDir(dir) {
  await fs.mkdir(dir, { recursive: true });
}

async function fileSha256(filePath) {
  const buf = await fs.readFile(filePath);
  return crypto.createHash('sha256').update(buf).digest('hex');
}

function overflowCount(findings) {
  return (findings?.overflow?.length ?? 0) + (findings?.clippedText?.length ?? 0) + (findings?.navTopClip?.length ?? 0);
}

function structuralRiskCount(findings) {
  return (findings?.cellOverlap?.length ?? 0) + (findings?.firstColWide?.length ?? 0) + (findings?.navTopClip?.length ?? 0);
}

async function loadJsonIfExists(filePath) {
  try {
    const data = await fs.readFile(filePath, 'utf8');
    return JSON.parse(data);
  } catch {
    return null;
  }
}

function compareRuns(currentRuns, baselineRuns) {
  const baselineMap = new Map(baselineRuns.map((run) => [run.comboId, run]));
  const currentMap = new Map(currentRuns.map((run) => [run.comboId, run]));
  const onlyInCurrent = [...currentMap.keys()].filter((comboId) => !baselineMap.has(comboId));
  const missingFromCurrent = [...baselineMap.keys()].filter((comboId) => !currentMap.has(comboId));

  const hashChanged = [];
  const structuralRegressions = [];
  const overflowRegressions = [];

  for (const [comboId, current] of currentMap.entries()) {
    const baseline = baselineMap.get(comboId);
    if (!baseline) continue;
    if ((current.screenshotSha256 ?? null) !== (baseline.screenshotSha256 ?? null)) {
      hashChanged.push(comboId);
    }
    const currentStructural = structuralRiskCount(current.findings);
    const baselineStructural = structuralRiskCount(baseline.findings);
    if (currentStructural > baselineStructural) {
      structuralRegressions.push({
        comboId,
        baselineStructural,
        currentStructural,
      });
    }
    const currentOverflow = overflowCount(current.findings);
    const baselineOverflow = overflowCount(baseline.findings);
    if (currentOverflow > baselineOverflow + 1) {
      overflowRegressions.push({
        comboId,
        baselineOverflow,
        currentOverflow,
      });
    }
  }

  return {
    comparedCombos: currentRuns.length,
    onlyInCurrent,
    missingFromCurrent,
    hashChanged,
    structuralRegressions,
    overflowRegressions,
    strictFail:
      onlyInCurrent.length > 0 ||
      missingFromCurrent.length > 0 ||
      structuralRegressions.length > 0,
  };
}

async function run() {
  await ensureDir(outDir);
  const browser = await chromium.launch({ headless: true });
  const results = {
    meta: {
      baseUrl,
      runId,
      outDir,
      baselineDir,
      captureBaseline,
      compareBaseline,
      strictCompare,
      generatedAtUtc: new Date().toISOString(),
    },
    runs: [],
    summary: {
      totalCombos: 0,
      combosWithOverflow: 0,
      combosWithCellOverlap: 0,
      combosWithFirstColWide: 0,
      totalOverflowFindings: 0,
      totalCellOverlapFindings: 0,
      totalFirstColWideFindings: 0,
    },
  };

  for (const viewportConfig of viewportConfigs) {
    for (const modeConfig of modeConfigs) {
      for (const page of pages) {
        const comboId = `${viewportConfig.id}-${modeConfig.id}-${page.id}`;
        const screenshotPath = path.join(outDir, `${comboId}.png`);

        const context = await browser.newContext({ ...viewportConfig.contextOptions });
        await context.addInitScript((modeValue) => {
          window.localStorage.setItem('yhelper:audience-mode', modeValue);
          document.documentElement.dataset.audience = modeValue;
        }, modeConfig.storageValue);

        const p = await context.newPage();
        const url = `${baseUrl}${page.route}`;
        await p.goto(url, { waitUntil: 'networkidle', timeout: 90000 });
        await p.waitForTimeout(550);
        await p.screenshot({ path: screenshotPath, fullPage: true });

        const metrics = await p.evaluate(() => {
          const toSelector = (el) => {
            if (!(el instanceof Element)) return 'unknown';
            const parts = [];
            let node = el;
            while (node && node instanceof Element && parts.length < 4) {
              let part = node.tagName.toLowerCase();
              if (node.id) {
                part += `#${node.id}`;
                parts.unshift(part);
                break;
              }
              if (node.classList.length > 0) {
                const cls = [...node.classList].slice(0, 2).join('.');
                part += `.${cls}`;
              }
              const parent = node.parentElement;
              if (parent) {
                const siblings = [...parent.children].filter((s) => s.tagName === node.tagName);
                if (siblings.length > 1) {
                  part += `:nth-of-type(${siblings.indexOf(node) + 1})`;
                }
              }
              parts.unshift(part);
              node = node.parentElement;
            }
            return parts.join(' > ');
          };

          const findings = {
            overflow: [],
            clippedText: [],
            cellOverlap: [],
            firstColWide: [],
            navTopClip: [],
            homeModeMetrics: null,
          };

          const vw = window.innerWidth;
          const vh = window.innerHeight;

          const checkTargets = Array.from(
            document.querySelectorAll(
              'main .card, main .hero, main .table-wrap table, main svg, .site-nav-links, .site-header, .audience-toggle, main section, main .split-grid, main .kpi-grid'
            )
          );

          for (const el of checkTargets) {
            const rect = el.getBoundingClientRect();
            if (rect.width <= 0 || rect.height <= 0) continue;
            if (rect.left < -1 || rect.right > vw + 1) {
              findings.overflow.push({
                selector: toSelector(el),
                left: Number(rect.left.toFixed(2)),
                right: Number(rect.right.toFixed(2)),
                viewport: vw,
              });
            }
          }

          const textCandidates = Array.from(document.querySelectorAll('main td, main th, main p, main h1, main h2, main h3, main .muted'));
          for (const el of textCandidates) {
            const cs = window.getComputedStyle(el);
            const hasCut = (el.scrollWidth - el.clientWidth > 8) && (cs.overflowX === 'hidden' || cs.overflowX === 'clip');
            if (!hasCut) continue;
            findings.clippedText.push({
              selector: toSelector(el),
              text: (el.textContent || '').trim().slice(0, 80),
              scrollWidth: el.scrollWidth,
              clientWidth: el.clientWidth,
            });
            if (findings.clippedText.length >= 25) break;
          }

          const tables = Array.from(document.querySelectorAll('main table'));
          for (const table of tables) {
            const rect = table.getBoundingClientRect();
            if (rect.width <= 0) continue;

            const firstHeader = table.querySelector('thead th:first-child');
            if (firstHeader) {
              const firstRect = firstHeader.getBoundingClientRect();
              const ratio = firstRect.width / rect.width;
              if (ratio > 0.38) {
                findings.firstColWide.push({
                  selector: toSelector(table),
                  ratio: Number(ratio.toFixed(3)),
                  firstWidth: Number(firstRect.width.toFixed(1)),
                  tableWidth: Number(rect.width.toFixed(1)),
                });
              }
            }

            const rows = Array.from(table.querySelectorAll('tbody tr')).slice(0, 12);
            for (let i = 0; i < rows.length; i += 1) {
              const cells = Array.from(rows[i].children).filter((cell) => {
                const cs = window.getComputedStyle(cell);
                if (cs.display === 'none' || cs.visibility === 'hidden') return false;
                const cr = cell.getBoundingClientRect();
                return cr.width > 1 && cr.height > 1;
              });
              let prevRight = -Infinity;
              for (let c = 0; c < cells.length; c += 1) {
                const cr = cells[c].getBoundingClientRect();
                if (cr.left < prevRight - 2) {
                  findings.cellOverlap.push({
                    selector: toSelector(table),
                    row: i,
                    column: c,
                    left: Number(cr.left.toFixed(2)),
                    prevRight: Number(prevRight.toFixed(2)),
                  });
                  break;
                }
                prevRight = cr.right;
              }
              if (findings.cellOverlap.length >= 20) break;
            }
          }

          const nav = document.querySelector('.site-nav-links a.is-active');
          const header = document.querySelector('.site-header');
          if (nav && header) {
            const navRect = nav.getBoundingClientRect();
            const headerRect = header.getBoundingClientRect();
            if (navRect.top < headerRect.top + 1) {
              findings.navTopClip.push({
                navTop: Number(navRect.top.toFixed(2)),
                headerTop: Number(headerRect.top.toFixed(2)),
              });
            }
          }

          if (window.location.pathname === '/') {
            const container = document.querySelector('main.container.home-minimal');
            const hero = document.querySelector('.home-minimal-hero');
            const routeGrid = document.querySelector('.home-minimal-routes');
            if (container && hero && routeGrid) {
              const cStyle = window.getComputedStyle(container);
              const hStyle = window.getComputedStyle(hero);
              findings.homeModeMetrics = {
                containerGap: cStyle.gap,
                heroPaddingTop: hStyle.paddingTop,
                heroPaddingLeft: hStyle.paddingLeft,
                routesChildCount: routeGrid.children.length,
              };
            }
          }

          return findings;
        });

        await context.close();
        const screenshotSha256 = await fileSha256(screenshotPath);

        const runRecord = {
          comboId,
          url,
          page: page.id,
          route: page.route,
          mode: modeConfig.id,
          viewport: viewportConfig.id,
          screenshotPath,
          screenshotSha256,
          findings: metrics,
        };
        results.runs.push(runRecord);

        results.summary.totalCombos += 1;
        if (metrics.overflow.length > 0 || metrics.clippedText.length > 0 || metrics.navTopClip.length > 0) {
          results.summary.combosWithOverflow += 1;
          results.summary.totalOverflowFindings += metrics.overflow.length + metrics.clippedText.length + metrics.navTopClip.length;
        }
        if (metrics.cellOverlap.length > 0) {
          results.summary.combosWithCellOverlap += 1;
          results.summary.totalCellOverlapFindings += metrics.cellOverlap.length;
        }
        if (metrics.firstColWide.length > 0) {
          results.summary.combosWithFirstColWide += 1;
          results.summary.totalFirstColWideFindings += metrics.firstColWide.length;
        }
      }
    }
  }

  const desktopHome = results.runs.find((r) => r.page === 'overview' && r.mode === 'noob' && r.viewport === 'desktop');
  const desktopHomePro = results.runs.find((r) => r.page === 'overview' && r.mode === 'pro' && r.viewport === 'desktop');
  results.summary.homeModeParity = {
    noob: desktopHome?.findings?.homeModeMetrics ?? null,
    pro: desktopHomePro?.findings?.homeModeMetrics ?? null,
    parityIssue:
      (desktopHome?.findings?.homeModeMetrics?.containerGap ?? null) !==
        (desktopHomePro?.findings?.homeModeMetrics?.containerGap ?? null) ||
      (desktopHome?.findings?.homeModeMetrics?.heroPaddingLeft ?? null) !==
        (desktopHomePro?.findings?.homeModeMetrics?.heroPaddingLeft ?? null),
  };

  let strictFailure = false;
  if (compareBaseline) {
    const baselineReportPath = path.join(baselineDir, 'report.json');
    const baselineReport = await loadJsonIfExists(baselineReportPath);
    if (!baselineReport) {
      results.comparison = {
        baselineReportPath,
        error: 'Baseline report not found.',
      };
      strictFailure = strictCompare;
    } else {
      const comparison = compareRuns(results.runs, baselineReport.runs ?? []);
      results.comparison = {
        baselineReportPath,
        ...comparison,
      };
      strictFailure = strictCompare && comparison.strictFail;
    }
  }

  const reportPath = path.join(outDir, 'report.json');
  await fs.writeFile(reportPath, `${JSON.stringify(results, null, 2)}\n`, 'utf8');
  if (results.comparison) {
    const comparisonPath = path.join(outDir, 'comparison.json');
    await fs.writeFile(comparisonPath, `${JSON.stringify(results.comparison, null, 2)}\n`, 'utf8');
  }
  if (captureBaseline) {
    await fs.rm(baselineDir, { recursive: true, force: true });
    await fs.cp(outDir, baselineDir, { recursive: true });
  }
  console.log(reportPath);
  await browser.close();
  if (strictFailure) {
    process.exitCode = 2;
  }
}

run().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
