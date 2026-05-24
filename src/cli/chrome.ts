/**
 * Locate a Chrome-family browser on the host. We deliberately don't bundle
 * Chromium (Puppeteer would balloon the package by ~150MB and break in
 * locked-down sandboxes) — instead we use whatever the user already has.
 */
import { existsSync } from "node:fs";
import { execSync } from "node:child_process";

const MAC_CANDIDATES = [
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  "/Applications/Google Chrome Canary.app/Contents/MacOS/Google Chrome Canary",
  "/Applications/Chromium.app/Contents/MacOS/Chromium",
  "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge",
  "/Applications/Brave Browser.app/Contents/MacOS/Brave Browser",
  "/Applications/Arc.app/Contents/MacOS/Arc",
];

const LINUX_CANDIDATES = [
  "/usr/bin/google-chrome",
  "/usr/bin/google-chrome-stable",
  "/usr/bin/chromium",
  "/usr/bin/chromium-browser",
  "/usr/bin/microsoft-edge",
  "/snap/bin/chromium",
];

const WIN_CANDIDATES = [
  "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
  "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe",
  "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
  "C:\\Program Files\\Chromium\\Application\\chrome.exe",
];

/**
 * Returns the path to a usable Chrome-compatible browser, or undefined.
 * Caller is responsible for printing the install hint on failure.
 */
export function findChrome(override?: string): string | undefined {
  if (override) return existsSync(override) ? override : undefined;

  const env = process.env.PLUMB_CHROME ?? process.env.CHROME_PATH;
  if (env && existsSync(env)) return env;

  const candidates =
    process.platform === "darwin"
      ? MAC_CANDIDATES
      : process.platform === "win32"
        ? WIN_CANDIDATES
        : LINUX_CANDIDATES;

  for (const path of candidates) {
    if (existsSync(path)) return path;
  }

  // PATH lookup as a last resort.
  const which = process.platform === "win32" ? "where" : "which";
  for (const cmd of ["google-chrome", "chromium", "chromium-browser", "chrome", "microsoft-edge"]) {
    try {
      const out = execSync(`${which} ${cmd}`, { stdio: ["ignore", "pipe", "ignore"] })
        .toString()
        .trim()
        .split(/\r?\n/)[0];
      if (out && existsSync(out)) return out;
    } catch {
      // not found, try next
    }
  }
  return undefined;
}

export function chromeInstallHint(): string {
  const platformHint =
    process.platform === "darwin"
      ? "Install Google Chrome from https://www.google.com/chrome/, or `brew install --cask google-chrome`."
      : process.platform === "win32"
        ? "Install Google Chrome from https://www.google.com/chrome/."
        : "Install Chromium: `sudo apt install chromium-browser` or `sudo dnf install chromium`.";
  return (
    "Could not find a Chrome-compatible browser on this machine.\n" +
    platformHint +
    "\nIf Chrome is installed in a non-standard location, pass --chrome /path/to/chrome " +
    "or set PLUMB_CHROME=/path/to/chrome."
  );
}
