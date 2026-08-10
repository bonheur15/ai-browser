export const hostFor = (value: string): string => {
  try {
    const url = new URL(value);
    return url.hostname.replace(/^www\./, "") || "New tab";
  } catch {
    return "New tab";
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
