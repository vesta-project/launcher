import SearchIcon from "@assets/icons/content/search.svg";
import BackIcon from "@assets/icons/navigation/arrow-back.svg";
import Button from "@ui/button/button";
import { TextFieldInput, TextFieldRoot } from "@ui/text-field/text-field";
import { For, Show, type JSX } from "solid-js";
import { SettingsCard } from "./settings-card";
import styles from "./option-browser.module.css";

export function OptionBrowser(props: {
	label: string;
	title: string;
	onBack?: () => void;
	backLabel?: string;
	searchLabel: string;
	categoriesLabel: string;
	query: string;
	onQuery: (value: string) => void;
	categories: { id: string; label: string }[];
	category: string;
	onCategory: (id: string) => void;
	hint?: JSX.Element;
	actions?: JSX.Element;
	children: JSX.Element;
}) {
	return (
		<section class={styles.browser} aria-label={props.label}>
			<div class={styles.heading}>
				<Show when={props.onBack}>
					<Button
						class={styles.back}
						variant="ghost"
						size="icon"
						icon_only={true}
						aria-label={props.backLabel}
						tooltip_text={props.backLabel}
						onClick={props.onBack}
					>
						<BackIcon class={styles.icon} />
					</Button>
				</Show>
				<h2 class={styles.title}>{props.title}</h2>
			</div>
			<SettingsCard variant="fill">
				<div class={styles.layout}>
					<aside class={styles.sidebar}>
						<div class={styles.search}>
							<SearchIcon class={styles.searchIcon} aria-hidden="true" />
							<TextFieldRoot>
								<TextFieldInput
									class={styles.searchInput}
									type="search"
									value={props.query}
									aria-label={props.searchLabel}
									placeholder={props.searchLabel}
									onInput={(event) =>
										props.onQuery(
											(event.currentTarget as HTMLInputElement).value,
										)
									}
								/>
							</TextFieldRoot>
						</div>
						<nav aria-label={props.categoriesLabel} class={styles.nav}>
							<For each={props.categories}>
								{(entry) => (
									<Button
										variant="ghost"
										aria-pressed={
											props.category === entry.id && !props.query
										}
										aria-label={entry.label}
										class={styles.navButton}
										onClick={() => props.onCategory(entry.id)}
									>
										{entry.label}
									</Button>
								)}
							</For>
						</nav>
					</aside>
					<div class={styles.content}>
						<Show when={props.hint || props.actions}>
							<div class={styles.bulk}>
								<div class={styles.hint}>{props.hint}</div>
								<Show when={props.actions}>
									<div class={styles.actions}>{props.actions}</div>
								</Show>
							</div>
						</Show>
						{props.children}
					</div>
				</div>
			</SettingsCard>
		</section>
	);
}

export function OptionRow(props: {
	title: string;
	meta?: string;
	hint?: string;
	trailing?: JSX.Element;
	children: JSX.Element;
}) {
	return (
		<div
			class={styles.row}
			classList={{ [styles.rowTrailing]: Boolean(props.trailing) }}
		>
			<span class={styles.copy} title={props.hint}>
				<span class={styles.rowTitle}>{props.title}</span>
				<Show when={props.meta}>
					<span class={styles.meta}>{props.meta}</span>
				</Show>
			</span>
			<div class={styles.value}>{props.children}</div>
			<Show when={props.trailing}>{props.trailing}</Show>
		</div>
	);
}

export function OptionEmpty(props: { children: JSX.Element }) {
	return <p class={styles.empty}>{props.children}</p>;
}

export const optionBrowserPageFill = styles.pageFill;
