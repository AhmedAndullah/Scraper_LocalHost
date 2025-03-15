const express = require("express");
const puppeteer = require("puppeteer-core");
const fs = require("fs");
const path = require("path");
const axios = require("axios");
const chromium = require("chrome-aws-lambda");

const app = express();
const PORT = process.env.PORT || 3000;

// Define the target URLs
const BASE_URL = "https://www.ivena-niedersachsen.de";
const INITIAL_URL = `${BASE_URL}/leitstellenansicht.php?si=0f328b4c5bb6abcf174ed4d87737b02e_01&bereich_id=105001`;
const URL = `${BASE_URL}/leitstellenansicht.php?si=0f328b4c5bb6abcf174ed4d87737b02e_01&bereich_id=105001&fb_id=fb00000000260_01`;

// Define absolute paths
const baseDir = path.resolve(__dirname);
const publicDir = path.join(baseDir, "public");
const assetsDir = path.join(publicDir, "assets");
const tmpDir = process.platform === "win32" ? path.join(baseDir, "tmp") : "/tmp";

// Log directories for debugging
console.log("Base directory:", baseDir);
console.log("Public directory:", publicDir);
console.log("Assets directory:", assetsDir);
console.log("Temp directory:", tmpDir);

// Ensure directories exist
if (!fs.existsSync(publicDir)) fs.mkdirSync(publicDir);
if (!fs.existsSync(assetsDir)) fs.mkdirSync(assetsDir);
if (!fs.existsSync(tmpDir)) fs.mkdirSync(tmpDir, { recursive: true });

// Singleton browser instance
let cachedBrowser = null;

async function getBrowser() {
  if (cachedBrowser) {
    console.log("✅ Reusing existing browser instance");
    return cachedBrowser;
  }

  try {
    let executablePath;
    let launchOptions = {
      headless: "new",
      ignoreHTTPSErrors: true,
      userDataDir: path.join(tmpDir, "puppeteer_user_data"),
    };

    if (process.platform === "win32") {
      const puppeteer = require("puppeteer");
      executablePath = (await puppeteer.executablePath()) || undefined;
      if (!executablePath) {
        throw new Error("Puppeteer executable path not found. Please run 'npm install' to download Chromium.");
      }
      console.log("✅ Using local Puppeteer executable:", executablePath);
      launchOptions.args = ["--no-sandbox", "--disable-setuid-sandbox"];
    } else {
      executablePath = await chromium.executablePath;
      if (!executablePath) throw new Error("Chromium executable path not found");
      console.log("✅ Using chrome-aws-lambda executable:", executablePath);
      launchOptions.args = chromium.args;
      launchOptions.defaultViewport = chromium.defaultViewport;
    }

    cachedBrowser = await (process.platform === "win32" ? require("puppeteer") : puppeteer).launch(launchOptions);
    console.log("✅ Browser launched successfully");
    return cachedBrowser;
  } catch (error) {
    console.error("❌ Error launching browser:", error);
    throw error;
  }
}

// Function to download a resource
async function downloadResource(url, filePath) {
  try {
    // Ensure the URL is absolute
    const absoluteUrl = url.startsWith("http") ? url : `${BASE_URL}/${url.replace(/^\//, "")}`;
    console.log(`⬇️ Downloading ${absoluteUrl} to ${filePath}`);
    const response = await axios({
      url: absoluteUrl,
      method: "GET",
      responseType: "stream",
    });
    const writer = fs.createWriteStream(filePath);
    response.data.pipe(writer);
    return new Promise((resolve, reject) => {
      writer.on("finish", () => {
        console.log(`✅ Downloaded ${absoluteUrl} to ${filePath}`);
        resolve();
      });
      writer.on("error", (err) => {
        console.error(`❌ Failed to save ${absoluteUrl} to ${filePath}: ${err.message}`);
        reject(err);
      });
    });
  } catch (error) {
    console.error(`❌ Failed to download ${url}: ${error.message}`);
    throw error;
  }
}

// Scrape website function
async function scrapeWebsite() {
  const browser = await getBrowser();
  let page;

  try {
    page = await browser.newPage();
    console.log("✅ Navigating to:", INITIAL_URL);
    await page.goto(INITIAL_URL, { waitUntil: "networkidle2", timeout: 30000 });

    // Step 1: Select "Region Hannover" in the anonymous_oe dropdown
    console.log("🔧 Selecting 'Region Hannover' in anonymous_oe dropdown...");
    await page.waitForSelector("#anonymous_oe", { timeout: 10000 });
    const anonymousOeOptions = await page.$$eval("#anonymous_oe option", (options) =>
      options.map(opt => ({ value: opt.value, text: opt.text }))
    );
    console.log("🔍 anonymous_oe options:", anonymousOeOptions);
    await page.select("#anonymous_oe", "73201"); // Value for "Region Hannover"
    await page.waitForNetworkIdle({ idleTime: 1000, timeout: 10000 });

    // Step 2: Navigate to "Innere Medizin" by clicking the appropriate link
    console.log("🔧 Navigating to 'Innere Medizin'...");
    await page.waitForSelector(".standardmenue", { timeout: 10000 });
    const subjectLinks = await page.evaluate(() =>
      [...document.querySelectorAll(".standardmenue a")].map((a) => ({
        text: a.innerText.trim(),
        href: a.href,
      }))
    );
    console.log("🔍 Subject links:", subjectLinks);

    const subjectToClick = subjectLinks.find(
      (item) => item.text.replace(/\u00a0/g, " ").trim().toLowerCase() === "innere medizin"
    );
    if (subjectToClick) {
      console.log("✅ Navigating to:", subjectToClick.href);
      await page.goto(subjectToClick.href, { waitUntil: "networkidle2", timeout: 30000 });
    } else {
      throw new Error("Subject Area 'Innere Medizin' not found!");
    }

    // Step 3: Navigate to "Allgemeine Innere Medizin" by clicking the appropriate link
    console.log("🔧 Navigating to 'Allgemeine Innere Medizin'...");
    await page.waitForSelector(".standardmenue", { timeout: 10000 });
    const departmentLinks = await page.evaluate(() =>
      [...document.querySelectorAll(".standardmenue a")].map((a) => ({
        text: a.innerText.trim(),
        href: a.href,
      }))
    );
    console.log("🔍 Department links:", departmentLinks);

    const departmentToClick = departmentLinks.find(
      (item) => item.text.replace(/\u00a0/g, " ").trim().toLowerCase() === "allgemeine innere medizin"
    );
    if (departmentToClick) {
      console.log("✅ Navigating to:", departmentToClick.href);
      await page.goto(departmentToClick.href, { waitUntil: "networkidle2", timeout: 30000 });
    } else {
      throw new Error("Department 'Allgemeine Innere Medizin' not found!");
    }

    // Wait for the page to fully load after navigation
    await page.waitForNetworkIdle({ idleTime: 1000, timeout: 10000 });

    // Extract external resources (for reference, but skip downloading)
    const resources = await page.evaluate(() => {
      const urls = new Set();
      document.querySelectorAll("link[href], script[src], img[src]").forEach((element) => {
        const url = element.getAttribute("href") || element.getAttribute("src");
        if (url) urls.add(url);
      });
      return Array.from(urls);
    });

    console.log("🔹 External resources found:", resources);

    // Map original URLs to local paths without downloading (rely on pre-downloaded assets)
    const urlToLocalPath = new Map();
    for (const resourceUrl of resources) {
      const fileName = path.basename(resourceUrl.split("?")[0]).toLowerCase();
      const localPath = path.join(assetsDir, fileName);
      const localUrl = `/assets/${fileName}`;

      if (fs.existsSync(localPath)) {
        console.log(`✅ File exists: ${localPath}`);
      } else {
        console.warn(`⚠️ File not found: ${localPath} (using pre-downloaded assets)`);
      }

      const baseUrl = resourceUrl.startsWith("http")
        ? resourceUrl.replace(BASE_URL, "").toLowerCase()
        : resourceUrl.toLowerCase();
      urlToLocalPath.set(resourceUrl.toLowerCase(), localUrl);
      urlToLocalPath.set(baseUrl, localUrl);
      urlToLocalPath.set(baseUrl.replace(/^\//, ""), localUrl);
      urlToLocalPath.set(path.basename(baseUrl), localUrl);
    }

    let htmlContent = await page.content();
    console.log("🔍 Raw HTML snippet (before replacement):", htmlContent.slice(0, 500));

    let totalReplacements = 0;
    for (const [originalUrl, localUrl] of urlToLocalPath) {
      const fileName = path.basename(originalUrl).toLowerCase();
      const regex = new RegExp(`(href|src)=['"][^'"]*${fileName}['"]`, "gi");
      const matchesBefore = (htmlContent.match(regex) || []).length;
      if (matchesBefore > 0) {
        htmlContent = htmlContent.replace(regex, `$1="${localUrl}"`);
        console.log(`🔄 Replaced ${fileName} → ${localUrl} (${matchesBefore} occurrences)`);
        totalReplacements += matchesBefore;
      }
    }

    console.log(`🔍 Total replacements made: ${totalReplacements}`);
    console.log("🔍 Updated HTML snippet (after replacement):", htmlContent.slice(0, 500));

    return htmlContent;
  } catch (error) {
    console.error("❌ Error during scraping:", error);
    throw error;
  } finally {
    if (page) await page.close();
  }
}
// Middleware to log incoming requests
app.use((req, res, next) => {
  console.log(`📡 Incoming request: ${req.method} ${req.url}`);
  next();
});

// Serve static assets
app.use("/assets", express.static(assetsDir, {
  setHeaders: (res) => {
    res.set("Cache-Control", "no-store, no-cache, must-revalidate, proxy-revalidate");
    res.set("Pragma", "no-cache");
    res.set("Expires", "0");
  },
  fallthrough: false,
  index: false,
}));

// Serve the public directory
app.use(express.static(publicDir));

// Root route to trigger scraping
app.get("/", async (req, res) => {
  try {
    const content = await scrapeWebsite();
    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
    res.setHeader('Pragma', 'no-cache');
    res.setHeader('Expires', '0');
    res.send(content);
  } catch (error) {
    res.status(500).send("Internal Server Error: " + error.message);
  }
});

// Debug route for screenshot
app.get("/debug_screenshot", (req, res) => {
  res.sendFile(path.join(publicDir, "debug_screenshot.png"));
});

// Test route for asset serving
app.get("/test-asset", (req, res) => {
  const testFilePath = path.join(assetsDir, "leitstellenansicht4.3.0.css");
  if (fs.existsSync(testFilePath)) {
    console.log(`✅ Serving test asset: ${testFilePath}`);
    res.sendFile(testFilePath);
  } else {
    res.status(404).send("Test asset not found");
  }
});

// Catch-all route
app.use((req, res) => {
  console.log(`❌ 404 - Resource not found: ${req.url}`);
  res.status(404).send("Resource not found");
});

app.listen(PORT, () => {
  console.log(`🚀 Server running at http://localhost:${PORT}`);
});

// Cleanup on process exit
process.on("SIGTERM", async () => {
  if (cachedBrowser) {
    await cachedBrowser.close();
    cachedBrowser = null;
    console.log("✅ Browser closed on shutdown");
  }
  process.exit(0);
});