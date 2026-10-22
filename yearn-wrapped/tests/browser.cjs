// Shared browser configuration; CI can use Playwright's installed browsers.
const playwright = require(process.env.PLAYWRIGHT_MODULE_PATH || 'playwright');
const baseURL = (process.env.YEARN_WRAPPED_TEST_URL || 'http://127.0.0.1:8767').replace(/\/?$/, '/');
const chromiumOptions = {
  headless: true,
  ...(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {}),
  args: ['--enable-unsafe-swiftshader'],
};
module.exports = { ...playwright, baseURL, chromiumOptions };
