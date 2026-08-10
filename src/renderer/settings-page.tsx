import { useEffect, useState, type CSSProperties, type ReactNode } from "react";
import type {
  AccentId,
  AppSnapshot,
  AppearanceMode,
  BrowserCommand,
  Space,
} from "../shared/contracts";
import type {
  AgentActionClass,
  AgentCommand as SharedAgentCommand,
  AgentPolicy,
  AgentSnapshot as SharedAgentSnapshot,
} from "../shared/agent-contracts";
import { ACCENT_IDS } from "../shared/settings";
import { accentColors, accentLabels, applyTheme, themeLabels } from "./theme";

type SettingsSection = "appearance" | "workspace" | "agent" | "shortcuts";

const spaceColors = ["#9be7c4", "#8db4ff", "#f4bf7a", "#d8a5ff", "#ff9d9d", "#7de2e7"];
const spaceIcons = [
  ["home", "Home"],
  ["briefcase", "Briefcase"],
  ["eye", "Eye"],
  ["eye-off", "Private"],
  ["sparkles", "Sparkles"],
] as const;
const agentActions: Array<[AgentActionClass, string]> = [
  ["read", "Read pages"],
  ["navigate", "Navigate"],
  ["tab-management", "Manage tabs"],
  ["page-interaction", "Interact with pages"],
  ["credential-fill", "Use saved credentials"],
  ["form-submit", "Submit forms"],
  ["external-side-effect", "External effects"],
  ["destructive", "Destructive actions"],
];

const iconFor = (icon: string): string =>
  ({ home: "⌂", briefcase: "▣", eye: "◉", "eye-off": "◌", sparkles: "✦" })[icon] ?? "✦";

type SettingsPageProps = {
  snapshot: AppSnapshot;
  agentSnapshot: SharedAgentSnapshot;
  onDispatch: (command: BrowserCommand) => void;
  onDispatchAgent: (command: SharedAgentCommand) => void;
  onClose: () => void;
  onCreateSpace: () => void;
  onRenameSpace: (space: Space, name: string) => void;
  onDeleteSpace: (space: Space) => void;
};

export function SettingsPage({
  snapshot,
  agentSnapshot,
  onDispatch,
  onDispatchAgent,
  onClose,
  onCreateSpace,
  onRenameSpace,
  onDeleteSpace,
}: SettingsPageProps) {
  const [section, setSection] = useState<SettingsSection>("appearance");
  const [saved, setSaved] = useState(false);
  const [expandedSpaceId, setExpandedSpaceId] = useState<string | null>(null);

  useEffect(() => {
    applyTheme(snapshot.settings.appearance.mode, snapshot.settings.appearance.accent);
  }, [snapshot.settings.appearance]);

  const appearance = snapshot.settings.appearance;
  const showSaved = (): void => {
    setSaved(true);
    window.setTimeout(() => setSaved(false), 1600);
  };
  const updateAppearance = (next: Partial<typeof appearance>): void => {
    onDispatch({
      type: "settings.updateAppearance",
      appearance: { ...appearance, ...next },
    });
    showSaved();
  };

  const updateAgent = (policy: AgentPolicy): void => onDispatchAgent({ type: "agent.defaults.update", policy });
  const updateAgentField = <K extends keyof AgentPolicy>(key: K, value: AgentPolicy[K]): void =>
    updateAgent({ ...agentSnapshot.globalDefaults, [key]: value });

  const navItems: Array<[SettingsSection, string, string]> = [
    ["appearance", "Appearance", "◐"],
    ["workspace", "Workspace", "◈"],
    ["agent", "Agent", "✧"],
    ["shortcuts", "Shortcuts", "⌘"],
  ];

  return (
    <section className="settings-page" aria-label="Settings">
      <header className="settings-header">
        <div>
          <span className="eyebrow">PREFERENCES</span>
          <h1>Settings</h1>
          <p>Shape the browser around the way you think and work.</p>
        </div>
        <div className="settings-header-actions">
          {saved && <span className="settings-saved">✓ Saved locally</span>}
          <button className="settings-close" type="button" onClick={onClose}>
            <span>←</span> Back to browser
          </button>
        </div>
      </header>

      <div className="settings-layout">
        <nav className="settings-nav" aria-label="Settings sections">
          {navItems.map(([id, label, glyph]) => (
            <button
              className={`settings-nav-item${section === id ? " is-active" : ""}`}
              type="button"
              key={id}
              aria-current={section === id ? "page" : undefined}
              onClick={() => setSection(id)}
            >
              <span>{glyph}</span>
              {label}
            </button>
          ))}
          <div className="settings-nav-note">
            <span className="status-dot" />
            <small>Local-first</small>
            <small>Your preferences stay on this device.</small>
          </div>
        </nav>

        <div className="settings-content">
          {section === "appearance" && (
            <div className="settings-section-stack">
              <SettingsSectionHeader eyebrow="APPEARANCE" title="Make it feel like yours" description="These choices style the AI Browser shell. Websites keep their own appearance settings." />
              <SettingsCard title="Theme" description="Choose how the browser frame should look." icon="◐">
                <div className="theme-choice-grid" role="radiogroup" aria-label="Theme mode">
                  {(["dark", "light", "system"] as AppearanceMode[]).map((mode) => (
                    <button
                      className={`theme-choice theme-choice-${mode}${appearance.mode === mode ? " is-selected" : ""}`}
                      type="button"
                      role="radio"
                      aria-checked={appearance.mode === mode}
                      key={mode}
                      onClick={() => updateAppearance({ mode })}
                    >
                      <span className="theme-choice-preview" />
                      <strong>{themeLabels[mode]}</strong>
                      <small>{mode === "system" ? "Follow your device" : `${themeLabels[mode]} surfaces`}</small>
                    </button>
                  ))}
                </div>
              </SettingsCard>
              <SettingsCard title="Accent color" description="Use a single visual signal across actions, focus states, and active surfaces." icon="✦">
                <div className="accent-grid" role="radiogroup" aria-label="Accent color">
                  {ACCENT_IDS.map((accent) => (
                    <button
                      className={`accent-choice${appearance.accent === accent ? " is-selected" : ""}`}
                      type="button"
                      role="radio"
                      aria-checked={appearance.accent === accent}
                      key={accent}
                      onClick={() => updateAppearance({ accent })}
                    >
                      <span className="accent-swatch" style={{ background: accentColors[accent] }} />
                      <span>{accentLabels[accent]}</span>
                      {appearance.accent === accent && <b>✓</b>}
                    </button>
                  ))}
                </div>
              </SettingsCard>
              <SettingsCard title="Live preview" description="A small preview of how your current choices combine." icon="▦">
                <div className="settings-preview">
                  <div className="settings-preview-top"><span /><span /><span /></div>
                  <div className="settings-preview-body">
                    <div className="settings-preview-rail"><i /><i className="is-active" /><i /></div>
                    <div className="settings-preview-main">
                      <div className="settings-preview-line long" /><div className="settings-preview-line" />
                      <button type="button">Active action <span>↗</span></button>
                    </div>
                  </div>
                </div>
              </SettingsCard>
            </div>
          )}

          {section === "workspace" && (
            <div className="settings-section-stack">
              <SettingsSectionHeader eyebrow="WORKSPACE" title="Organize your Spaces" description="Spaces keep identities separate. Their colors and icons are independent from the global accent." />
              <div className="settings-card settings-space-card">
                <div className="settings-card-heading"><div><span className="settings-card-icon">◈</span><div><h2>Your Spaces</h2><p>Personal and private contexts currently available in this window.</p></div></div><button className="small-primary" type="button" onClick={onCreateSpace}>+ New Space</button></div>
                <div className="settings-space-list">
                  {snapshot.spaces.map((space) => (
                    <SpaceSettingRow
                      key={space.id}
                      space={space}
                      tabCount={snapshot.tabs.filter((tab) => tab.spaceId === space.id).length}
                      expanded={expandedSpaceId === space.id}
                      onToggle={() => setExpandedSpaceId(expandedSpaceId === space.id ? null : space.id)}
                      onRename={(name) => onRenameSpace(space, name)}
                      onDelete={() => onDeleteSpace(space)}
                      onAppearance={(color, icon) => onDispatch({ type: "space.updateAppearance", spaceId: space.id, color, icon })}
                    />
                  ))}
                </div>
              </div>
            </div>
          )}

          {section === "agent" && (
            <div className="settings-section-stack">
              <SettingsSectionHeader eyebrow="AGENT" title="Set the boundaries" description="These defaults are copied into new Agent threads. Existing threads keep their own policies." />
              <SettingsCard title="Default mode" description="Choose how much autonomy new threads should have." icon="✧">
                <div className="agent-mode-grid" role="radiogroup" aria-label="Agent default mode">
                  {(["full", "guided", "observe"] as const).map((mode) => (
                    <button key={mode} className={`agent-mode-choice${agentSnapshot.globalDefaults.mode === mode ? " is-selected" : ""}`} type="button" role="radio" aria-checked={agentSnapshot.globalDefaults.mode === mode} onClick={() => updateAgentField("mode", mode)}>
                      <strong>{mode === "full" ? "Autonomous" : mode === "guided" ? "Guided" : "Observe only"}</strong>
                      <small>{mode === "full" ? "Can complete allowed actions" : mode === "guided" ? "Pauses before sensitive actions" : "Reads without changing pages"}</small>
                    </button>
                  ))}
                </div>
              </SettingsCard>
              <SettingsCard title="Allowed actions" description="Keep only the capabilities you want available by default." icon="⌁">
                <div className="settings-toggle-list">
                  {agentActions.map(([action, label]) => (
                    <label className="settings-toggle-row" key={action}><span><strong>{label}</strong><small>{action}</small></span><input type="checkbox" checked={agentSnapshot.globalDefaults.allowedActions.includes(action)} onChange={(event) => updateAgentField("allowedActions", event.target.checked ? [...agentSnapshot.globalDefaults.allowedActions, action] : agentSnapshot.globalDefaults.allowedActions.filter((candidate) => candidate !== action))} /></label>
                  ))}
                </div>
              </SettingsCard>
              <SettingsCard title="Other boundaries" description="Additional limits applied to new Agent threads." icon="⊙">
                <div className="settings-toggle-list">
                  <ToggleRow label="Use saved credentials" description="Allow explicit Vault fill actions" checked={agentSnapshot.globalDefaults.allowVault} onChange={(value) => updateAgentField("allowVault", value)} />
                  <ToggleRow label="Access Private Spaces" description="Private Spaces remain excluded by default" checked={agentSnapshot.globalDefaults.allowPrivate} onChange={(value) => updateAgentField("allowPrivate", value)} />
                  <label className="settings-range-row"><span><strong>Maximum tabs</strong><small>New threads may open up to this many tabs.</small></span><input type="number" min={1} max={100} value={agentSnapshot.globalDefaults.maxTabs} onChange={(event) => updateAgentField("maxTabs", Math.min(100, Math.max(1, Number(event.target.value) || 1)))} /></label>
                </div>
                <div className="agent-connection-note"><span className={`connection-pip connection-${agentSnapshot.connection.status}`} /><span>Agent connection: <strong>{agentSnapshot.connection.status}</strong></span></div>
              </SettingsCard>
            </div>
          )}

          {section === "shortcuts" && (
            <div className="settings-section-stack">
              <SettingsSectionHeader eyebrow="SHORTCUTS" title="Move quickly" description="The shortcuts currently available across the browser shell." />
              <div className="settings-card shortcut-card">
                {[["⌘ / Ctrl", "L", "Focus the command field"], ["⌘ / Ctrl", "Enter", "Run the Agent composer"], ["⌘ / Ctrl", ",", "Open Settings"], ["Esc", "", "Close Settings outside text inputs"]].map(([modifier, key, label]) => <div className="shortcut-row" key={label}><div><kbd>{modifier}</kbd>{key && <kbd>{key}</kbd>}</div><span>{label}</span></div>)}
              </div>
              <ResetPreferences onResetAppearance={() => onDispatch({ type: "settings.resetAppearance" })} onResetAgent={() => onDispatchAgent({ type: "agent.defaults.reset" })} />
            </div>
          )}
        </div>
      </div>
    </section>
  );
}

function SettingsSectionHeader({ eyebrow, title, description }: { eyebrow: string; title: string; description: string }) {
  return <div className="settings-section-header"><span className="eyebrow">{eyebrow}</span><h2>{title}</h2><p>{description}</p></div>;
}

function SettingsCard({ title, description, icon, children }: { title: string; description: string; icon: string; children: ReactNode }) {
  return <section className="settings-card"><div className="settings-card-heading"><div><span className="settings-card-icon">{icon}</span><div><h2>{title}</h2><p>{description}</p></div></div></div>{children}</section>;
}

function ToggleRow({ label, description, checked, onChange }: { label: string; description: string; checked: boolean; onChange: (value: boolean) => void }) {
  return <label className="settings-toggle-row"><span><strong>{label}</strong><small>{description}</small></span><input type="checkbox" checked={checked} onChange={(event) => onChange(event.target.checked)} /></label>;
}

function SpaceSettingRow({ space, tabCount, expanded, onToggle, onRename, onDelete, onAppearance }: { space: Space; tabCount: number; expanded: boolean; onToggle: () => void; onRename: (name: string) => void; onDelete: () => void; onAppearance: (color: string, icon: string) => void }) {
  const [name, setName] = useState(space.name);
  useEffect(() => setName(space.name), [space.name]);
  return <div className={`settings-space-row${expanded ? " is-expanded" : ""}`}><div className="settings-space-summary"><span className="settings-space-icon" style={{ "--space-color": space.color } as CSSProperties}>{iconFor(space.icon)}</span><div><strong>{space.name}</strong><small>{space.kind === "private" ? "Temporary private Space" : `${tabCount} ${tabCount === 1 ? "tab" : "tabs"}`}</small></div><button className="settings-space-edit" type="button" onClick={onToggle}>{expanded ? "Done" : "Edit"}</button></div>{expanded && <div className="settings-space-editor"><label>Name<input value={name} onChange={(event) => setName(event.target.value)} onBlur={() => onRename(name)} /></label><div><span className="settings-field-label">Color</span><div className="space-color-grid">{spaceColors.map((color) => <button className={`space-color-option${space.color === color ? " is-selected" : ""}`} type="button" key={color} aria-label={`Use ${color}`} style={{ background: color }} onClick={() => onAppearance(color, space.icon)} />)}</div></div><div><span className="settings-field-label">Icon</span><div className="space-icon-grid">{spaceIcons.map(([icon, label]) => <button className={`space-icon-option${space.icon === icon ? " is-selected" : ""}`} type="button" key={icon} aria-label={label} onClick={() => onAppearance(space.color, icon)}>{iconFor(icon)}</button>)}</div></div>{space.kind === "persistent" && <button className="danger-text-button" type="button" onClick={onDelete}>Delete Space</button>}</div>}</div>;
}

function ResetPreferences({ onResetAppearance, onResetAgent }: { onResetAppearance: () => void; onResetAgent: () => void }) {
  const reset = (): void => {
    if (!window.confirm("Reset appearance and Agent defaults? Your Spaces, website data, Vault credentials, and Agent history will remain.")) return;
    onResetAppearance();
    onResetAgent();
  };
  return <section className="settings-reset"><div><span className="eyebrow">RESET</span><h2>Start fresh with preferences</h2><p>Restore Dark + Mint and the default Agent boundaries. This will not delete your browsing data.</p></div><button type="button" onClick={reset}>Reset preferences</button></section>;
}
