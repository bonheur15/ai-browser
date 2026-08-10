const AUTOMATIC_WEB_PERMISSIONS = new Set([
  "clipboard-sanitized-write",
  "fullscreen",
  "mediaKeySystem",
  "pointerLock",
  "storage-access",
  "top-level-storage-access",
]);

const browserPlatformToken = (platform: NodeJS.Platform): string => {
  if (platform === "win32") return "Windows NT 10.0; Win64; x64";
  if (platform === "darwin") return "Macintosh; Intel Mac OS X 10_15_7";
  return "X11; Linux x86_64";
};

const compatibleChromeVersion = (version: string): string =>
  /^\d+(?:\.\d+){3}$/.test(version) ? version : "120.0.0.0";

export const browserUserAgent = (
  chromeVersion: string,
  platform: NodeJS.Platform = process.platform,
): string =>
  `Mozilla/5.0 (${browserPlatformToken(platform)}) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${compatibleChromeVersion(chromeVersion)} Safari/537.36`;

const isTrustedWebURL = (value: string | undefined): boolean => {
  if (!value) return false;
  try {
    const url = new URL(value);
    return (
      url.protocol === "https:" ||
      (url.protocol === "http:" && ["127.0.0.1", "localhost"].includes(url.hostname))
    );
  } catch {
    return false;
  }
};

export const shouldGrantSitePermission = (
  permission: string,
  requestingURL: string | undefined,
): boolean => AUTOMATIC_WEB_PERMISSIONS.has(permission) && isTrustedWebURL(requestingURL);
