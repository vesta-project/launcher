import { resources } from "@stores/resources";
import { For, Show } from "solid-js";
import styles from "./resource-browser.module.css";

export function ActiveFilterChips(props: { router?: any }) {
	const hasActiveFilters = () => {
		return (
			resources.state.gameVersion || resources.state.loader || resources.state.categories.length > 0
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
				resources.state.loader.charAt(0).toUpperCase() + resources.state.loader.slice(1);
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
					<button class={styles["filter-chip"]} onClick={chip.onRemove} type="button">
						<span class={styles["filter-chip-label"]}>{chip.label}</span>
						<svg
							class={styles["filter-chip-x"]}
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
							<path d="M18 6 6 18" />
							<path d="m6 6 12 12" />
						</svg>
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
