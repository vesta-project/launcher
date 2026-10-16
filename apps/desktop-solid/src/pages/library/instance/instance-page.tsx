import { Badge, Tab, TabList, TabPanel, Tabs } from "@vesta/ui";
import { For, Show, createSignal, onCleanup, type Component } from "solid-js";
import { isServer } from "@solidjs/web";
import { canGoBack, navigate, route } from "../../../app/router";
import { Board } from "../../../components/board";
import { EmptyState } from "../../../components/empty-state";
import { Icon } from "../../../components/icon";
import { resourcesFor, worldsFor } from "../../../features/instances/details";
import {
  findInstance,
  type InstanceEntry,
} from "../../../features/instances/fixtures";
import { ConsoleTab } from "./console-tab";
import { CrashTab } from "./crash-tab";
import { InstanceHeader } from "./instance-header";
import { OverviewTab } from "./overview-tab";
import { ResourcesTab } from "./resources-tab";
import { InstanceSettingsTab } from "./settings-tab";
import { WorldsTab } from "./worlds-tab";
import { VersionsTab } from "./versions-tab";
import "./instance-page.css";

interface TabDef {
  id: string;
  label: string;
  icon: string;
  view: Component<{ entry: InstanceEntry }>;
  flush?: boolean;
}
const baseTabs: TabDef[] = [
  {
    id: "overview",
    label: "Overview",
    icon: "icons/rail/library",
    view: OverviewTab,
  },
  {
    id: "resources",
    label: "Resources",
    icon: "icons/content/layers",
    view: ResourcesTab,
    flush: true,
  },
  {
    id: "worlds",
    label: "Worlds",
    icon: "icons/content/globe",
    view: WorldsTab,
    flush: true,
  },
  {
    id: "versions",
    label: "Versions",
    icon: "icons/content/history",
    view: VersionsTab,
  },
  {
    id: "console",
    label: "Console",
    icon: "icons/content/terminal",
    view: ConsoleTab,
    flush: true,
  },
];
const crashTab: TabDef = {
  id: "crash",
  label: "Crash",
  icon: "icons/status/error",
  view: CrashTab,
};

export function InstancePage(props: { id: string }) {
  return (
    <Show
      when={findInstance(props.id)?.instance.id}
      keyed
      fallback={
        <Board>
          <EmptyState icon="icons/rail/library" title="Instance not found" />
        </Board>
      }
    >
      {(id) => <InstanceContent id={id} />}
    </Show>
  );
}

/** Wide windows get a section sidebar, like the old launcher; narrow ones a tab strip. */
const sideNavQuery = "(min-width: 960px)";
function useSideNav() {
  if (isServer) return () => false;
  const media = matchMedia(sideNavQuery);
  const [wide, setWide] = createSignal(media.matches);
  const change = () => setWide(media.matches);
  media.addEventListener("change", change);
  onCleanup(() => media.removeEventListener("change", change));
  return wide;
}

function InstanceContent(props: { id: string }) {
  const sideNav = useSideNav();
  const entry = () => findInstance(props.id)!;
  const [previousTab, setPreviousTab] = createSignal("overview");
  const tabs = () =>
    entry().state.kind === "crashed" ? [...baseTabs, crashTab] : baseTabs;
  const active = () =>
    tabs().some((tab) => tab.id === route().detail)
      ? route().detail!
      : route().detail === "settings"
        ? previousTab()
        : "overview";
  const updates = () =>
    resourcesFor(props.id).filter((item) => item.update).length;
  /** Counts shown beside a section; updates take over the resources count. */
  const count = (tab: string) => {
    if (tab === "resources") return resourcesFor(props.id).length;
    if (tab === "worlds") return worldsFor(props.id).length;
    return undefined;
  };
  const open = (tab: string) => {
    if (tab === "settings") setPreviousTab(active());
    else setPreviousTab(tab);
    navigate(`/library/${props.id}/${tab}`);
  };
  const settings = () => route().detail === "settings";
  return (
    <Board fixed still class="instance-board">
      <div data-vesta="instance-layout">
        <InstanceHeader
          entry={entry()}
          compact={settings()}
          onOpenCrash={() => open("crash")}
          onOpenSettings={() => open("settings")}
        />
        <Show
          when={settings()}
          fallback={
            <Tabs
              size="sm"
              orientation={sideNav() ? "vertical" : "horizontal"}
              value={active()}
              onChange={open}
              class="instance-tabs"
            >
              <TabList aria-label="Instance sections">
                <For each={tabs()}>
                  {(tab) => (
                    <Tab
                      value={tab.id}
                      icon={<Icon name={tab.icon} />}
                      badge={
                        tab.id === "resources" && updates() ? (
                          <Badge size="sm" tone="accent">
                            {updates()} new
                          </Badge>
                        ) : count(tab.id) !== undefined ? (
                          <span data-vesta="instance-tab-count">
                            {count(tab.id)}
                          </span>
                        ) : undefined
                      }
                    >
                      {tab.label}
                    </Tab>
                  )}
                </For>
              </TabList>
              <For each={tabs()}>
                {(tab) => (
                  <TabPanel
                    value={tab.id}
                    class={
                      tab.flush
                        ? "instance-pane instance-pane-flush"
                        : "instance-pane"
                    }
                  >
                    <tab.view entry={entry()} />
                  </TabPanel>
                )}
              </For>
            </Tabs>
          }
        >
          <InstanceSettingsTab
            entry={entry()}
            onBack={() => (canGoBack() ? history.back() : open(previousTab()))}
          />
        </Show>
      </div>
    </Board>
  );
}
