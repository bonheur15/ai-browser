export {};

declare global {
  interface Window {
    windowControls: {
      minimize: () => void;
      toggleMaximize: () => void;
      close: () => void;
      isMaximized: () => Promise<boolean>;
    };
  }
}
