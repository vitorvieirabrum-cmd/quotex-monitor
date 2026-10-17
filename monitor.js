import fs from "node:fs/promises";
import { chromium } from "playwright";
import { createClient } from "@supabase/supabase-js";

const QUOTEX_URL =
  process.env.QUOTEX_URL || "https://quotex.com/en/demo-trade";

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const STORAGE_STATE_B64 = process.env.QUOTEX_STORAGE_STATE_B64 || "";

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  throw new Error(
    "Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in GitHub Actions secrets."
  );
}

const supabase = createClient(
  SUPABASE_URL,
  SUPABASE_SERVICE_ROLE_KEY,
  { auth: { persistSession: false } }
);

function parsePercent(value) {
  const cleaned = value
    .replace("%", "")
    .replace(",", ".")
    .replace(/[^0-9+.-]/g, "");
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : null;
}

function parseAssets(text) {
  const lines = text
    .split("\n")
    .map((x) => x.replace(/\s+/g, " ").trim())
    .filter(Boolean);

  const pairRe = /^([A-Z]{3}\/([A-Z]{3}))(?:\s*\(OTC\))?$/;
  const percentRe = /[-+]?\d+(?:[.,]\d+)?\s*%/g;

  const found = [];

  for (let i = 0; i < lines.length; i++) {
    const match = lines[i].match(pairRe);
    if (!match) continue;

    const symbol = lines[i];
    const percentages = [];

    for (let j = i + 1; j < Math.min(lines.length, i + 12); j++) {
      if (pairRe.test(lines[j])) break;

      const pctMatches = lines[j].match(percentRe) || [];
      for (const p of pctMatches) {
        const parsed = parsePercent(p);
        if (parsed !== null) percentages.push(parsed);
      }
    }

    let change24h = null;
    let payout1m = null;
    let payout5m = null;

    if (percentages.length >= 3) {
      [change24h, payout1m, payout5m] = percentages;
    } else if (percentages.length === 2) {
      [payout1m, payout5m] = percentages;
    } else if (percentages.length === 1) {
      payout5m = percentages[0];
    }

    found.push({
      symbol,
      is_otc: /\(OTC\)/i.test(symbol),
      change_24h: change24h,
      payout_1m: payout1m,
      payout_5m: payout5m,
      active: true,
      updated_at: new Date().toISOString(),
    });
  }

  return found;
}

async function scrollMostScrollableElement(page) {
  return await page.evaluate(() => {
    const all = [
      document.scrollingElement,
      ...Array.from(document.querySelectorAll("*")),
    ].filter(Boolean);

    const candidates = all
      .filter((el) => {
        const style = getComputedStyle(el);
        const canScroll =
          /(auto|scroll)/.test(style.overflowY) ||
          el === document.scrollingElement;
        return (
          canScroll &&
          el.scrollHeight > el.clientHeight + 100 &&
          el.clientHeight > 150
        );
      })
      .sort(
        (a, b) =>
          b.scrollHeight -
          b.clientHeight -
          (a.scrollHeight - a.clientHeight)
      );

    const target = candidates[0];
    if (!target) {
      return { moved: false, atBottom: true };
    }

    const before = target.scrollTop;
    const jump = Math.max(Math.floor(target.clientHeight * 0.85), 500);
    target.scrollTop = Math.min(
      target.scrollTop + jump,
      target.scrollHeight
    );

    return {
      moved: target.scrollTop !== before,
      atBottom:
        target.scrollTop + target.clientHeight >= target.scrollHeight - 5,
    };
  });
}

let storageState;

if (STORAGE_STATE_B64) {
  try {
    storageState = JSON.parse(
      Buffer.from(STORAGE_STATE_B64, "base64").toString("utf8")
    );
  } catch {
    throw new Error("QUOTEX_STORAGE_STATE_B64 is not valid base64 JSON.");
  }
}

const browser = await chromium.launch({
  headless: true,
  args: ["--no-sandbox"],
});

try {
  const context = await browser.newContext({
    storageState,
    locale: "pt-BR",
    viewport: { width: 1440, height: 1000 },
  });

  const page = await context.newPage();
  page.setDefaultTimeout(20000);

  console.log("Opening Quotex...");
  await page.goto(QUOTEX_URL, {
    waitUntil: "domcontentloaded",
    timeout: 60000,
  });

  await page.waitForTimeout(5000);

  const allAssets = new Map();
  let idleRounds = 0;

  for (let round = 0; round < 30; round++) {
    const text = await page.locator("body").innerText();
    const parsed = parseAssets(text);

    const before = allAssets.size;
    for (const asset of parsed) {
      allAssets.set(asset.symbol, asset);
    }

    if (allAssets.size === before) idleRounds++;
    else idleRounds = 0;

    const scroll = await scrollMostScrollableElement(page);
    await page.waitForTimeout(700);

    if ((scroll.atBottom && idleRounds >= 2) || idleRounds >= 5) {
      break;
    }
  }

  const rows = [...allAssets.values()];

  await fs.writeFile(
    "debug.txt",
    await page.locator("body").innerText(),
    "utf8"
  );

  await page
    .screenshot({ path: "debug.png", fullPage: true })
    .catch(() => {});

  if (rows.length === 0) {
    throw new Error(
      "No Quotex assets were detected. The page may require login, the asset list may not be open, or the UI changed. Check the debug artifact from this workflow run."
    );
  }

  console.log(`Detected ${rows.length} assets.`);

  const { error } = await supabase
    .from("quotex_assets")
    .upsert(rows, { onConflict: "symbol" });

  if (error) {
    throw new Error(`Supabase upsert failed: ${error.message}`);
  }

  console.log("Supabase updated successfully.");
} finally {
  await browser.close();
}
