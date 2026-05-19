import clsx from "clsx";
import {
  createMemo,
  createSignal,
  For,
  Show,
} from "solid-js";
import styles from "./version-filter-bar.module.css";

export interface VersionFilterBarProps {
  searchText: string;
  onSearchTextChange: (text: string) => void;
  selectedVersions: string[];
  onSelectedVersionsChange: (versions: string[]) => void;
  availableVersions: string[];
  releaseTypes: Set<string>;
  onReleaseTypesChange: (types: Set<string>) => void;
  loaders: Set<string>;
  onLoadersChange: (loaders: Set<string>) => void;
  availableLoaders: string[];
  totalCount: number;
  filteredCount: number;
}

function compareVersions(a: string, b: string): number {
  const pa = a.split(".").map(Number);
  const pb = b.split(".").map(Number);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const va = pa[i] || 0;
    const vb = pb[i] || 0;
    if (va !== vb) return va - vb;
  }
  return 0;
}

function versionGte(version: string, min: string): boolean {
  return compareVersions(version, min) >= 0;
}

function versionLte(version: string, max: string): boolean {
  return compareVersions(version, max) <= 0;
}

function formatLoaderName(loader: string): string {
  const lower = loader.toLowerCase();
  const labels: Record<string, string> = {
    fabric: "Fabric",
    forge: "Forge",
    quilt: "Quilt",
    neoforge: "NeoForge",
    vanilla: "Vanilla",
  };
  return labels[lower] || loader.charAt(0).toUpperCase() + loader.slice(1);
}

function formatReleaseType(type: string): string {
  return type.charAt(0).toUpperCase() + type.slice(1);
}

function looksLikeVersion(str: string): boolean {
  return /^\d+\.\d+/.test(str);
}

const releaseTypesList = ["release", "beta", "alpha"];
const RANGE_SEPARATORS = ["...", "…"];

function findRangeSeparator(text: string): { idx: number; len: number } | null {
  for (const sep of RANGE_SEPARATORS) {
    const idx = text.indexOf(sep);
    if (idx !== -1) return { idx, len: sep.length };
  }
  return null;
}

const VERSION_CHIP_PREFIX = "mc:";
const RANGE_CHIP_PREFIX = "range:";

function versionChipLabel(chip: string): string {
  if (chip.startsWith(RANGE_CHIP_PREFIX)) {
    return chip.slice(RANGE_CHIP_PREFIX.length);
  }
  if (chip.startsWith(VERSION_CHIP_PREFIX)) {
    return `MC ${chip.slice(VERSION_CHIP_PREFIX.length)}`;
  }
  return chip;
}

export function VersionFilterBar(props: VersionFilterBarProps) {
  const [inputFocused, setInputFocused] = createSignal(false);
  let inputRef: HTMLInputElement | undefined;

  const rangeMatch = createMemo((): {
    start: string;
    endPartial: string;
    isFull: boolean;
  } | null => {
    const q = props.searchText.trim();
    if (!q) return null;
    const sep = findRangeSeparator(q);
    if (!sep) return null;
    const start = q.slice(0, sep.idx).trim();
    const endPart = q.slice(sep.idx + sep.len).trim();
    if (!start) return null;
    return {
      start,
      endPartial: endPart,
      isFull: !!endPart && looksLikeVersion(endPart),
    };
  });

  const autocompleteVersions = createMemo(() => {
    const q = props.searchText.trim();
    if (!q) return [];

    const range = rangeMatch();
    if (range) {
      let filtered = props.availableVersions
        .filter((v) => versionGte(v, range.start))
        .sort((a, b) => compareVersions(a, b));

      if (range.endPartial) {
        if (range.isFull) {
          filtered = filtered.filter((v) => versionLte(v, range.endPartial));
        } else {
          const prefix = range.endPartial.toLowerCase();
          filtered = filtered.filter((v) => v.toLowerCase().startsWith(prefix));
        }
      }

      return filtered.slice(0, 10);
    }

    const lower = q.toLowerCase();
    return props.availableVersions
      .filter((v) => v.toLowerCase().startsWith(lower))
      .sort((a, b) => compareVersions(b, a))
      .slice(0, 8);
  });

  const showDropdown = createMemo(() => {
    if (!inputFocused()) return false;
    return true;
  });

  const closeDropdown = () => {
    props.onSearchTextChange("");
    setInputFocused(false);
    inputRef?.blur();
  };

  return (
    <div class={styles["filter-bar"]}>
      <div class={styles["search-row"]}>
        <div class={styles["search-wrapper"]}>
          <svg
            class={styles["search-icon"]}
            xmlns="http://www.w3.org/2000/svg"
            width="14"
            height="14"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="2"
            stroke-linecap="round"
            stroke-linejoin="round"
          >
            <circle cx="11" cy="11" r="8"></circle>
            <path d="m21 21-4.3-4.3"></path>
          </svg>
          <input
            ref={inputRef}
            type="text"
            class={styles["search-input"]}
            placeholder="Filter versions (name, version, loader)..."
            value={props.searchText}
            onInput={(e) => {
              props.onSearchTextChange(e.currentTarget.value);
            }}
            onFocus={() => setInputFocused(true)}
            onBlur={() => {
              setTimeout(() => setInputFocused(false), 150);
            }}
          />
          <Show when={props.searchText.length > 0}>
            <button
              class={styles["search-clear"]}
              onClick={() => {
                props.onSearchTextChange("");
              }}
              type="button"
            >
              <svg
                xmlns="http://www.w3.org/2000/svg"
                width="14"
                height="14"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                stroke-width="2"
                stroke-linecap="round"
                stroke-linejoin="round"
              >
                <path d="M18 6 6 18"></path>
                <path d="m6 6 12 12"></path>
              </svg>
            </button>
          </Show>

          <Show when={showDropdown()}>
            <div class={styles["dropdown"]}>
              <div class={styles["dropdown-section"]}>
                <div class={styles["dropdown-section-label"]}>
                  Release Type
                </div>
                <div class={styles["dropdown-pills"]}>
                  {releaseTypesList.map((type) => (
                    <button
                      class={clsx(
                        styles["dropdown-pill"],
                        props.releaseTypes.has(type) &&
                          styles["dropdown-pill--active"],
                      )}
                      onMouseDown={(e) => {
                        e.preventDefault();
                        const next = new Set(props.releaseTypes);
                        if (next.has(type)) {
                          next.delete(type);
                        } else {
                          next.add(type);
                        }
                        props.onReleaseTypesChange(next);
                      }}
                      type="button"
                    >
                      {formatReleaseType(type)}
                    </button>
                  ))}
                </div>
                </div>

                <Show when={props.availableLoaders.length > 1}>
                  <div class={styles["dropdown-section"]}>
                    <div class={styles["dropdown-section-label"]}>
                      Modloader
                    </div>
                    <div class={styles["dropdown-pills"]}>
                      {props.availableLoaders.map((loader) => (
                        <button
                          class={clsx(
                            styles["dropdown-pill"],
                            props.loaders.has(loader.toLowerCase()) &&
                              styles["dropdown-pill--active"],
                          )}
                          onMouseDown={(e) => {
                            e.preventDefault();
                            const next = new Set(props.loaders);
                            if (next.has(loader.toLowerCase())) {
                              next.delete(loader.toLowerCase());
                            } else {
                              next.add(loader.toLowerCase());
                            }
                            props.onLoadersChange(next);
                          }}
                          type="button"
                        >
                          {formatLoaderName(loader)}
                        </button>
                      ))}
                    </div>
                  </div>
                </Show>

              <div class={styles["dropdown-divider"]} />

              <div class={styles["dropdown-section"]}>
                <div class={styles["dropdown-section-label"]}>
                  MC Versions
                </div>
                <div class={styles["dropdown-versions"]}>
                  <Show when={rangeMatch()?.isFull}>
                    <button
                      class={clsx(
                        styles["dropdown-version-item"],
                        styles["dropdown-version-item--range"],
                        props.selectedVersions.includes(
                          `${RANGE_CHIP_PREFIX}${rangeMatch()!.start}...${rangeMatch()!.endPartial}`,
                        ) && styles["dropdown-version-item--active"],
                      )}
                      onMouseDown={(e) => {
                        e.preventDefault();
                        const range = rangeMatch();
                        if (!range?.isFull) return;
                        const chip = `${RANGE_CHIP_PREFIX}${range.start}...${range.endPartial}`;
                        if (props.selectedVersions.includes(chip)) {
                          props.onSelectedVersionsChange(
                            props.selectedVersions.filter((v) => v !== chip),
                          );
                        } else {
                          props.onSelectedVersionsChange([
                            ...props.selectedVersions,
                            chip,
                          ]);
                        }
                        closeDropdown();
                      }}
                    >
                      <span class={styles["dropdown-version-label"]}>
                        {rangeMatch()?.start}...{rangeMatch()?.endPartial}
                      </span>
                      <span class={styles["dropdown-version-hint"]}>
                        Range
                      </span>
                    </button>
                  </Show>
                  <Show
                    when={autocompleteVersions().length > 0}
                    fallback={
                      <div class={styles["dropdown-empty"]}>
                        {props.searchText.trim()
                          ? "No matching MC versions"
                          : "Type a version to filter (e.g. 1.21)"}
                      </div>
                    }
                  >
                    {autocompleteVersions().map((version) => {
                      const isRangeActive = !!rangeMatch();
                      const selectedChip = isRangeActive
                        ? `${RANGE_CHIP_PREFIX}${rangeMatch()!.start}...${version}`
                        : `${VERSION_CHIP_PREFIX}${version}`;
                      const isSelected =
                        props.selectedVersions.includes(selectedChip);
                      return (
                        <button
                          class={styles["dropdown-version-item"]}
                          classList={{
                            [styles["dropdown-version-item--active"]]:
                              isSelected,
                          }}
                          onMouseDown={(e) => {
                            e.preventDefault();
                            if (isSelected) {
                              props.onSelectedVersionsChange(
                                props.selectedVersions.filter(
                                  (v) => v !== selectedChip,
                                ),
                              );
                            } else {
                              props.onSelectedVersionsChange([
                                ...props.selectedVersions,
                                selectedChip,
                              ]);
                            }
                            closeDropdown();
                          }}
                        >
                          <span class={styles["dropdown-version-label"]}>
                            {version}
                          </span>
                          <Show when={isSelected}>
                            <svg
                              xmlns="http://www.w3.org/2000/svg"
                              width="14"
                              height="14"
                              viewBox="0 0 24 24"
                              fill="none"
                              stroke="currentColor"
                              stroke-width="2"
                              stroke-linecap="round"
                              stroke-linejoin="round"
                            >
                              <path d="M20 6 9 17l-5-5"></path>
                            </svg>
                          </Show>
                        </button>
                      );
                    })}
                  </Show>
                </div>
              </div>
            </div>
          </Show>
        </div>

        <span class={styles["filter-count"]}>
          {props.filteredCount} / {props.totalCount} versions
        </span>
      </div>

      <Show when={props.selectedVersions.length > 0}>
        <div class={styles["version-chips"]}>
          <For each={props.selectedVersions}>
            {(chip) => (
              <button
                class={styles["chip"]}
                onClick={() => {
                  props.onSelectedVersionsChange(
                    props.selectedVersions.filter((v) => v !== chip),
                  );
                  closeDropdown();
                }}
                type="button"
              >
                {versionChipLabel(chip)}
                <svg
                  class={styles["chip-x"]}
                  xmlns="http://www.w3.org/2000/svg"
                  width="12"
                  height="12"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  stroke-width="2"
                  stroke-linecap="round"
                  stroke-linejoin="round"
                >
                  <path d="M18 6 6 18"></path>
                  <path d="m6 6 12 12"></path>
                </svg>
              </button>
            )}
          </For>
        </div>
      </Show>
    </div>
  );
}
