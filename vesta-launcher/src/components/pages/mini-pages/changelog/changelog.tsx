import { invoke } from "@tauri-apps/api/core";
import { createResource, createSignal, For, onMount, Show } from "solid-js";
import { marked } from "marked";
import { sanitizeHtml } from "@utils/security";
import styles from "./changelog.module.css";
import ExternalLinkIcon from "@assets/open.svg";
import { openExternal } from "@utils/external-link";

interface GithubRelease {
	tag_name: string;
	name: string;
	body: string;
	published_at: string;
	html_url: string;
}

const fetchChangelog = async (): Promise<GithubRelease[]> => {
	try {
		return await invoke("get_changelog");
	} catch (e) {
		console.error("Failed to fetch changelog:", e);
		throw e;
	}
};

export default function ChangelogPage() {
	const [releases] = createResource<GithubRelease[]>(fetchChangelog);
	const [selectedTag, setSelectedTag] = createSignal<string | null>(null);

	onMount(() => {
		// If there's a jump target in the URL or props later, we can handle it here
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
		return typeof parsed === "string" ? sanitizeHtml(parsed) : sanitizeHtml(String(parsed));
	};

	const scrollToRelease = (tag: string) => {
		setSelectedTag(tag);
		const element = document.getElementById(`release-${tag}`);
		if (element) {
			element.scrollIntoView({ behavior: "smooth", block: "start" });
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
									classList={{ [styles.navItemActive]: selectedTag() === release.tag_name }}
									onClick={() => scrollToRelease(release.tag_name)}
								>
									{release.tag_name}
								</button>
							)}
						</For>
					</Show>
				</div>
			</div>

			<div class={styles.content}>
				<div class={styles.header}>
					<h1 class={styles.title}>What's New</h1>
				</div>

				<Show when={!releases.loading} fallback={<div class={styles.loading}>Fetching latest updates...</div>}>
					<Show when={!releases.error} fallback={<div class={styles.error}>Failed to load release notes. Please check your internet connection.</div>}>
						<div class={styles.releaseList}>
							<For each={releases()}>
								{(release) => (
									<div 
										id={`release-${release.tag_name}`} 
										class={styles.releaseCard}
										classList={{ [styles.releaseCardSelected]: selectedTag() === release.tag_name }}
									>
										<div class={styles.releaseHeader}>
											<div>
												<span class={styles.versionTag}>{release.tag_name}</span>
											</div>
											<div class={styles.releaseMeta}>
												<span class={styles.releaseDate}>{formatDate(release.published_at)}</span>
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

