import SearchIcon from "@assets/icons/content/search.svg";
import Button from "@ui/button/button";
import { TextFieldInput, TextFieldRoot } from "@ui/text-field/text-field";
import { type Component, For, type JSX, Show } from "solid-js";
import { Dynamic } from "solid-js/web";
import styles from "./option-browser.module.css";
import { SubpageBackButton } from "./SubpageBackButton";
import { SettingsCard } from "./settings-card";

export function OptionBrowser(props: {
	label: string;
	title: string;
	onBack?: () => void;
	backLabel?: string;
	searchLabel: string;
	categoriesLabel: string;
	query: string;
	onQuery: (value: string) => void;
	categories: {
		id: string;
		label: string;
		icon?: Component<{ class?: string }>;
	}[];
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
					<SubpageBackButton label={props.backLabel} onClick={props.onBack} />
				</Show>
				<h2 class={styles.title}>{props.title}</h2>
			</div>
			<SettingsCard variant="fill">
				<div class={styles.layout}>
					<aside class={styles.sidebar}>
						<nav aria-label={props.categoriesLabel} class={styles.nav}>
							<For each={props.categories}>
								{(entry) => (
									<Button
										variant="ghost"
										aria-pressed={props.category === entry.id && !props.query}
										aria-label={entry.label}
										class={styles.navButton}
										onClick={() => props.onCategory(entry.id)}
									>
										<Show when={entry.icon}>
											{(Icon) => (
												<Dynamic component={Icon()} class={styles.navIcon} />
											)}
										</Show>
										<span>{entry.label}</span>
									</Button>
								)}
							</For>
						</nav>
					</aside>
					<div class={styles.content}>
						<div class={styles.toolbar}>
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
							<Show when={props.hint || props.actions}>
								<div class={styles.bulk}>
									<div class={styles.hint} role="status" aria-live="polite">
										{props.hint}
									</div>
									<Show when={props.actions}>
										<div class={styles.actions}>{props.actions}</div>
									</Show>
								</div>
							</Show>
						</div>
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
