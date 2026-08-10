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

const inputsIn = (form: HTMLFormElement): HTMLInputElement[] =>
  [...form.querySelectorAll<HTMLInputElement>("input")].filter(visible);

const findUsername = (inputs: HTMLInputElement[], password: HTMLInputElement): HTMLInputElement | undefined => {
  const preferred = inputs.find((input) => {
    const hint = `${input.name} ${input.id} ${input.autocomplete}`.toLowerCase();
    return input !== password && /user|email|login|account/.test(hint);
  });
  return preferred ?? inputs.find((input) => input !== password && ["text", "email", "tel"].includes(input.type));
};

const reportLoginCandidate = (form: HTMLFormElement): void => {
  const inputs = inputsIn(form);
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
