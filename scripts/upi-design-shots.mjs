import puppeteer from "puppeteer-core";
import fs from "fs";

const chromePath = "/usr/local/bin/google-chrome";
const artifactDir = "/opt/cursor/artifacts/upi-design";
const storeDir = "/cursor/stores/self/upi-design";

const viewports = [
  ["se", 375, 812],
  ["iphone", 390, 844],
  ["1440", 1440, 900],
];

/** [previewKind, filePrefix, viewports] */
const shots = [
  ["profile-empty", "upi-profile-empty", ["se", "iphone", "1440"]],
  ["profile-filled", "upi-profile-filled", ["se", "iphone", "1440"]],
  ["profile-invalid", "upi-profile-invalid", ["se", "iphone", "1440"]],
  ["settle-with-upi", "upi-settle-with-vpa", ["se", "iphone", "1440"]],
  ["settle-no-upi", "upi-settle-no-vpa", ["se", "iphone", "1440"]],
  ["settle-confirm", "upi-settle-confirm", ["se", "iphone", "1440"]],
  ["settle-ios-picker", "upi-settle-ios-picker", ["se", "iphone", "1440"]],
  [
    "settle-ios-picker-copied",
    "upi-settle-ios-picker-copied",
    ["se", "iphone", "1440"],
  ],
  ["settle-desktop-qr", "upi-settle-desktop-qr", ["1440"]],
];

const jobs = [];
for (const [kind, prefix, vpKeys] of shots) {
  for (const key of vpKeys) {
    const vp = viewports.find(([name]) => name === key);
    if (!vp) continue;
    const [, w, h] = vp;
    jobs.push([kind, `${prefix}-${key}.png`, w, h]);
  }
}

for (const dir of [artifactDir, storeDir]) {
  fs.mkdirSync(dir, { recursive: true });
}

const browser = await puppeteer.launch({
  executablePath: chromePath,
  headless: true,
  args: ["--no-sandbox", "--disable-dev-shm-usage", "--disable-gpu"],
  userDataDir: "/tmp/chrome-upi-puppeteer-design",
});

try {
  for (const [kind, file, w, h] of jobs) {
    const page = await browser.newPage();
    await page.setViewport({ width: w, height: h, deviceScaleFactor: 2 });
    const url = `http://127.0.0.1:8081/?upiPreview=${kind}&t=${Date.now()}`;
    await page.goto(url, { waitUntil: "networkidle0", timeout: 90000 });
    await new Promise((r) => setTimeout(r, 2500));
    for (const dir of [artifactDir, storeDir]) {
      const path = `${dir}/${file}`;
      await page.screenshot({ path, type: "png" });
    }
    console.log("OK", file);
    await page.close();
  }
} finally {
  await browser.close();
}

console.log("DONE", jobs.length, "shots");
