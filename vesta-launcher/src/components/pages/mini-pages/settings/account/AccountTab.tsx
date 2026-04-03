import CapeIcon from "@assets/cape-icon.svg";
import ShieldIcon from "@assets/chip.svg";
import ClipboardIcon from "@assets/clipboard.svg";
import PlusIcon from "@assets/plus.svg";
// Assets
import RefreshIcon from "@assets/refresh.svg";
import ArrowRightIcon from "@assets/right-arrow.svg";
import ViewIcon from "@assets/search.svg";
import SkinIcon from "@assets/skin-icon.svg";
import { router } from "@components/page-viewer/page-viewer";
import { invoke } from "@tauri-apps/api/core";
import { writeText } from "@tauri-apps/plugin-clipboard-manager";
import { open } from "@tauri-apps/plugin-dialog";
import { readFile } from "@tauri-apps/plugin-fs";
import { ResourceAvatar } from "@ui/avatar";
import { Badge } from "@ui/badge";
import { ImageViewer } from "@ui/image-viewer/image-viewer";
// UI Components
import { Popover, PopoverContent, PopoverTrigger } from "@ui/popover/popover";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@ui/select/select";
import { SkinView3d } from "@ui/skin-viewer";
import {
	Tabs,
	TabsContent,
	TabsIndicator,
	TabsList,
	TabsTrigger,
} from "@ui/tabs/tabs";
import { Tooltip, TooltipContent, TooltipTrigger } from "@ui/tooltip/tooltip";
import {
	getActiveAccount,
	setActiveAccount as persistActiveAccount,
} from "@utils/auth";
import { onConfigUpdate } from "@utils/config-sync";
import { createNotification } from "@utils/notifications";
import {
	createEffect,
	createMemo,
	createSignal,
	For,
	on,
	onCleanup,
	onMount,
	Show,
} from "solid-js";
import styles from "./AccountTab.module.css";

interface Account {
	id: string;
	name: string;
	username?: string;
	display_name?: string | null;
	uuid: string;
	account_type: string;
	skin_url?: string;
	skin_variant?: string;
	cape_url?: string;
	skin_data?: string;
	cape_data?: string;
}

interface SkinSource {
	type: "default" | "history" | "local" | "profile";
	classic_texture?: string;
	slim_texture?: string;
	texture?: string;
	url?: string;
}

interface Skin {
	texture_key: string;
	name?: string;
	source: SkinSource;
}

interface SkinHistory {
	id: number;
	account_uuid: string;
	texture_key: string;
	name: string;
	variant: string;
	image_data: string;
	source: string;
}

interface Cape {
	id: string;
	name: string;
	url: string;
}

interface MinecraftProfile {
	id: string;
	name: string;
	skins: Array<{ id: string; state: string; url: string; variant: string }>;
	capes: Array<{ id: string; state: string; url: string; alias: string }>;
}

interface CompleteSkinsResponse {
	current_skin_id: string | null;
	current_cape_id: string | null;
	current_skin_base64: string | null;
	current_cape_base64: string | null;
	current_variant: "classic" | "slim";
	recent_history: SkinHistory[];
	default_skins: Skin[];
	capes: Array<{ id: string; state: string; url: string; alias: string }>;
}

const normalizeVariant = (value?: string | null): "classic" | "slim" => {
	return String(value || "classic").toLowerCase() === "slim"
		? "slim"
		: "classic";
};

const normalizeSkinComparable = (value: string): string => {
	if (!value) return "";
	const trimmed = value.trim();
	if (trimmed.startsWith("data:")) {
		const commaIndex = trimmed.indexOf(",");
		return (commaIndex >= 0 ? trimmed.slice(commaIndex + 1) : trimmed).trim();
	}

	try {
		const parsed = new URL(trimmed);
		parsed.search = "";
		parsed.hash = "";
		return parsed.toString();
	} catch {
		return trimmed;
	}
};

const toTitleCase = (value: string): string => {
	return value
		.replace(/[_-]+/g, " ")
		.replace(/\s+/g, " ")
		.trim()
		.split(" ")
		.map((word) =>
			word ? word[0].toUpperCase() + word.slice(1).toLowerCase() : word,
		)
		.join(" ");
};

const formatTooltipName = (
	name: string | undefined,
	source: string | undefined,
): string => {
	if (!name) return "Skin";
	const normalizedSource = (source || "").toLowerCase();
	if (
		normalizedSource === "default" ||
		normalizedSource.startsWith("default:")
	) {
		return toTitleCase(name);
	}
	return name;
};

const SkinPortrait = (props: { src: string; variant?: string }) => {
	let canvasRef: HTMLCanvasElement | undefined;

	createEffect(() => {
		const src = props.src;
		const variant = props.variant?.toLowerCase() || "classic";
		if (!src || !canvasRef) return;

		const img = new Image();
		img.crossOrigin = "anonymous";
		img.src = src;

		img.onload = () => {
			if (!canvasRef) return;
			const ctx = canvasRef.getContext("2d");
			if (!ctx) return;

			const armW = variant === "slim" ? 3 : 4;
			const totalW = armW + 8 + armW;
			const totalH = 20; // 8 (head) + 12 (body/arms)

			canvasRef.width = totalW;
			canvasRef.height = totalH;
			ctx.clearRect(0, 0, totalW, totalH);
			ctx.imageSmoothingEnabled = false;

			// 1. Head (8,8) -> (armW, 0)
			ctx.drawImage(img, 8, 8, 8, 8, armW, 0, 8, 8);
			ctx.drawImage(img, 40, 8, 8, 8, armW, 0, 8, 8); // Hat layer

			// 2. Torso (20,20) -> (armW, 8)
			ctx.drawImage(img, 20, 20, 8, 12, armW, 8, 8, 12);
			ctx.drawImage(img, 20, 36, 8, 12, armW, 8, 8, 12); // Jacket layer

			// 3. Right Arm (Player's Right / Viewer's Left)
			// Source X: 44 (skips the side of the arm), Source Y: 20
			ctx.drawImage(img, 44, 20, armW, 12, 0, 8, armW, 12);
			ctx.drawImage(img, 44, 36, armW, 12, 0, 8, armW, 12); // Sleeve

			// 4. Left Arm (Player's Left / Viewer's Right)
			// Source X: 36, Source Y: 52 (skips top of arm)
			ctx.drawImage(img, 36, 52, armW, 12, armW + 8, 8, armW, 12);
			ctx.drawImage(img, 52, 52, armW, 12, armW + 8, 8, armW, 12); // Sleeve
		};
	}, [props.src, props.variant]);

	return (
		<div class={styles.skinPortrait}>
			<canvas ref={canvasRef} class={styles.skinPortraitCanvas} />
		</div>
	);
};

export function AccountSettingsTab() {
	const [accounts, setAccounts] = createSignal<Account[]>([]);
	const [activeAccount, setActiveAccount] = createSignal<Account | null>(null);
	const [skins, setSkins] = createSignal<Skin[]>([]);
	const [skinHistory, setSkinHistory] = createSignal<SkinHistory[]>([]);
	const [capes, setCapes] = createSignal<Cape[]>([]);
	const [saving, setSaving] = createSignal(false);
	const [browseTab, setBrowseTab] = createSignal("recent");
	const [viewerSrc, setViewerSrc] = createSignal<string | null>(null);
	const [compactActionMode, setCompactActionMode] = createSignal(false);
	const [isNarrowLayout, setIsNarrowLayout] = createSignal(false);
	const [isSingleNarrowToggle, setIsSingleNarrowToggle] = createSignal(false);
	const [narrowView, setNarrowView] = createSignal<"browse" | "preview">(
		"browse",
	);

	const [savedSnapshot, setSavedSnapshot] = createSignal<{
		skinUrl: string;
		capeUrl: string | null;
		skinKey: string | null;
		capeKey: string | null;
		variant: "classic" | "slim";
	} | null>(null);

	// Preview Signals
	const [previewSkinUrl, setPreviewSkinUrl] = createSignal<string>("");
	const [previewComputedKey, setPreviewComputedKey] = createSignal<
		string | null
	>(null);
	const [previewCapeComputedKey, setPreviewCapeComputedKey] = createSignal<
		string | null
	>(null);
	// Cache for computed keys of preset textures to avoid repeated downloads
	const presetKeyCache = new Map<string, string>();
	const [presetKeyVersion, _setPresetKeyVersion] = createSignal(0);
	const [previewCapeUrl, setPreviewCapeUrl] = createSignal<string | null>("");
	const [previewVariant, setPreviewVariant] = createSignal<"classic" | "slim">(
		"classic",
	);

	const _applyAuthoritativeVariant = (
		accountUuid: string,
		variant: "classic" | "slim",
	) => {
		const current = activeAccount();
		if (!current || current.uuid !== accountUuid) return;

		if (normalizeVariant(current.skin_variant) !== variant) {
			setActiveAccount({ ...current, skin_variant: variant });
		}

		setPreviewVariant(variant);
		setSavedSnapshot((snapshot) =>
			snapshot ? { ...snapshot, variant } : snapshot,
		);
	};

	const _detectVariantFromSkinData = async (
		skinUrl: string,
	): Promise<"classic" | "slim" | null> => {
		if (!skinUrl || !skinUrl.startsWith("data:")) return null;
		try {
			const detected = await invoke<string>("detect_base64_skin_variant", {
				base64Data: skinUrl,
			});
			return normalizeVariant(detected);
		} catch {
			return null;
		}
	};

	const loadData = async () => {
		try {
			const accs = await invoke<Account[]>("get_accounts");
			setAccounts(accs);

			const active = (await getActiveAccount()) as any as Account;
			if (active) {
				setActiveAccount(active);

				if (active.account_type !== "guest" && active.account_type !== "demo") {
					// Trigger a background sync on mount to ensure we have the latest from Mojang
					invoke("force_sync_account_profile", { accountUuid: active.uuid })
						.then(async () => {
							console.log(
								"[AccountSettings] Background sync on mount completed",
							);
							// Fetch the updated data from DB after the sync finishes
							const res = await invoke<CompleteSkinsResponse>(
								"get_complete_skin_data",
								{ accountUuid: active.uuid },
							);
							setSkins(res.default_skins);
							setSkinHistory(res.recent_history);
							setCapes(
								res.capes.map((c) => ({
									id: c.id,
									name: c.alias || "Cape",
									url: c.url,
								})),
							);

							// Only update preview/snapshot if user hasn't touched anything yet (still matches initial snapshot)
							const snapshot = savedSnapshot();
							if (
								!snapshot ||
								(normalizeSkinComparable(previewSkinUrl() || "") ===
									normalizeSkinComparable(snapshot.skinUrl) &&
									normalizeSkinComparable(previewCapeUrl() || "") ===
										normalizeSkinComparable(snapshot.capeUrl || "") &&
									previewVariant() === snapshot.variant)
							) {
								setPreviewSkinUrl(
									res.current_skin_base64 || active.skin_url || "",
								);
								setPreviewVariant(
									(res.current_variant as "classic" | "slim") || "classic",
								);
								setPreviewCapeUrl(
									res.current_cape_base64 || active.cape_url || "",
								);
								setPreviewComputedKey(res.current_skin_id);
								setPreviewCapeComputedKey(res.current_cape_id);

								setSavedSnapshot({
									skinUrl: res.current_skin_base64 || active.skin_url || "",
									capeUrl: res.current_cape_base64 || active.cape_url || null,
									skinKey: res.current_skin_id || null,
									capeKey: res.current_cape_id || null,
									variant:
										(res.current_variant as "classic" | "slim") || "classic",
								});
							}
						})
						.catch((err) =>
							console.error(
								"[AccountSettings] Background sync on mount failed:",
								err,
							),
						);

					const res = await invoke<CompleteSkinsResponse>(
						"get_complete_skin_data",
						{ accountUuid: active.uuid },
					);
					setSkins(res.default_skins);
					setSkinHistory(res.recent_history);
					setCapes(
						res.capes.map((c) => ({
							id: c.id,
							name: c.alias || "Cape",
							url: c.url,
						})),
					);

					setPreviewSkinUrl(res.current_skin_base64 || active.skin_url || "");
					setPreviewVariant(
						(res.current_variant as "classic" | "slim") || "classic",
					);
					setPreviewCapeUrl(res.current_cape_base64 || active.cape_url || "");
					setPreviewComputedKey(res.current_skin_id);
					setPreviewCapeComputedKey(res.current_cape_id);

					setSavedSnapshot({
						skinUrl: res.current_skin_base64 || active.skin_url || "",
						capeUrl: res.current_cape_base64 || active.cape_url || null,
						skinKey: res.current_skin_id || null,
						capeKey: res.current_cape_id || null,
						variant: (res.current_variant as "classic" | "slim") || "classic",
					});
				} else {
					setPreviewSkinUrl(active.skin_url || "");
					setPreviewVariant(normalizeVariant(active.skin_variant));
					setPreviewCapeUrl(active.cape_url || "");
					setPreviewComputedKey(null);
					setPreviewCapeComputedKey(null);

					setSavedSnapshot({
						skinUrl: active.skin_url || "",
						capeUrl: active.cape_url || null,
						skinKey: null,
						capeKey: null,
						variant: normalizeVariant(active.skin_variant),
					});
					setSkins(await invoke<Skin[]>("get_default_skins"));
					setCapes([]);
					setSkinHistory([]);
				}
			}
		} catch (err) {
			console.error("Failed to load account data:", err);
		}
	};

	onMount(loadData);

	onMount(() => {
		// Listen for external active account changes (e.g. from Sidebar)
		const unsubscribe = onConfigUpdate(async (field) => {
			if (field === "active_account_uuid") {
				const active = (await getActiveAccount()) as any as Account;
				if (active && active.uuid !== activeAccount()?.uuid) {
					setActiveAccount(active);
				}
			}
		});
		onCleanup(unsubscribe);
	});

	onMount(() => {
		const evaluateLayoutModes = () => {
			setCompactActionMode(window.innerHeight < 860);
			const narrow = window.innerWidth <= 1000;
			setIsNarrowLayout(narrow);
			setIsSingleNarrowToggle(window.innerWidth < 640);
			if (!narrow) {
				setNarrowView("browse");
			}
		};

		evaluateLayoutModes();
		window.addEventListener("resize", evaluateLayoutModes);
		onCleanup(() => window.removeEventListener("resize", evaluateLayoutModes));
	});

	createEffect(
		on(activeAccount, (active) => {
			if (active) {
				setPreviewSkinUrl(active.skin_url || "");
				setPreviewVariant(normalizeVariant(active.skin_variant));
				setPreviewCapeUrl(active.cape_url || "");
				setPreviewComputedKey(null);
				setPreviewCapeComputedKey(null);
				setSavedSnapshot({
					skinUrl: active.skin_url || "",
					capeUrl: active.cape_url || null,
					skinKey: null,
					capeKey: null,
					variant: normalizeVariant(active.skin_variant),
				});

				if (active.account_type !== "guest") {
				} else {
					setCapes([]);
					setSkinHistory([]);
				}
			}
		}),
	);

	const isDirty = createMemo(() => {
		const active = activeAccount();
		const snapshot = savedSnapshot();
		if (!active || !snapshot) return false;

		// Compare against the canonical "saved" snapshot from the server/loadData,
		// NOT the initial active account object which might have stale URLs.
		const previewSkin = previewSkinUrl() || "";
		const previewCape = previewCapeUrl() || "";
		const previewVar = previewVariant();

		const previewSkinKey = previewComputedKey();
		const previewCapeKey = previewCapeComputedKey();

		// 1. If we have texture keys, they are the strictly authoritative way to check for dirty state
		// because they represent the actual image bytes.
		if (snapshot.skinKey && previewSkinKey) {
			if (snapshot.skinKey !== previewSkinKey) return true;
		} else {
			// Fallback to URL normalization if keys aren't available for some reason
			if (
				normalizeSkinComparable(previewSkin) !==
				normalizeSkinComparable(snapshot.skinUrl || "")
			)
				return true;
		}

		if (snapshot.capeKey !== undefined && previewCapeKey !== undefined) {
			// Handle null vs string explicitly
			if (snapshot.capeKey !== previewCapeKey) return true;
		} else {
			if (
				normalizeSkinComparable(previewCape) !==
				normalizeSkinComparable(snapshot.capeUrl || "")
			)
				return true;
		}

		return previewVar !== snapshot.variant;
	});

	const getSkinTexture = (
		skin: Skin | null,
		variant: "classic" | "slim",
	): string => {
		if (!skin) return "";
		const { source } = skin;
		if (!source) return "";

		if (source.type === "default") {
			return (
				(variant === "slim" ? source.slim_texture : source.classic_texture) ||
				source.classic_texture ||
				source.slim_texture ||
				""
			);
		}
		return source.texture || source.url || "";
	};

	const getSkinUniqueId = (skin: Skin): string | null => {
		return skin.texture_key || null;
	};

	const activeSkin = createMemo(() => {
		const url = previewSkinUrl();
		if (!url) return null;
		// depend on preset key cache updates to ensure comparisons wait for hashing if needed
		const _presetVer = presetKeyVersion();
		const normalizedPreview = normalizeSkinComparable(url);

		// 1. Check presets first
		const preset = skins().find((s) => {
			const c = normalizeSkinComparable(getSkinTexture(s, "classic"));
			const sl = normalizeSkinComparable(getSkinTexture(s, "slim"));

			// Attempt simple string match (URLs/base64)
			if (c === normalizedPreview || sl === normalizedPreview) {
				console.log("MatchFound: preset (string match)", {
					preset: s.name || s.texture_key,
				});
				return true;
			}

			// Fallback: Attempt image-byte match via computed texture keys
			const computed = previewComputedKey();
			if (computed) {
				// Match against preset's static texture_key
				if (s.texture_key && s.texture_key === computed) {
					console.log("MatchFound: preset (texture_key match)", {
						preset: s.name || s.texture_key,
						computed,
					});
					return true;
				}

				// Match against cached hashes of the preset's variant textures (classic/slim)
				const classicTex = getSkinTexture(s, "classic");
				const slimTex = getSkinTexture(s, "slim");
				const classicKey = classicTex
					? presetKeyCache.get(classicTex)
					: undefined;
				const slimKey = slimTex ? presetKeyCache.get(slimTex) : undefined;

				if (classicKey && classicKey === computed) {
					console.log("MatchFound: preset (classic variant key match)", {
						preset: s.name || s.texture_key,
						key: classicKey,
					});
					return true;
				}
				if (slimKey && slimKey === computed) {
					console.log("MatchFound: preset (slim variant key match)", {
						preset: s.name || s.texture_key,
						key: slimKey,
					});
					return true;
				}
			}
			return false;
		});
		if (preset) return preset;

		// 2. Check local skin history
		let historyItem: SkinHistory | undefined = undefined;
		const previewKey = previewComputedKey();

		for (const h of skinHistory()) {
			const comparable = normalizeSkinComparable(h.image_data);
			if (comparable === normalizedPreview) {
				console.log("MatchFound: history (string match)", {
					texture_key: h.texture_key,
				});
				historyItem = h;
				break;
			}

			if (previewKey && h.texture_key === previewKey) {
				console.log("MatchFound: history (texture_key match)", {
					texture_key: h.texture_key,
					source: h.source,
				});
				historyItem = h;
				break;
			}
		}

		if (historyItem) {
			// Map history entry to Skin object for UI rendering
			return {
				texture_key: historyItem.texture_key,
				name: historyItem.name,
				source: {
					type: historyItem.source || "custom",
					classic_texture: historyItem.image_data,
					slim_texture: historyItem.image_data,
				},
			} as any as Skin;
		}
		return null;
	});

	const _activeSkinId = createMemo(() => {
		const active = activeSkin();
		if (active) return getSkinUniqueId(active);

		const currentUrl = previewSkinUrl();
		if (!currentUrl) return null;

		const normalizedCurrent = normalizeSkinComparable(currentUrl);

		const previewKeyForId = previewComputedKey();
		for (const item of skinHistory()) {
			const comparable = normalizeSkinComparable(item.image_data);
			const matched = comparable === normalizedCurrent;
			if (matched) {
				return item.texture_key;
			}
			if (previewKeyForId) {
				const matchByKey = item.texture_key === previewKeyForId;
				if (matchByKey) {
					console.log("MatchFound: history (texture_key match)", {
						texture_key: item.texture_key,
						source: item.source,
					});
					return item.texture_key;
				}
			}
		}

		return null;
	});

	const isSkinSelected = (itemUrl: string, itemTextureKey: string) => {
		// 1. Check by ID/Hash (Best)
		const currentSkinId = previewComputedKey();
		if (currentSkinId && itemTextureKey && currentSkinId === itemTextureKey) {
			return true;
		}

		// 2. Check by exact URL/Base64 string (Fallback)
		const currentUrl = previewSkinUrl();
		if (currentUrl) {
			const comparableItem = normalizeSkinComparable(itemUrl);
			const comparableCurrent = normalizeSkinComparable(currentUrl);
			if (comparableItem === comparableCurrent) {
				return true;
			}
		}

		return false;
	};

	const skinHistoryCategories = createMemo(() => {
		const categories = new Set<string>();
		for (const skin of skins()) {
			const cat = (skin.source as any).category;
			if (cat) {
				categories.add(cat);
			}
		}
		// Also include categories from history that aren't in defaults
		for (const item of skinHistory()) {
			if (
				item.source &&
				item.source !== "mojang" &&
				item.source !== "history" &&
				item.source !== "local"
			) {
				categories.add(item.source);
			}
		}
		return Array.from(categories).sort();
	});

	const defaultCategories = createMemo(() =>
		skinHistoryCategories().filter(
			(category) => !category.toLowerCase().includes("event"),
		),
	);

	const eventCategories = createMemo(() =>
		skinHistoryCategories().filter((category) =>
			category.toLowerCase().includes("event"),
		),
	);

	const filteredRecentHistory = createMemo(() => {
		return skinHistory().filter((item) => {
			// Hide if it matches a preset (don't duplicate preset in recent)
			const comparable = normalizeSkinComparable(item.image_data);
			const isPreset = skins().some((skin) => {
				const classic = normalizeSkinComparable(
					getSkinTexture(skin, "classic"),
				);
				const slim = normalizeSkinComparable(getSkinTexture(skin, "slim"));
				return (
					comparable.length > 0 &&
					(comparable === classic || comparable === slim)
				);
			});
			if (isPreset) return false;

			// Don't show in "Recent" if it belongs to a known category (it will show there instead)
			if (
				item.source &&
				item.source !== "mojang" &&
				item.source !== "history" &&
				item.source !== "custom" &&
				item.source !== "local" &&
				item.source !== "preset"
			) {
				return false;
			}

			return true;
		});
	});

	const handlePreviewSkin = async (skin: Skin) => {
		const texture = getSkinTexture(skin, previewVariant());
		setPreviewSkinUrl(texture);
		setPreviewComputedKey(skin.texture_key || null);
	};

	const handlePreviewHistory = (item: SkinHistory) => {
		setPreviewSkinUrl(item.image_data);
		setPreviewVariant(normalizeVariant(item.variant));
		setPreviewComputedKey(item.texture_key);
	};

	const syncActiveSkinWithPreview = () => {
		// Logic now handled by activeSkin memo and previewSkinUrl signal
	};

	const handleUploadSkin = async () => {
		try {
			const file = await open({
				multiple: false,
				filters: [
					{
						name: "Minecraft Skin",
						extensions: ["png", "jpeg", "jpg"],
					},
				],
			});

			if (file) {
				// file.path for v2.0.0-rc+, file for older versions.
				// Based on the error, "file" is already the path string.
				const filePath = typeof file === "string" ? file : (file as any).path;
				const fileData = await readFile(filePath);
				const base64 = btoa(
					new Uint8Array(fileData).reduce(
						(data, byte) => data + String.fromCharCode(byte),
						"",
					),
				);
				const dataUrl = `data:image/png;base64,${base64}`;
				setPreviewSkinUrl(dataUrl);

				// Auto-detect model type for initial preview only.
				// Save still uses whatever the frontend toggle is at save time.
				let detectedVariant: "classic" | "slim" = previewVariant();
				try {
					const detected = await invoke<string>("detect_base64_skin_variant", {
						base64Data: dataUrl,
					});
					detectedVariant = normalizeVariant(detected);
					setPreviewVariant(detectedVariant);
				} catch (e) {
					console.warn(
						"Could not auto-detect uploaded skin variant, keeping current selection",
						e,
					);
				}

				// Add to history preview immediately
				const active = activeAccount();
				if (active) {
					// Compute the authoritative texture_key for the uploaded bytes via backend
					let computedKey: string | null = null;
					try {
						computedKey = await invoke<string>(
							"compute_texture_key_from_base64",
							{ base64Data: dataUrl },
						);
						console.log("uploadSkin: computed texture_key for uploaded file", {
							computedKey,
						});
						setPreviewComputedKey(computedKey);
					} catch (e) {
						console.warn(
							"uploadSkin: failed to compute texture key for upload, falling back to temp key",
							e,
						);
					}

					const tempKey =
						computedKey ??
						(typeof crypto !== "undefined" && "randomUUID" in crypto
							? `temp-${crypto.randomUUID()}`
							: `temp-${Date.now()}-${Math.floor(Math.random() * 1_000_000)}`);
					const tempId = -Math.floor(Math.random() * 1_000_000_000);

					setSkinHistory((prev) => {
						const newEntry: SkinHistory = {
							id: tempId,
							account_uuid: active.uuid,
							texture_key: tempKey,
							name: "Uploaded Skin",
							variant: detectedVariant,
							image_data: dataUrl,
							source: "local",
						};
						// Add to start and dedup by texture_key (prefer authoritative key when available)
						const filtered = prev.filter(
							(h) => h.texture_key !== newEntry.texture_key,
						);
						return [newEntry, ...filtered];
					});
				}
			}
		} catch (err) {
			console.error("Failed to upload skin:", err);
			createNotification({
				title: "Upload Failed",
				description: "Could not read the selected file.",
				notification_type: "immediate",
			});
		}
	};

	createEffect(() => {
		syncActiveSkinWithPreview();
	});

	const handlePreviewCape = async (cape: Cape | null) => {
		if (!cape) {
			setPreviewCapeUrl(null);
			setPreviewCapeComputedKey(null);
			return;
		}

		setPreviewCapeUrl(cape.url);
		// Determine the texture key for selection highlighting
		if (cape.url.startsWith("data:")) {
			try {
				const key = await invoke<string>("compute_texture_key_from_base64", {
					base64Data: cape.url,
				});
				setPreviewCapeComputedKey(key);
			} catch (err) {
				console.error("Failed to compute cape texture key:", err);
				setPreviewCapeComputedKey(null);
			}
		} else {
			try {
				const [key] = await invoke<[string, string]>(
					"compute_texture_key_from_url",
					{
						textureUrl: cape.url,
					},
				);
				setPreviewCapeComputedKey(key);
			} catch (err) {
				console.error("Failed to compute cape texture key from URL:", err);
				setPreviewCapeComputedKey(null);
			}
		}
	};

	const handleSave = async () => {
		const active = activeAccount();
		if (!active || !isDirty()) return;

		setSaving(true);
		try {
			if (previewSkinUrl() !== (active.skin_url || "")) {
				if (previewSkinUrl().startsWith("data:")) {
					const accountName = getAccountDisplayName(active);
					await invoke("upload_account_skin", {
						accountUuid: active.uuid,
						name: `${accountName}_Custom`,
						variant: previewVariant(),
						base64Data: previewSkinUrl(),
					});
				} else {
					await invoke("apply_preset_skin", {
						accountUuid: active.uuid,
						textureUrl: previewSkinUrl(),
						variant: previewVariant(),
						category:
							(activeSkin()?.source as any)?.category ||
							activeSkin()?.source.type ||
							"Preset",
					});
				}
			}

			if (previewCapeUrl() !== (active.cape_url || "")) {
				if (!previewCapeUrl() || previewCapeUrl() === "") {
					await invoke("hide_account_cape", {
						accountUuid: active.uuid,
					});
				} else {
					const selectedCape = capes().find((c) => c.url === previewCapeUrl());
					if (selectedCape) {
						await invoke("change_account_cape", {
							accountUuid: active.uuid,
							capeId: selectedCape.id,
						});
					}
				}
			}

			const res = await invoke<CompleteSkinsResponse>(
				"get_complete_skin_data",
				{ accountUuid: active.uuid },
			);
			setSkins(res.default_skins);
			setSkinHistory(res.recent_history);
			setCapes(
				res.capes.map((c) => ({
					id: c.id,
					name: c.alias || "Cape",
					url: c.url,
				})),
			);

			setPreviewSkinUrl(res.current_skin_base64 || active.skin_url || "");
			setPreviewVariant(
				(res.current_variant as "classic" | "slim") || "classic",
			);
			setPreviewCapeUrl(res.current_cape_base64 || active.cape_url || "");
			setPreviewComputedKey(res.current_skin_id);
			setPreviewCapeComputedKey(res.current_cape_id);

			setSavedSnapshot({
				skinUrl: res.current_skin_base64 || active.skin_url || "",
				capeUrl: res.current_cape_base64 || active.cape_url || null,
				skinKey: res.current_skin_id || null,
				capeKey: res.current_cape_id || null,
				variant: (res.current_variant as "classic" | "slim") || "classic",
			});

			const accs = await invoke<Account[]>("get_accounts");
			setAccounts(accs);
			const updatedAccount = accs.find((a) => a.uuid === active.uuid);
			if (updatedAccount) setActiveAccount(updatedAccount);

			// 4. Refresh sidecar data
			if (active.account_type !== "guest") {
				await Promise.all([]);
			}

			createNotification({
				title: "Account Updated",
				description: "Your skin and cape changes have been saved successfully.",
				notification_type: "immediate",
			});
		} catch (err) {
			console.error("Save failed:", err);
			createNotification({
				title: "Update Failed",
				description: `Failed to save changes: ${err instanceof Error ? err.message : String(err)}`,
				notification_type: "alert",
			});
		} finally {
			setSaving(false);
		}
	};

	const _handleForceSync = async () => {
		const active = activeAccount();
		if (
			!active ||
			active.account_type === "guest" ||
			active.account_type === "demo"
		)
			return;

		setSaving(true);
		try {
			await invoke("force_sync_account_profile", { accountUuid: active.uuid });
			await loadData();
			createNotification({
				title: "Profile Synced",
				description: "Successfully forced a refresh from Mojang.",
				notification_type: "immediate",
			});
		} catch (err) {
			console.error("Force sync failed:", err);
			createNotification({
				title: "Sync Failed",
				description: String(err),
				notification_type: "alert",
			});
		} finally {
			setSaving(false);
		}
	};

	const handleAddAccount = () => {
		router().navigate("/login");
	};

	const selectAccount = async (acc: Account) => {
		setActiveAccount(acc);
		await persistActiveAccount(acc.uuid);
	};

	// Prevent lint errors for unused variables that are planned for future use
	void handleAddAccount;

	const toggleNarrowView = () => {
		setNarrowView((current) => (current === "browse" ? "preview" : "browse"));
	};

	const getAccountDisplayName = (account?: Account | null) => {
		if (!account) return "Select account";
		return (
			account.display_name || account.username || account.name || "Account"
		);
	};

	const renderAccountSwitcher = (triggerClass?: string) => (
		<Select<Account>
			options={accounts()}
			value={activeAccount()}
			onChange={(account) => {
				if (account && account.uuid !== activeAccount()?.uuid) {
					selectAccount(account);
				}
			}}
			optionValue="uuid"
			optionTextValue="uuid"
			itemComponent={(props) => (
				<SelectItem item={props.item} class={styles.accountSelectItem}>
					<div class={styles.accountSelectOption}>
						<ResourceAvatar
							name={getAccountDisplayName(props.item.rawValue)}
							playerUuid={props.item.rawValue.uuid}
							size={20}
							shape="square"
						/>
						<div class={styles.accountSelectText}>
							<span class={styles.accountSelectName}>
								{getAccountDisplayName(props.item.rawValue)}
							</span>
						</div>
					</div>
				</SelectItem>
			)}
		>
			<SelectTrigger class={triggerClass}>
				<SelectValue<Account>>
					{(state) => {
						const selected = state.selectedOption();
						const selectedName = getAccountDisplayName(
							selected || activeAccount(),
						);
						return (
							<div class={styles.accountSelectValue}>
								<ResourceAvatar
									name={selectedName}
									playerUuid={selected?.uuid || activeAccount()?.uuid}
									size={20}
									shape="square"
								/>
								<div class={styles.accountSelectText}>
									<span class={styles.accountSelectName}>{selectedName}</span>
								</div>
							</div>
						);
					}}
				</SelectValue>
			</SelectTrigger>
			<SelectContent />
		</Select>
	);

	const revertChanges = () => {
		const snapshot = savedSnapshot();
		if (!snapshot) return;

		setPreviewSkinUrl(snapshot.skinUrl || "");
		setPreviewCapeUrl(snapshot.capeUrl || null);
		setPreviewVariant(snapshot.variant);

		setPreviewComputedKey(snapshot.skinKey);
		setPreviewCapeComputedKey(snapshot.capeKey);
	};

	const renderSkinCategorySection = (category: string) => {
		const categorySkins = () => {
			const defaults = skins().filter(
				(s) => (s.source as any).category === category,
			);
			const historyPresets = skinHistory()
				.filter((h) => h.source === category)
				.map(
					(h) =>
						({
							texture_key: h.texture_key,
							name: h.name,
							source: {
								type: h.source,
								classic_texture: h.image_data,
								slim_texture: h.image_data,
							},
						}) as any as Skin,
				);

			const combined = [...defaults];
			const seenComparables = new Set<string>();

			for (const existing of combined) {
				const comparable =
					normalizeSkinComparable(getSkinTexture(existing, "classic")) ||
					normalizeSkinComparable(getSkinTexture(existing, "slim"));
				if (comparable) {
					seenComparables.add(comparable);
				}
			}

			for (const h of historyPresets) {
				const comparable =
					normalizeSkinComparable(getSkinTexture(h, "classic")) ||
					normalizeSkinComparable(getSkinTexture(h, "slim"));

				if (comparable && seenComparables.has(comparable)) {
					continue;
				}

				if (comparable) {
					seenComparables.add(comparable);
				}

				combined.push(h);
			}
			return combined;
		};

		return (
			<Show when={categorySkins().length > 0}>
				<section class={styles.contentCard}>
					<div class={styles.cardHeader}>
						<SkinIcon width="20" style="color: var(--primary)" />
						<h2 class={styles.cardTitle} style="text-transform: capitalize;">
							{category} Outfits
						</h2>
					</div>
					<div class={styles.presetsGrid}>
						<For each={categorySkins()}>
							{(skin) => {
								const classicTexture = getSkinTexture(skin, "classic");
								const preferredTexture =
									getSkinTexture(skin, previewVariant()) || classicTexture;

								const isSelected = createMemo(() => {
									return isSkinSelected(preferredTexture, skin.texture_key);
								});

								return (
									<Tooltip placement="top">
										<TooltipTrigger as="div">
											<div
												class={styles.skinItem}
												classList={{
													[styles.selected]: isSelected(),
												}}
												onClick={() => handlePreviewSkin(skin)}
											>
												<SkinPortrait
													src={preferredTexture}
													variant={
														(skin.source as any)?.variant || previewVariant()
													}
												/>
												<Tooltip>
													<TooltipTrigger
														as="button"
														class={styles.viewRawButton}
														onClick={(e) => {
															e.stopPropagation();
															setViewerSrc(preferredTexture);
														}}
														aria-label="View raw texture"
													>
														<ViewIcon width="16" />
													</TooltipTrigger>
													<TooltipContent>View raw texture</TooltipContent>
												</Tooltip>
												<Show when={isSelected()}>
													<span class={styles.selectedBadge}>
														<svg viewBox="0 0 24 24">
															<polyline points="20 6 9 17 4 12" />
														</svg>
													</span>
												</Show>
											</div>
										</TooltipTrigger>
										<TooltipContent>
											{formatTooltipName(
												skin.name || "Default Skin",
												(skin.source as any)?.type,
											)}
										</TooltipContent>
									</Tooltip>
								);
							}}
						</For>
					</div>
				</section>
			</Show>
		);
	};

	return (
		<div class={styles.container}>
			<Show
				when={activeAccount()}
				fallback={<div class={styles.noAccount}>No account connected</div>}
			>
				{(active) => (
					<>
						<Show when={isNarrowLayout()}>
							<div class={styles.viewToolbar}>
								<Show
									when={!isDirty()}
									fallback={
										<div class={styles.toolbarActions}>
											<button
												type="button"
												class={styles.toolbarRevertButton}
												disabled={saving()}
												onClick={revertChanges}
											>
												Revert
											</button>
											<button
												type="button"
												class={styles.toolbarSaveButton}
												disabled={saving()}
												onClick={handleSave}
											>
												<Show when={saving()}>
													<RefreshIcon width="14" class="spin" />
												</Show>
												{saving() ? "Syncing..." : "Apply"}
											</button>
										</div>
									}
								>
									<div class={styles.toolbarAccountSwitcher}>
										{renderAccountSwitcher(styles.toolbarAccountSelect)}
									</div>
								</Show>

								<div class={styles.narrowViewToggle}>
									<Show
										when={!isSingleNarrowToggle()}
										fallback={
											<Tooltip>
												<TooltipTrigger
													as="button"
													type="button"
													class={styles.narrowViewIcon}
													onClick={toggleNarrowView}
													aria-label={`Switch to ${narrowView() === "browse" ? "preview" : "browse"} view`}
												>
													<Show
														when={narrowView() === "browse"}
														fallback={<SkinIcon width="16" height="16" />}
													>
														<ViewIcon width="16" height="16" />
													</Show>
												</TooltipTrigger>
												<TooltipContent>
													{narrowView() === "browse"
														? "Switch to preview"
														: "Switch to browse"}
												</TooltipContent>
											</Tooltip>
										}
									>
										<Tooltip>
											<TooltipTrigger
												as="button"
												type="button"
												class={styles.narrowViewIcon}
												classList={{
													[styles.active]: narrowView() === "browse",
												}}
												onClick={() => setNarrowView("browse")}
												aria-label="Browse skins"
											>
												<ViewIcon width="16" height="16" />
											</TooltipTrigger>
											<TooltipContent>Browse skins</TooltipContent>
										</Tooltip>

										<Tooltip>
											<TooltipTrigger
												as="button"
												type="button"
												class={styles.narrowViewIcon}
												classList={{
													[styles.active]: narrowView() === "preview",
												}}
												onClick={() => setNarrowView("preview")}
												aria-label="Preview"
											>
												<SkinIcon width="16" height="16" />
											</TooltipTrigger>
											<TooltipContent>Preview</TooltipContent>
										</Tooltip>

										<Tooltip>
											<TooltipTrigger
												as="button"
												type="button"
												class={`${styles.narrowViewIcon} ${styles.narrowUploadIcon}`}
												onClick={handleUploadSkin}
												aria-label="Upload custom skin"
											>
												<PlusIcon width="16" height="16" />
											</TooltipTrigger>
											<TooltipContent>Upload custom skin</TooltipContent>
										</Tooltip>
									</Show>
								</div>
							</div>
						</Show>

						<div
							class={styles.leftSection}
							classList={{
								[styles.hiddenOnNarrow]:
									isNarrowLayout() && narrowView() !== "browse",
							}}
						>
							<Tabs
								value={browseTab()}
								onChange={setBrowseTab}
								class={styles.browseTabs}
							>
								<div class={styles.browseTabsHeader}>
									<TabsList class={styles.browseTabsList}>
										<TabsIndicator />
										<TabsTrigger
											class={styles.browseTabsTrigger}
											value="recent"
										>
											Recent
										</TabsTrigger>
										<TabsTrigger
											class={styles.browseTabsTrigger}
											value="defaults"
										>
											Default
										</TabsTrigger>
										<TabsTrigger
											class={styles.browseTabsTrigger}
											value="events"
										>
											Events
										</TabsTrigger>
										<TabsTrigger class={styles.browseTabsTrigger} value="capes">
											Capes
										</TabsTrigger>
									</TabsList>
								</div>

								<TabsContent value="recent">
									<section class={styles.contentCard}>
										<div class={styles.cardHeader}>
											<h2 class={styles.cardTitle}>Recent Skins</h2>
										</div>
										<div class={styles.presetsGrid}>
											<For each={filteredRecentHistory()}>
												{(item) => {
													const selected = createMemo(() =>
														isSkinSelected(item.image_data, item.texture_key),
													);
													return (
														<Tooltip>
															<TooltipTrigger as="div">
																<div
																	class={styles.skinItem}
																	classList={{
																		[styles.selected]: selected(),
																	}}
																	onClick={() => handlePreviewHistory(item)}
																>
																	<SkinPortrait
																		src={item.image_data}
																		variant={item.variant}
																	/>
																	<Tooltip placement="top">
																		<TooltipTrigger
																			as="button"
																			class={styles.viewRawButton}
																			onClick={(e) => {
																				e.stopPropagation();
																				setViewerSrc(item.image_data);
																			}}
																			aria-label="View raw texture"
																		>
																			<ViewIcon width="16" />
																		</TooltipTrigger>
																		<TooltipContent>
																			View raw texture
																		</TooltipContent>
																	</Tooltip>
																	<Show when={selected()}>
																		<span class={styles.selectedBadge}>✓</span>
																	</Show>
																</div>
															</TooltipTrigger>
															<TooltipContent>
																{`${formatTooltipName(item.name, item.source)} (${item.variant})`}
															</TooltipContent>
														</Tooltip>
													);
												}}
											</For>
										</div>
									</section>
								</TabsContent>

								<TabsContent value="defaults">
									<For each={defaultCategories()}>
										{(category) => renderSkinCategorySection(category)}
									</For>
								</TabsContent>

								<TabsContent value="events">
									<For each={eventCategories()}>
										{(category) => renderSkinCategorySection(category)}
									</For>
								</TabsContent>

								<TabsContent value="capes">
									<section class={styles.contentCard}>
										<div class={styles.cardHeader}>
											<CapeIcon width="20" style="color: var(--primary)" />
											<h2 class={styles.cardTitle}>Capes & Accessories</h2>
										</div>
										<div class={styles.capesGrid}>
											<button
												class={styles.capeItem}
												classList={{
													[styles.selected]:
														!previewCapeUrl() || previewCapeUrl() === "",
												}}
												onClick={() => handlePreviewCape(null)}
											>
												<span class={styles.noneLabel}>NONE</span>
												<Show when={!previewCapeUrl()}>
													<span class={styles.selectedBadge}>
														<svg viewBox="0 0 24 24">
															<polyline points="20 6 9 17 4 12" />
														</svg>
													</span>
												</Show>
											</button>
											<For each={capes()}>
												{(cape) => {
													const [presetKey, setPresetKey] = createSignal<
														string | null
													>(null);

													createEffect(async () => {
														if (cape.url.startsWith("data:")) {
															try {
																const key = await invoke<string>(
																	"compute_texture_key_from_base64",
																	{
																		base64Data: cape.url,
																	},
																);
																setPresetKey(key);
															} catch {}
														} else {
															try {
																const [key] = await invoke<[string, string]>(
																	"compute_texture_key_from_url",
																	{
																		textureUrl: cape.url,
																	},
																);
																setPresetKey(key);
															} catch {}
														}
													});

													const isSelected = createMemo(() => {
														const currentKey = previewCapeComputedKey();
														const myKey = presetKey();
														if (currentKey && myKey && currentKey === myKey)
															return true;
														return (
															normalizeSkinComparable(
																previewCapeUrl() || "",
															) === normalizeSkinComparable(cape.url)
														);
													});

													return (
														<Tooltip>
															<TooltipTrigger
																as="button"
																class={styles.capeItem}
																style={{
																	"background-image": `url(${cape.url})`,
																}}
																classList={{
																	[styles.selected]: isSelected(),
																}}
																onClick={() => handlePreviewCape(cape)}
																aria-label={cape.name}
															>
																<Show when={isSelected()}>
																	<span class={styles.selectedBadge}>
																		<svg viewBox="0 0 24 24">
																			<polyline points="20 6 9 17 4 12" />
																		</svg>
																	</span>
																</Show>
															</TooltipTrigger>
															<TooltipContent>{cape.name}</TooltipContent>
														</Tooltip>
													);
												}}
											</For>
										</div>
									</section>
								</TabsContent>
							</Tabs>
						</div>

						<aside
							class={styles.visualizerSidebar}
							classList={{
								[styles.hiddenOnNarrow]:
									isNarrowLayout() && narrowView() !== "preview",
							}}
						>
							<Show when={isDirty() && !isNarrowLayout()}>
								<section
									class={styles.actionCard}
									classList={{
										[styles.compactActionCard]: compactActionMode(),
									}}
								>
									<div class={styles.actionButtonsRow}>
										<button
											type="button"
											class={styles.revertButton}
											disabled={saving()}
											onClick={revertChanges}
										>
											Revert
										</button>
										<button
											type="button"
											class={styles.saveButton}
											disabled={saving()}
											onClick={handleSave}
										>
											<Show when={saving()}>
												<RefreshIcon width="18" class="spin" />
											</Show>
											{saving() ? "Syncing..." : "Apply Changes"}
										</button>
									</div>
								</section>
							</Show>

							<Show when={!isDirty() && !isNarrowLayout()}>
								<section>
									{renderAccountSwitcher(styles.accountSwitcherSelect)}
								</section>
							</Show>

							<section class={styles.visualizerCard}>
								<Show when={!isNarrowLayout()}>
									<Tooltip>
										<TooltipTrigger
											as="button"
											type="button"
											class={`${styles.uploadSkinButton} ${styles.floatingUploadButton}`}
											onClick={handleUploadSkin}
											aria-label="Upload custom skin"
										>
											<PlusIcon width="18" />
										</TooltipTrigger>
										<TooltipContent>Upload custom skin</TooltipContent>
									</Tooltip>
								</Show>

								<div class={styles.visualizerWrapper}>
									<SkinView3d
										skinUrl={previewSkinUrl() || undefined}
										capeUrl={previewCapeUrl() || ""}
										model={previewVariant()}
										animation="walking"
										animationSpeed={0.5}
										enableZoom={false}
									/>
								</div>

								<div class={styles.modelToggle}>
									<button
										type="button"
										class={styles.toggleBtn}
										classList={{
											[styles.active]: previewVariant() === "classic",
										}}
										onClick={() => {
											setPreviewVariant("classic");
											const skin = activeSkin();
											if (
												skin &&
												skin.source?.type === "default" &&
												skin.source.classic_texture &&
												skin.source.slim_texture
											) {
												setPreviewSkinUrl(getSkinTexture(skin, "classic"));
											}
										}}
									>
										Classic
									</button>
									<button
										type="button"
										class={styles.toggleBtn}
										classList={{ [styles.active]: previewVariant() === "slim" }}
										onClick={() => {
											setPreviewVariant("slim");
											const skin = activeSkin();
											if (
												skin &&
												skin.source?.type === "default" &&
												skin.source.classic_texture &&
												skin.source.slim_texture
											) {
												setPreviewSkinUrl(getSkinTexture(skin, "slim"));
											}
										}}
									>
										Slim
									</button>
								</div>
							</section>
						</aside>
					</>
				)}
			</Show>
			<ImageViewer
				src={viewerSrc()}
				onClose={() => setViewerSrc(null)}
				title="Skin Texture Preview"
				scale={4}
				pixelated={true}
			/>
		</div>
	);
}
