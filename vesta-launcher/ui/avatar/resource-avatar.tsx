import { convertFileSrc, invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { resolveResourceUrl } from "@utils/assets";
import {
	Component,
	createEffect,
	createMemo,
	createResource,
	createSignal,
	onCleanup,
	Show,
} from "solid-js";
import styles from "./avatar.module.css";

export interface ResourceAvatarProps {
	name: string;
	icon?: string | Uint8Array | null;
	playerUuid?: string;
	size?: string | number;
	shape?: "circle" | "square";
	class?: string;
}

export const ResourceAvatar: Component<ResourceAvatarProps> = (props) => {
	const displayChar = createMemo(() => {
		const name = props.name || "?";
		const match = name.match(/[a-zA-Z]/);
		return match ? match[0].toUpperCase() : name.charAt(0).toUpperCase();
	});

	const [avatarTimestamp, setAvatarTimestamp] = createSignal(Date.now());

	const [playerHeadPath] = createResource(
		() => ({ uuid: props.playerUuid, t: avatarTimestamp() }),
		async ({ uuid, t }) => {
			if (!uuid) return null;

			try {
				const path = await invoke<string>("get_player_head_path", {
					playerUuid: uuid,
					forceDownload: false,
				});
				return `${convertFileSrc(path)}?t=${t}`;
			} catch (e) {
				console.error("Failed to fetch player head:", e);
				return null;
			}
		},
	);

	createEffect(() => {
		let unlisten: (() => void) | undefined;
		let cancelled = false;

		listen<{ uuid?: string; force?: boolean }>("core://account-heads-updated", async (event) => {
			const targetUuid = event.payload?.uuid;
			// Normalize UUIDs before comparison so dashed/non-dashed variants match
			const shouldRefresh =
				!targetUuid ||
				!props.playerUuid ||
				targetUuid.replace(/-/g, "") === props.playerUuid.replace(/-/g, "");

			if (!shouldRefresh) return;

			// Pre-download the fresh head so the file cache is up-to-date before re-render
			if (event.payload?.force && props.playerUuid) {
				try {
					await invoke("get_player_head_path", {
						playerUuid: props.playerUuid,
						forceDownload: true,
					});
				} catch {
					// fall through to cached head
				}
			}

			setAvatarTimestamp(Date.now());
		}).then((fn) => {
			if (cancelled) {
				fn();
			} else {
				unlisten = fn;
			}
		});

		onCleanup(() => {
			cancelled = true;
			unlisten?.();
		});
	});

	const [blobUrl, setBlobUrl] = createSignal<string | null>(null);

	createEffect(() => {
		const icon = props.icon;
		if (icon instanceof Uint8Array) {
			const blob = new Blob([icon as any]);
			const url = URL.createObjectURL(blob);
			setBlobUrl(url);
			onCleanup(() => URL.revokeObjectURL(url));
		} else {
			setBlobUrl(null);
		}
	});

	const resolvedUrl = createMemo(() => {
		if (blobUrl()) return blobUrl();
		if (playerHeadPath()) return playerHeadPath();
		if (typeof props.icon === "string" && !props.icon.startsWith("linear-gradient")) {
			return resolveResourceUrl(props.icon);
		}
		return null;
	});

	const backgroundStyle = createMemo(() => {
		if (typeof props.icon === "string" && props.icon.startsWith("linear-gradient")) {
			return { background: props.icon };
		}
		return {};
	});

	const sizeStyle = createMemo(() => {
		if (!props.size) return {};
		const s = typeof props.size === "number" ? `${props.size}px` : props.size;
		return {
			width: s,
			height: s,
			"min-width": s,
			"font-size": `calc(${s} / 2)`,
		};
	});

	return (
		<div
			class={props.class}
			classList={{
				[styles["resource-avatar"]]: true,
				[styles[`resource-avatar--${props.shape || "square"}`]]: true,
			}}
			style={{
				...sizeStyle(),
				...backgroundStyle(),
			}}
		>
			<Show
				when={resolvedUrl()}
				fallback={
					<Show when={!backgroundStyle().background}>
						<span class={styles["resource-avatar-fallback"]}>{displayChar()}</span>
					</Show>
				}
			>
				{(url) => <img src={url()} alt={props.name} class={styles["resource-avatar-image"]} />}
			</Show>
		</div>
	);
};
