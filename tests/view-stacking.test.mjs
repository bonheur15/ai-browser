import assert from "node:assert/strict";
import test from "node:test";

const { interactiveTopView } = await import("../dist-electron/main/view-stacking.js");

test("website view receives input unless an interactive chrome overlay is active", () => {
  const chrome = { id: "chrome" };
  const page = { id: "page" };

  assert.equal(interactiveTopView(chrome, page, false), page);
  assert.equal(interactiveTopView(chrome, page, true), chrome);
  assert.equal(interactiveTopView(chrome, undefined, false), chrome);
});
