import { mkdir, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";
import { chromium } from "playwright";

const RU = {
  startChat: "\u041d\u0430\u0447\u0430\u0442\u044c \u043e\u0431\u0449\u0435\u043d\u0438\u0435",
  findByPhone: "\u041d\u0430\u0439\u0442\u0438 \u043f\u043e \u043d\u043e\u043c\u0435\u0440\u0443",
  findInMax: "\u041d\u0430\u0439\u0442\u0438 \u0432 MAX",
  findAnotherNumber:
    "\u041d\u0430\u0439\u0442\u0438 \u0434\u0440\u0443\u0433\u043e\u0439 \u043d\u043e\u043c\u0435\u0440",
  messagePlaceholder: "\u0421\u043e\u043e\u0431\u0449\u0435\u043d\u0438\u0435",
  chats: "\u0447\u0430\u0442\u044b",
  find: "\u043d\u0430\u0439\u0442\u0438",
  contacts: "\u043a\u043e\u043d\u0442\u0430\u043a\u0442\u044b",
  login: "\u0432\u043e\u0439\u0442\u0438",
};

const args = parseArgs(process.argv.slice(2));
const command = args.command || args._ || "open";
const phone = args.phone || "";
const message = args.message || "";
const cdpPort = Number(args.port || "9222");
const profileDir = path.resolve(process.cwd(), "max-browser-profile");
const debugDir = path.resolve(process.cwd(), "output", "max-debug");

await mkdir(profileDir, { recursive: true });

if (command === "open") {
  openBrowser();
} else if (command === "send") {
  await sendMessage();
} else {
  printResult({ ok: false, status: "failed", error: `Unknown command: ${command}` });
  process.exitCode = 1;
}

function openBrowser() {
  const chromePath = resolveChromePath();
  const chromeArgs = [
    `--remote-debugging-port=${cdpPort}`,
    `--user-data-dir=${profileDir}`,
    "--no-first-run",
    "--no-default-browser-check",
    "https://web.max.ru/",
  ];

  spawn(chromePath, chromeArgs, { detached: true, stdio: "ignore" }).unref();
  printResult({ ok: true, status: "opened", url: "https://web.max.ru/" });
}

async function sendMessage() {
  if (!phone) return fail("failed", "Pass --phone");
  if (!message) return fail("failed", "Pass --message");

  const browser = await chromium.connectOverCDP(`http://127.0.0.1:${cdpPort}`).catch((error) => {
    throw new Error(`Chrome is not open on port ${cdpPort}. Run npm run open first. ${error.message}`);
  });

  let page = null;
  const maxErrors = [];

  try {
    const context = browser.contexts()[0];
    if (!context) throw new Error("No browser context found");

    page =
      context.pages().find((item) => item.url().includes("web.max.ru")) ||
      context.pages()[0] ||
      (await context.newPage());

    page.on("console", (msg) => {
      const text = msg.text?.() || "";
      if (/not\.found|Cannot found contact by phone/i.test(text)) maxErrors.push(text);
    });

    await page.bringToFront().catch(() => {});
    if (!page.url().includes("web.max.ru")) {
      await page.goto("https://web.max.ru/", { waitUntil: "domcontentloaded", timeout: 60000 });
    }

    await waitUntilReady(page);
    if (await looksLikeLogin(page)) return fail("not_logged_in", "MAX is not logged in");

    await openPlusMenu(page);
    await chooseFindByPhone(page);
    await enterPhoneAndSearch(page, phone);
    await page.waitForTimeout(1500);

    if (maxErrors.length > 0 || (await looksLikeNotFound(page))) {
      return fail("not_found", "MAX did not find contact by phone");
    }

    await openSearchResult(page, phone);
    await typeAndSend(page, message);

    printResult({ ok: true, status: "sent", phone });
  } catch (error) {
    if (page) await saveDebugArtifacts(page, "send-failed").catch(() => {});
    fail("failed", error instanceof Error ? error.message : String(error));
  } finally {
    await browser.close().catch(() => {});
  }
}

async function waitUntilReady(page) {
  await page.waitForLoadState("domcontentloaded", { timeout: 30000 }).catch(() => {});
  await page.waitForTimeout(1500);
}

async function looksLikeLogin(page) {
  const body = String(await page.locator("body").innerText({ timeout: 5000 }).catch(() => ""));
  const text = body.toLowerCase();
  if (text.includes(RU.chats) || text.includes(RU.find) || text.includes(RU.contacts)) return false;
  return text.includes(RU.login) || text.includes("login") || text.includes("qr");
}

async function looksLikeNotFound(page) {
  const body = String(await page.locator("body").innerText({ timeout: 3000 }).catch(() => ""));
  const text = body.toLowerCase();
  return (
    text.includes("\u043d\u0435 \u043d\u0430\u0439\u0434\u0435\u043d") ||
    text.includes("\u043d\u0435 \u0443\u0434\u0430\u043b\u043e\u0441\u044c \u043d\u0430\u0439\u0442\u0438") ||
    text.includes("not found") ||
    text.includes("cannot found")
  );
}

async function openPlusMenu(page) {
  const findAnotherNumber = page.getByRole("button", { name: new RegExp(RU.findAnotherNumber, "i") }).first();
  if (await findAnotherNumber.isVisible().catch(() => false)) {
    await findAnotherNumber.click({ timeout: 3000 });
    await page.waitForTimeout(700);
    return;
  }

  const startChat = page.getByLabel(RU.startChat).first();
  if (await startChat.isVisible().catch(() => false)) {
    await startChat.click({ timeout: 3000 });
    await page.waitForTimeout(700);
    return;
  }

  await page.mouse.click(438, 34);
  await page.waitForTimeout(700);
  if (await page.getByText(RU.findByPhone, { exact: false }).first().isVisible().catch(() => false)) return;

  throw new Error("Could not click MAX plus button");
}

async function chooseFindByPhone(page) {
  const locator = page.getByText(RU.findByPhone, { exact: false }).first();
  if (!(await locator.isVisible().catch(() => false))) {
    throw new Error("Could not open MAX number search");
  }
  await locator.click({ timeout: 3000 });
  await page.waitForTimeout(800);
}

async function enterPhoneAndSearch(page, phoneValue) {
  const digitsOnly = normalizePhoneForMax(phoneValue);
  const input = page.locator("dialog[open] form#findContact input.field").first();
  if (await input.isVisible().catch(() => false)) {
    await input.click({ timeout: 3000, force: true });
    await input.fill(digitsOnly, { timeout: 3000 });
  } else {
    await page.keyboard.insertText(digitsOnly);
  }

  await page.waitForTimeout(500);
  await clickSearchButton(page);
}

function normalizePhoneForMax(phoneValue) {
  const digits = phoneValue.replace(/\D/g, "");
  if (digits.length === 11 && (digits.startsWith("7") || digits.startsWith("8"))) return digits.slice(1);
  return digits;
}

async function clickSearchButton(page) {
  const modalButton = page.locator(`dialog[open] button[aria-label="${RU.findInMax}"]`).first();
  if (await modalButton.isVisible().catch(() => false)) {
    await modalButton.click({ timeout: 3000, force: true });
    return;
  }

  const textButton = page.getByText(RU.findInMax, { exact: false }).first();
  if (await textButton.isVisible().catch(() => false)) {
    await textButton.click({ timeout: 3000, force: true });
    return;
  }

  throw new Error("Could not find MAX search button");
}

async function openSearchResult(page, phoneValue) {
  const digits = phoneValue.replace(/\D/g, "");
  const candidateTexts = [phoneValue, digits.slice(-10), digits].filter(Boolean);

  for (const candidateText of candidateTexts) {
    const locator = page.getByText(candidateText, { exact: false }).first();
    if (!(await locator.isVisible().catch(() => false))) continue;
    await locator.click({ timeout: 3000, force: true });
    await page.waitForTimeout(1200);
    return;
  }

  const visibleOptions = page.locator("dialog[open] [role='button'], dialog[open] a, dialog[open] [class*='contact']");
  const count = await visibleOptions.count().catch(() => 0);
  if (count > 0) {
    await visibleOptions.first().click({ timeout: 3000, force: true });
    await page.waitForTimeout(1200);
    return;
  }

  await page.keyboard.press("Enter").catch(() => {});
  await page.waitForTimeout(1200);
}

async function typeAndSend(page, text) {
  const inputCandidates = [
    page.locator(`textarea[placeholder="${RU.messagePlaceholder}"]`).first(),
    page.locator(`input[placeholder="${RU.messagePlaceholder}"]`).first(),
    page.locator(`[placeholder="${RU.messagePlaceholder}"]`).first(),
    page.locator("[contenteditable='true']").last(),
  ];

  for (const input of inputCandidates) {
    if (!(await input.isVisible().catch(() => false))) continue;
    await input.click({ timeout: 3000, force: true });
    await page.keyboard.insertText(text);
    await page.waitForTimeout(300);
    await page.keyboard.press("Enter");
    await page.waitForTimeout(1500);
    return;
  }

  const viewport = page.viewportSize?.() || { width: 1200, height: 800 };
  await page.mouse.click(Math.round(viewport.width * 0.56), viewport.height - 48);
  await page.keyboard.insertText(text);
  await page.waitForTimeout(300);
  await page.keyboard.press("Enter");
  await page.waitForTimeout(1500);
}

async function saveDebugArtifacts(page, name) {
  await mkdir(debugDir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const screenshotPath = path.join(debugDir, `${stamp}-${name}.png`);
  const htmlPath = path.join(debugDir, `${stamp}-${name}.html`);
  const textPath = path.join(debugDir, `${stamp}-${name}.txt`);

  await page.screenshot({ path: screenshotPath, fullPage: true }).catch(() => {});
  await writeFile(htmlPath, await page.content().catch(() => ""), "utf8").catch(() => {});
  await writeFile(textPath, await page.locator("body").innerText({ timeout: 3000 }).catch(() => ""), "utf8").catch(
    () => {},
  );
}

function resolveChromePath() {
  const candidates = [
    "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
    process.env.LOCALAPPDATA
      ? path.join(process.env.LOCALAPPDATA, "Google", "Chrome", "Application", "chrome.exe")
      : "",
  ];

  for (const candidate of candidates) {
    if (existsSync(candidate)) return candidate;
  }

  return "chrome";
}

function printResult(result) {
  console.log(JSON.stringify(result));
}

function fail(status, error) {
  printResult({ ok: false, status, error });
  process.exitCode = 1;
}

function parseArgs(raw) {
  const parsed = {};
  for (let index = 0; index < raw.length; index += 1) {
    const part = raw[index];
    if (!part) continue;
    if (part.startsWith("--")) {
      const key = part.slice(2);
      const next = raw[index + 1];
      if (!next || next.startsWith("--")) {
        parsed[key] = "true";
      } else {
        parsed[key] = next;
        index += 1;
      }
      continue;
    }
    if (!parsed._) parsed._ = part;
  }
  return parsed;
}
