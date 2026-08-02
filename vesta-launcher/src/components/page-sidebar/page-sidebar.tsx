import { Tabs, TabsList, TabsTrigger } from "@ui/tabs/tabs";
import { createEffect, createSignal, onCleanup, onMount, Show } from "solid-js";
import styles from "./page-sidebar.module.css";

export interface PageSidebarTab {
	value: string;
	label: string;
	disabled?: boolean;
	variant?: "error" | "default";
}

interface PageSidebarProps {
	tabs: PageSidebarTab[];
	activeTab: string;
	onTabChange: (value: string) => void;
	onTabIntent?: (value: string) => void;
	children: any;
	mobileToggle?: any;
}

export function PageSidebar(props: PageSidebarProps) {
	const [mobileOpen, setMobileOpen] = createSignal(false);
	const [isMobile, setIsMobile] = createSignal(window.innerWidth < 600);
	const [contentElement, setContentElement] = createSignal<
		HTMLElement | undefined
	>();
	let previousTab = props.activeTab;
	const tabScrollPositions = new Map<string, number>();

	onMount(() => {
		const handleResize = () => setIsMobile(window.innerWidth < 600);
		window.addEventListener("resize", handleResize);
		onCleanup(() => window.removeEventListener("resize", handleResize));
	});

	// Each tab owns an independent document-like surface. Carrying a long
	// tab's scroll position into a first-visit loading state can put that
	// state above the viewport and make the content area appear blank.
	// Remembering positions by tab also preserves continuity on return visits.
	createEffect(() => {
		const activeTab = props.activeTab;
		const content = contentElement();
		if (!content || activeTab === previousTab) return;

		tabScrollPositions.set(previousTab, content.scrollTop);
		content.scrollTop = tabScrollPositions.get(activeTab) ?? 0;
		previousTab = activeTab;
	});

	return (
		<Tabs
			value={props.activeTab}
			onChange={(v) => {
				props.onTabChange(v as string);
				setMobileOpen(false);
			}}
			orientation="vertical"
			class={styles.root}
		>
			<div class={styles.layout}>
				<aside
					class={styles.sidebar}
					classList={{ [styles.mobileOpen]: isMobile() && mobileOpen() }}
				>
					<TabsList class={styles.nav} aria-label="Page sections">
						{props.tabs.map((tab) => (
							<TabsTrigger
								value={tab.value}
								class={styles.button}
								classList={{
									[styles.active]: tab.value === props.activeTab,
									[styles.error]: tab.variant === "error",
								}}
								disabled={tab.disabled}
								onPointerEnter={() => props.onTabIntent?.(tab.value)}
								onFocus={() => props.onTabIntent?.(tab.value)}
							>
								{tab.label}
							</TabsTrigger>
						))}
					</TabsList>
				</aside>

				<Show when={isMobile() && mobileOpen()}>
					<div class={styles.overlay} onClick={() => setMobileOpen(false)} />
				</Show>

				<Show when={isMobile()}>
					<Show
						when={props.mobileToggle}
						fallback={
							<button
								type="button"
								class={styles.mobileToggle}
								onClick={() => setMobileOpen((o) => !o)}
								aria-label="Toggle sidebar"
							>
								<svg
									xmlns="http://www.w3.org/2000/svg"
									width="18"
									height="18"
									viewBox="0 0 24 24"
									fill="none"
									stroke="currentColor"
									stroke-width="2"
									stroke-linecap="round"
									stroke-linejoin="round"
								>
									<line x1="3" y1="6" x2="21" y2="6" />
									<line x1="3" y1="12" x2="21" y2="12" />
									<line x1="3" y1="18" x2="21" y2="18" />
								</svg>
							</button>
						}
					>
						{props.mobileToggle}
					</Show>
				</Show>

				<main
					ref={(element) => setContentElement(element)}
					class={styles.content}
				>
					{props.children}
				</main>
			</div>
		</Tabs>
	);
}
