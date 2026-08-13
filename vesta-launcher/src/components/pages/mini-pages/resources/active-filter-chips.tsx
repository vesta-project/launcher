import { resources } from "@stores/resources";
import { For, Show } from "solid-js";
import styles from "./resource-browser.module.css";

export function ActiveFilterChips(props: { router?: any }) {
	const hasActiveFilters = () => {
		return (
			resources.state.gameVersion ||
			resources.state.loader ||
			resources.state.categories.length > 0
		);
	};

	const chips = () => {
		const result: { key: string; label: string; onRemove: () => void }[] = [];

		if (resources.state.gameVersion) {
			result.push({
				key: "version",
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
				label: loaderName,
				onRemove: () => {
					resources.setLoader(null);
					resources.setOffset(0);
					props.router?.updateQuery("loader", null);
				},
			});
		}

		for (const catId of resources.state.categories) {
			const cat = resources.state.availableCategories.find(
				(c) => c.id === catId || c.id.toLowerCase() === catId.toLowerCase(),
			);
			result.push({
				key: `cat-${catId}`,
				label: cat?.name || catId,
				onRemove: () => {
					resources.toggleCategory(catId);
					resources.setOffset(0);
				},
			});
		}

		return result;
	};

	return (
		<Show when={hasActiveFilters()}>
			<For each={chips()}>
				{(chip) => (
					<button
						class={styles["filter-chip"]}
						onClick={chip.onRemove}
						type="button"
					>
						<span class={styles["filter-chip-label"]}>{chip.label}</span>
						<CloseIcon class={styles["filter-chip-x"]} width="12" height="12" />
					</button>
				)}
			</For>
			<button
				class={styles["filter-chip-clear"]}
				onClick={() => resources.resetFilters()}
				type="button"
			>
				Clear all
			</button>
		</Show>
	);
}
import CloseIcon from "@assets/icons/actions/close.svg";
