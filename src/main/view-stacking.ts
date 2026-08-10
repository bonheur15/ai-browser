export const interactiveTopView = <T>(chrome: T, page: T | undefined, overlayActive: boolean): T =>
  overlayActive || !page ? chrome : page;
