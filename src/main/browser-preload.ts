import { ipcRenderer } from "electron";
import type { BrowserPageContext, BrowserPageElement, BrowserPageRequest, BrowserPageResponse } from "../shared/agent-contracts";

type FillCredential = {
  requestId: string;
  username: string;
  password: string;
};

let lastCandidateKey = "";
let lastCandidateAt = 0;
let pageSnapshot: BrowserPageContext | null = null;
let pageElementRefs = new Map<string, Element>();
let redactionNodes: HTMLElement[] = [];

const visible = (element: Element): boolean => {
  const style = window.getComputedStyle(element);
  return style.display !== "none" && style.visibility !== "hidden" && element.getClientRects().length > 0;
};

const inputsIn = (root: ParentNode): HTMLInputElement[] =>
  [...root.querySelectorAll<HTMLInputElement>("input")].filter(visible);

const textValue = (value: string | null | undefined, limit = 180): string =>
  (value ?? "").replace(/\s+/g, " ").trim().slice(0, limit);

const elementLabel = (element: Element): string => {
  const explicit = element.getAttribute("aria-label") || element.getAttribute("title") || element.getAttribute("placeholder");
  if (explicit) return textValue(explicit);
  if (element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement) {
    const label = element.id ? document.querySelector(`label[for="${CSS.escape(element.id)}"]`) : null;
    if (label?.textContent) return textValue(label.textContent);
    if (element.name) return textValue(element.name);
  }
  return textValue(element.textContent, 120);
};

const elementRole = (element: Element): string => {
  const explicit = element.getAttribute("role");
  if (explicit) return explicit;
  if (element instanceof HTMLAnchorElement) return "link";
  if (element instanceof HTMLButtonElement) return "button";
  if (element instanceof HTMLSelectElement) return "combobox";
  if (element instanceof HTMLTextAreaElement) return "textbox";
  if (element instanceof HTMLInputElement) {
    if (element.type === "checkbox") return "checkbox";
    if (element.type === "radio") return "radio";
    return "textbox";
  }
  if (element instanceof HTMLFormElement) return "form";
  return "region";
};

const elementValueKind = (element: Element): BrowserPageElement["valueKind"] => {
  if (element instanceof HTMLInputElement) {
    if (element.type === "checkbox" || element.type === "radio") return element.checked ? "checked" : "unchecked";
    return element.value ? "filled" : "empty";
  }
  if (element instanceof HTMLTextAreaElement || element instanceof HTMLSelectElement) return element.value ? "filled" : "empty";
  return undefined;
};

const interactiveElements = (): Element[] => {
  const candidates = [...document.querySelectorAll<Element>("a,button,input,textarea,select,form,[role='button'],[role='link'],[contenteditable='true'],[tabindex]")];
  const seen = new Set<Element>();
  return candidates.filter((element) => {
    if (seen.has(element) || !visible(element as HTMLElement)) return false;
    seen.add(element);
    return true;
  }).slice(0, 140);
};

const rectFor = (element: Element): { x: number; y: number; width: number; height: number } => {
  const rect = element.getBoundingClientRect();
  return { x: Math.round(rect.x), y: Math.round(rect.y), width: Math.round(rect.width), height: Math.round(rect.height) };
};

const sensitiveElements = (): Element[] => [...document.querySelectorAll<Element>(
  "input[type='password'], input[autocomplete*='password'], input[autocomplete*='cc-'], input[name*='card' i], input[name*='cvv' i], input[name*='cvc' i], input[name*='otp' i], input[name*='code' i]",
)].filter((element) => visible(element as HTMLElement));

const createContext = (): BrowserPageContext => {
  const snapshotId = crypto.randomUUID();
  const elements = interactiveElements();
  pageElementRefs = new Map(elements.map((element, index) => [`ref_${index + 1}`, element]));
  const pageElements = elements.map((element, index): BrowserPageElement => ({
    ref: `ref_${index + 1}`,
    role: elementRole(element),
    tag: element.tagName.toLowerCase(),
    label: elementLabel(element),
    placeholder: element.getAttribute("placeholder") || undefined,
    valueKind: elementValueKind(element),
    disabled: element instanceof HTMLButtonElement || element instanceof HTMLInputElement || element instanceof HTMLSelectElement
      ? element.disabled
      : element.getAttribute("aria-disabled") === "true",
  }));
  const context: BrowserPageContext = {
    snapshotId,
    url: location.href,
    title: textValue(document.title, 200),
    text: textValue(document.body?.innerText, 12_000),
    headings: [...document.querySelectorAll("h1,h2,h3")].map((heading) => textValue(heading.textContent, 160)).filter(Boolean).slice(0, 30),
    elements: pageElements,
    scroll: {
      x: Math.round(window.scrollX),
      y: Math.round(window.scrollY),
      width: Math.round(document.documentElement.scrollWidth),
      height: Math.round(document.documentElement.scrollHeight),
      viewportWidth: window.innerWidth,
      viewportHeight: window.innerHeight,
    },
    sensitiveRects: sensitiveElements().map(rectFor),
  };
  pageSnapshot = context;
  return context;
};

const elementForRef = (snapshotId: string, ref: string): Element | null => {
  if (!pageSnapshot || pageSnapshot.snapshotId !== snapshotId) return null;
  const element = pageElementRefs.get(ref) ?? null;
  return element && visible(element as HTMLElement) ? element : null;
};

const dispatchInput = (element: HTMLInputElement | HTMLTextAreaElement, value: string): void => {
  const prototype = element instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
  const setter = Object.getOwnPropertyDescriptor(prototype, "value")?.set;
  setter?.call(element, value);
  element.dispatchEvent(new Event("input", { bubbles: true }));
  element.dispatchEvent(new Event("change", { bubbles: true }));
};

const clearRedaction = (): void => {
  for (const node of redactionNodes) node.remove();
  redactionNodes = [];
};

const applyRedaction = (enabled: boolean): void => {
  clearRedaction();
  if (!enabled) return;
  for (const element of sensitiveElements()) {
    const rect = element.getBoundingClientRect();
    const mask = document.createElement("div");
    mask.dataset.aiBrowserRedaction = "true";
    Object.assign(mask.style, {
      position: "fixed",
      zIndex: "2147483647",
      left: `${rect.left}px`,
      top: `${rect.top}px`,
      width: `${rect.width}px`,
      height: `${rect.height}px`,
      background: "#10151a",
      borderRadius: "3px",
      pointerEvents: "none",
    });
    document.documentElement.appendChild(mask);
    redactionNodes.push(mask);
  }
};

const findUsername = (inputs: HTMLInputElement[], password: HTMLInputElement): HTMLInputElement | undefined => {
  const preferred = inputs.find((input) => {
    const hint = `${input.name} ${input.id} ${input.autocomplete}`.toLowerCase();
    return input !== password && /user|email|login|account/.test(hint);
  });
  return preferred ?? inputs.find((input) => input !== password && ["text", "email", "tel"].includes(input.type));
};

const reportLoginCandidate = (root: ParentNode = document): void => {
  const inputs = inputsIn(root);
  const password = inputs.find((input) => input.type === "password" && input.value);
  if (!password || !password.value || !location.origin.startsWith("http")) return;

  const username = findUsername(inputs, password)?.value.trim() ?? "";
  const candidateKey = `${location.origin}|${username}`;
  const now = Date.now();
  if (candidateKey === lastCandidateKey && now - lastCandidateAt < 4000) return;
  lastCandidateKey = candidateKey;
  lastCandidateAt = now;

  ipcRenderer.send("browser:login-candidate", {
    origin: location.origin,
    hostname: location.hostname,
    username,
    password: password.value,
  });
};

const formFor = (element: Element): HTMLFormElement | null => element.closest("form");

const likelyLoginAction = (element: Element): boolean => {
  if (element instanceof HTMLInputElement && element.type === "submit") return true;
  const label = `${element.textContent ?? ""} ${element.getAttribute("aria-label") ?? ""} ${element.getAttribute("title") ?? ""}`.toLowerCase();
  return /sign\s*in|log\s*in|login|continue|submit|connect|next|enter/.test(label);
};

const setInputValue = (input: HTMLInputElement, value: string): void => {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
  setter?.call(input, value);
  input.dispatchEvent(new Event("input", { bubbles: true }));
  input.dispatchEvent(new Event("change", { bubbles: true }));
};

const pageResponse = (response: BrowserPageResponse): void => {
  ipcRenderer.send("browser:agent-page-response", response);
};

const handlePageRequest = (request: BrowserPageRequest): void => {
  try {
    if (request.type === "context") {
      pageResponse({ requestId: request.requestId, ok: true, context: createContext() });
      return;
    }

    if (request.type === "redact") {
      if (!pageSnapshot || pageSnapshot.snapshotId !== request.snapshotId) throw new Error("Page context expired");
      applyRedaction(request.enabled);
      pageResponse({ requestId: request.requestId, ok: true, result: { redacted: request.enabled } });
      return;
    }

    if (request.type === "click") {
      const target = request.ref ? elementForRef(request.snapshotId, request.ref) : document.elementFromPoint(request.x ?? 0, request.y ?? 0);
      if (!(target instanceof HTMLElement) || !visible(target)) throw new Error("The requested page element is not visible");
      target.click();
      pageResponse({ requestId: request.requestId, ok: true, result: { label: elementLabel(target), role: elementRole(target) } });
      return;
    }

    if (request.type === "type") {
      const target = elementForRef(request.snapshotId, request.ref);
      if (!(target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement || target.isContentEditable)) throw new Error("The requested element cannot receive text");
      if (target instanceof HTMLInputElement && /password|hidden|cc-|otp|one-time|security/i.test(`${target.type} ${target.autocomplete} ${target.name}`)) {
        throw new Error("Secret fields must be filled through the Vault");
      }
      const text = request.text.slice(0, 20_000);
      if (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement) dispatchInput(target, request.replace ? text : `${target.value}${text}`);
      else {
        if (request.replace) target.textContent = "";
        target.textContent = `${target.textContent ?? ""}${text}`;
        target.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "insertText", data: text }));
      }
      pageResponse({ requestId: request.requestId, ok: true, result: { label: elementLabel(target), characters: text.length } });
      return;
    }

    if (request.type === "select") {
      const target = elementForRef(request.snapshotId, request.ref);
      if (!(target instanceof HTMLSelectElement)) throw new Error("The requested element is not a select menu");
      const option = [...target.options].find((candidate) => request.value ? candidate.value === request.value : candidate.textContent?.trim() === request.label?.trim());
      if (!option) throw new Error("The requested select option was not found");
      target.value = option.value;
      target.dispatchEvent(new Event("input", { bubbles: true }));
      target.dispatchEvent(new Event("change", { bubbles: true }));
      pageResponse({ requestId: request.requestId, ok: true, result: { label: elementLabel(target), selected: option.textContent?.trim() ?? "" } });
      return;
    }

    if (request.type === "press") {
      const target = request.ref ? elementForRef(request.snapshotId, request.ref) : document.activeElement;
      if (!(target instanceof HTMLElement)) throw new Error("No page element is focused");
      target.focus();
      const init = { key: request.key.slice(0, 40), code: request.key.slice(0, 40), bubbles: true, cancelable: true };
      target.dispatchEvent(new KeyboardEvent("keydown", init));
      target.dispatchEvent(new KeyboardEvent("keyup", init));
      pageResponse({ requestId: request.requestId, ok: true, result: { key: init.key, label: elementLabel(target) } });
      return;
    }

    if (request.type === "scroll") {
      if (!pageSnapshot || pageSnapshot.snapshotId !== request.snapshotId) throw new Error("Page context expired");
      const target = request.ref ? elementForRef(request.snapshotId, request.ref) : null;
      if (target instanceof HTMLElement) target.scrollBy({ left: Math.max(-2000, Math.min(2000, request.x)), top: Math.max(-2000, Math.min(2000, request.y)), behavior: "auto" });
      else window.scrollBy({ left: Math.max(-2000, Math.min(2000, request.x)), top: Math.max(-2000, Math.min(2000, request.y)), behavior: "auto" });
      pageResponse({ requestId: request.requestId, ok: true, result: { x: Math.round(window.scrollX), y: Math.round(window.scrollY) } });
      return;
    }

    if (request.type === "submit") {
      const target = elementForRef(request.snapshotId, request.ref);
      const form = target instanceof HTMLFormElement ? target : target?.closest("form");
      if (!(form instanceof HTMLFormElement)) throw new Error("The requested element has no form to submit");
      form.requestSubmit();
      pageResponse({ requestId: request.requestId, ok: true, result: { submitted: true } });
    }
  } catch (error: unknown) {
    pageResponse({ requestId: request.requestId, ok: false, error: error instanceof Error ? error.message : "The page action failed" });
  }
};

document.addEventListener("submit", (event) => {
  const form = event.target instanceof HTMLFormElement ? event.target : null;
  if (form) reportLoginCandidate(form);
}, true);

document.addEventListener("click", (event) => {
  const target = event.target instanceof Element
    ? event.target.closest("button, input[type='submit'], input[type='button'], [role='button']")
    : null;
  if (!target || !likelyLoginAction(target)) return;
  const root = formFor(target) ?? document;
  reportLoginCandidate(root);
  window.setTimeout(() => reportLoginCandidate(root), 0);
}, true);

document.addEventListener("keydown", (event) => {
  if (event.key !== "Enter" || !(event.target instanceof HTMLInputElement)) return;
  const root = formFor(event.target) ?? document;
  window.setTimeout(() => reportLoginCandidate(root), 0);
}, true);

ipcRenderer.on("browser:fill-credential", (_event, credential: FillCredential) => {
  const inputs = [...document.querySelectorAll<HTMLInputElement>("input")].filter(visible);
  const password = inputs.find((input) => input.type === "password");
  if (!password) {
    ipcRenderer.send("browser:credential-fill-result", { requestId: credential.requestId, ok: false });
    return;
  }

  const username = findUsername(inputs, password);
  if (username) setInputValue(username, credential.username);
  setInputValue(password, credential.password);
  ipcRenderer.send("browser:credential-fill-result", { requestId: credential.requestId, ok: true });
});

ipcRenderer.on("browser:agent-page-request", (_event, request: BrowserPageRequest) => {
  handlePageRequest(request);
});

window.addEventListener("beforeunload", () => {
  pageSnapshot = null;
  pageElementRefs.clear();
  clearRedaction();
});
