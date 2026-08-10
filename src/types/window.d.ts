import type { AgentAPI } from "../shared/agent-contracts";
import type { BrowserAPI } from "../shared/contracts";

declare global {
  interface Window {
    windowControls: {
      minimize: () => void;
      toggleMaximize: () => void;
      close: () => void;
      isMaximized: () => Promise<boolean>;
    };
    browserAPI: BrowserAPI;
    agentAPI: AgentAPI;
  }
}
