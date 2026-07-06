import ExternalLinkIcon from "@assets/open.svg";
import { changelog, type GithubRelease } from "@stores/changelog";
import { openExternal } from "@utils/external-link";
import { sanitizeHtml } from "@utils/security";
import { marked } from "marked";
import { createEffect, createSignal, For, onMount, Show } from "solid-js";
import styles from "./changelog.module.css";

export default function ChangelogPage() {
	const [releases] = [changelog]; // Use the pre-fetched global resource
	const [selectedTag, setSelectedTag] = createSignal<string | null>(null);
	const [isManualScroll, setIsManualScroll] = createSignal(false);
	let listRef: HTMLDivElement | undefined;
	let observer: IntersectionObserver | undefined;

	onMount(() => {
		// Intersection Observer to update the sidebar selection based on scroll position
		observer = new IntersectionObserver(
			(entries) => {
				// If we're currently doing a smooth scroll from clicking the sidebar, ignore observer updates
				if (isManualScroll()) return;

				// Find the version at the top of the viewing area
				const visibleElements = Array.from(
					document.querySelectorAll(`[id^="release-"]`),
				);
				const containerRect = listRef?.getBoundingClientRect();
				if (!containerRect) return;

				// We want to find the version whose top is closest to the container's top
				// plus a small offset (the "active reading zone")
				const triggerOffset = 60; // Offset from container top in pixels
				let bestMatch: Element | null = null;
				let minDistance = Number.POSITIVE_INFINITY;

				for (const el of visibleElements) {
					const rect = el.getBoundingClientRect();
					// We prioritize elements that have passed the trigger point but are still mostly visible
					const distance = Math.abs(
						rect.top - (containerRect.top + triggerOffset),
					);

					if (distance < minDistance) {
						minDistance = distance;
						bestMatch = el;
					}
				}

				if (bestMatch) {
					const tag = bestMatch.id.replace("release-", "");
					if (tag !== selectedTag()) {
						setSelectedTag(tag);
					}
				}
			},
			{
				root: listRef ?? null,
				threshold: [0, 0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9, 1.0],
			},
		);

		// Observe all release cards when they become available
		createEffect(() => {
			const data = releases();
			const obs = observer;
			if (data && obs) {
				data.forEach((release) => {
					const el = document.getElementById(`release-${release.tag_name}`);
					if (el) obs.observe(el);
				});

				// Set initial selection if not set
				if (!selectedTag() && data.length > 0) {
					setSelectedTag(data[0].tag_name);
				}
			}
		});

		// Cleanup
		return () => observer?.disconnect();
	});

	const formatDate = (dateStr: string) => {
		try {
			return new Date(dateStr).toLocaleDateString(undefined, {
				year: "numeric",
				month: "long",
				day: "numeric",
			});
		} catch {
			return dateStr;
		}
	};

	const renderMarkdown = (text: string) => {
		// Use domestic sanitizer for basic XSS protection
		const parsed = marked.parse(text || "No release notes available.");
		return typeof parsed === "string"
			? sanitizeHtml(parsed)
			: sanitizeHtml(String(parsed));
	};

	const scrollToRelease = (tag: string) => {
		setIsManualScroll(true);
		setSelectedTag(tag);
		const element = document.getElementById(`release-${tag}`);
		if (element) {
			element.scrollIntoView({ behavior: "smooth", block: "start" });

			// Re-enable observer after smooth scroll finishes (roughly)
			setTimeout(() => {
				setIsManualScroll(false);
			}, 800);
		} else {
			setIsManualScroll(false);
		}
	};

	return (
		<div class={styles.container}>
			<div class={styles.sidebar}>
				<h3 class={styles.sidebarTitle}>Versions</h3>
				<div class={styles.versionNav}>
					<Show when={!releases.loading}>
						<For each={releases()}>
							{(release) => (
								<button
									type="button"
									class={styles.navItem}
									classList={{
										[styles.navItemActive]: selectedTag() === release.tag_name,
									}}
									onClick={() => scrollToRelease(release.tag_name)}
								>
									{release.tag_name}
								</button>
							)}
						</For>
					</Show>
				</div>
			</div>

			<div class={styles.content} ref={listRef}>
				<div class={styles.header}>
					<h1 class={styles.title}>What's New</h1>
				</div>

				<Show
					when={!releases.loading}
					fallback={
						<div class={styles.loading}>Fetching latest updates...</div>
					}
				>
					<Show
						when={!releases.error}
						fallback={
							<div class={styles.error}>
								Failed to load release notes. Please check your internet
								connection.
							</div>
						}
					>
						<div class={styles.releaseList}>
							<For each={releases()}>
								{(release) => (
									<div
										id={`release-${release.tag_name}`}
										class={styles.releaseCard}
									>
										<div class={styles.releaseHeader}>
											<div>
												<span class={styles.versionTag}>
													{release.tag_name}
												</span>
											</div>
											<div class={styles.releaseMeta}>
												<span class={styles.releaseDate}>
													{formatDate(release.published_at)}
												</span>
												<button
													class={styles.githubLink}
													onClick={() => openExternal(release.html_url)}
													title="View on GitHub"
												>
													<ExternalLinkIcon />
												</button>
											</div>
										</div>
										<div
											class={styles.releaseBody}
											innerHTML={renderMarkdown(release.body) as string}
										/>
									</div>
								)}
							</For>
						</div>
					</Show>
				</Show>
			</div>
		</div>
	);
}
