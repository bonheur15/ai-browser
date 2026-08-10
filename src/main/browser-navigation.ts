export const DEFAULT_URL = "about:blank";
export const GOOGLE_SEARCH = "https://www.google.com/search?q=";

const NEW_TAB_DOCUMENT = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8">
    <meta name="color-scheme" content="dark">
    <title>New tab</title>
    <style>
      :root { color-scheme: dark; }
      html, body { width: 100%; height: 100%; margin: 0; }
      body { display: grid; place-items: center; overflow: hidden; color: #7d8996; background: radial-gradient(circle at 50% 42%, rgba(155, 231, 196, .08), transparent 24%), #10151a; font: 12px system-ui, sans-serif; }
      main { display: grid; justify-items: center; gap: 8px; opacity: .9; }
      .mark { display: grid; width: 48px; height: 48px; place-items: center; margin-bottom: 6px; border: 1px solid rgba(155, 231, 196, .2); border-radius: 16px; color: #9be7c4; background: rgba(155, 231, 196, .08); font-size: 22px; }
      strong { color: #d1dcdf; font-size: 13px; font-weight: 600; }
      small { color: #7d8996; font-size: 11px; }
    </style>
  </head>
  <body><main><span class="mark">✦</span><strong>A quiet place to start</strong><small>Search or enter a URL above</small></main></body>
</html>`;

export const NEW_TAB_URL = `data:text/html;charset=utf-8,${encodeURIComponent(NEW_TAB_DOCUMENT)}`;

export const isHttpUrl = (value: string): boolean => {
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
};

export const originFor = (value: string): string | null => {
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:" ? url.origin : null;
  } catch {
    return null;
  }
};

export const hostnameFor = (value: string): string => {
  try {
    return new URL(value).hostname;
  } catch {
    return value;
  }
};

export const navigationUrl = (input: string): string => {
  const trimmed = input.trim();
  if (!trimmed) return DEFAULT_URL;
  if (isHttpUrl(trimmed)) return trimmed;
  return `${GOOGLE_SEARCH}${encodeURIComponent(trimmed)}`;
};
