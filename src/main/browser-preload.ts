import { ipcRenderer } from "electron";

type FillCredential = {
  requestId: string;
  username: string;
  password: string;
};

let lastCandidateKey = "";
let lastCandidateAt = 0;

const visible = (element: HTMLInputElement): boolean => {
  const style = window.getComputedStyle(element);
  return style.display !== "none" && style.visibility !== "hidden" && element.getClientRects().length > 0;
};

const inputsIn = (root: ParentNode): HTMLInputElement[] =>
  [...root.querySelectorAll<HTMLInputElement>("input")].filter(visible);

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
