import assert from "node:assert/strict";
import test from "node:test";

const { browserUserAgent, shouldGrantSitePermission } = await import(
  "../dist-electron/main/browser-compatibility.js"
);

test("browser user agent presents Chromium compatibility without Electron branding", () => {
  const userAgent = browserUserAgent("144.0.7559.32", "linux");
  assert.match(userAgent, /Chrome\/144\.0\.7559\.32/);
  assert.match(userAgent, /X11; Linux x86_64/);
  assert.equal(userAgent.includes("Electron"), false);
});

test("site permission policy allows compatibility features but protects sensitive devices", () => {
  assert.equal(
    shouldGrantSitePermission("storage-access", "https://www.google.com/recaptcha/"),
    true,
  );
  assert.equal(shouldGrantSitePermission("fullscreen", "https://www.youtube.com/"), true);
  assert.equal(shouldGrantSitePermission("media", "https://meet.example.com/"), false);
  assert.equal(shouldGrantSitePermission("geolocation", "https://maps.example.com/"), false);
  assert.equal(shouldGrantSitePermission("storage-access", "http://example.com/"), false);
});
