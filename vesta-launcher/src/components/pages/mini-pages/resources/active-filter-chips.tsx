import CloseIcon from "@assets/icons/actions/close.svg";
import { instancesState } from "@stores/instances";
import { resources } from "@stores/resources";
import { batch, For, Show } from "solid-js";
import styles from "./resource-browser.module.css";

export function hasActiveBrowseFilters(): boolean {
	return Boolean(
		resources.state.selectedInstanceId ||
			resources.state.gameVersion ||
			resources.state.loader ||
			resources.state.categories.length > 0,
	);
}

export function activeBrowseFilterCount(): number {
	let count = 0;
	if (resources.state.selectedInstanceId) count++;
	if (resources.state.gameVersion) count++;
	if (resources.state.loader) count++;
	count += resources.state.categories.length;
	return count;
}

export function ActiveFilterChips(props: { router?: any }) {
	const chips = () => {
		const result: {
			key: string;
			kind?: string;
			label: string;
			onRemove: () => void;
		}[] = [];

		if (resources.state.selectedInstanceId) {
			const inst = instancesState.instances.find(
				(i) => i.id === resources.state.selectedInstanceId,
			);
			result.push({
				key: "instance",
				kind: "Instance",
				label: inst?.name || `Instance #${resources.state.selectedInstanceId}`,
				onRemove: () => {
					batch(() => {
						resources.setInstance(null);
						resources.setGameVersion(null);
						resources.setLoader(null);
						resources.setOffset(0);
						props.router?.updateQuery("selectedInstanceId", null);
						props.router?.updateQuery("gameVersion", null);
						props.router?.updateQuery("loader", null);
					});
				},
			});
		}

		if (resources.state.gameVersion) {
			result.push({
				key: "version",
				kind: "MC",
				label: resources.state.gameVersion,
				onRemove: () => {
					resources.setGameVersion(null);
					resources.setOffset(0);
					props.router?.updateQuery("gameVersion", null);
				},
			});
		}

		if (resources.state.loader) {
			const loaderName =
				resources.state.loader.charAt(0).toUpperCase() +
				resources.state.loader.slice(1);
			result.push({
				key: "loader",
				kind: "Loader",
				label: loaderName,
				onRemove: () => {
					resources.setLoader(null);
					resources.setOffset(0);
					props.router?.updateQuery("loader", null);
				},
			});
		}

		for (const catId of resources.state.categories) {
			if (
				catId.toLowerCase() === "fabric" ||
				catId.toLowerCase() === "forge" ||
				catId.toLowerCase() === "quilt" ||
				catId.toLowerCase() === "neoforge"
			) {
				continue;
			}
			const cat = resources.state.availableCategories.find(
				(c) => c.id === catId || c.id.toLowerCase() === catId.toLowerCase(),
			);
			result.push({
				key: `cat-${catId}`,
				label: cat?.name || catId,
				onRemove: () => {
					resources.toggleCategory(catId);
					resources.setOffset(0);
					props.router?.updateQuery("categories", resources.state.categories);
				},
			});
		}

		return result;
	};

	return (
		<Show when={hasActiveBrowseFilters()}>
			<div class={styles["active-filters-strip-inner"]}>
				<For each={chips()}>
					{(chip) => (
						<button
							class={styles["filter-chip"]}
							onClick={chip.onRemove}
							type="button"
							title={`Remove ${chip.kind || "filter"}: ${chip.label}`}
						>
							<Show when={chip.kind}>
								<span class={styles["filter-chip-kind"]}>{chip.kind}</span>
							</Show>
							<span class={styles["filter-chip-label"]}>{chip.label}</span>
							<CloseIcon class={styles["filter-chip-x"]} width="12" height="12" />
						</button>
					)}
				</For>
				<button
					class={styles["filter-chip-clear"]}
					onClick={() => {
						batch(() => {
							resources.resetFilters();
							props.router?.updateQuery("selectedInstanceId", null);
							props.router?.updateQuery("gameVersion", null);
							props.router?.updateQuery("loader", null);
							props.router?.updateQuery("categories", []);
							props.router?.updateQuery("query", "");
						});
					}}
					type="button"
				>
					Clear all
				</button>
			</div>
		</Show>
	);
}
