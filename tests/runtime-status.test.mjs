import assert from "node:assert/strict";
import test from "node:test";
import {
  aggregateMemoryUsageMb,
  classifyBrowserSecurity,
} from "../dist-electron/main/browser-runtime.js";

test("classifies browser security states", () => {
  assert.deepEqual(classifyBrowserSecurity("https://example.com"), {
    security: "secure",
    securityMessage: "Encrypted HTTPS connection",
  });
  assert.deepEqual(classifyBrowserSecurity("http://example.com"), {
    security: "not-secure",
    securityMessage: "This page is using an unencrypted HTTP connection",
  });
  assert.deepEqual(classifyBrowserSecurity("about:blank"), {
    security: "special",
    securityMessage: "This is a browser-generated or special page",
  });
});

test("certificate errors override normal HTTPS security", () => {
  assert.deepEqual(classifyBrowserSecurity("https://example.com", true), {
    security: "not-secure",
    securityMessage: "The page certificate could not be verified",
  });
});

test("aggregates Electron working-set metrics into megabytes", () => {
  assert.equal(
    aggregateMemoryUsageMb([
      { memory: { workingSetSize: 1024 } },
      { memory: { workingSetSize: 2048 } },
    ]),
    3,
  );
  assert.equal(aggregateMemoryUsageMb([{ memory: {} }, {}]), null);
});
