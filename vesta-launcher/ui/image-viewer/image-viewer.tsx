import CopyIcon from "@assets/clipboard.svg";
import CloseIcon from "@assets/close.svg";
import FolderIcon from "@assets/folder.svg";
import DownloadIcon from "@assets/open.svg";
import TrashIcon from "@assets/trash.svg";
import Button from "@ui/button/button";
import { Dialog, DialogContent } from "@ui/dialog/dialog";
import useEmblaCarousel from "embla-carousel-solid";
import { createEffect, createMemo, createSignal, For, onCleanup, Show } from "solid-js";
import styles from "./image-viewer.module.css";

interface ImageViewerProps {
	src: string | null;
	title?: string;
	date?: string;
	onClose: () => void;
	onCopy?: (src: string) => void;
	onDelete?: (src: string) => void;
	onDownload?: (src: string) => void;
	onOpenFolder?: (src: string) => void;
	// New props for carousel mode
	images?: { src: string; title: string; date?: string }[];
	showDelete?: boolean;
	scale?: number;
	pixelated?: boolean;
}

const UI_IDLE_TIMEOUT_MS = 3500;
const DEFAULT_ZOOM_ORIGIN = { x: "50%", y: "50%" };
const ZOOM_MULTIPLIER = 2.2;
const WHEEL_NAV_THRESHOLD = 20;
const WHEEL_NAV_COOLDOWN_MS = 220;
const WHEEL_LINE_PX = 16;
const PAN_SENSITIVITY = 0.85;
const MAX_WHEEL_PAN_STEP = 120;

export function ImageViewer(props: ImageViewerProps) {
	const [isZoomed, setIsZoomed] = createSignal(false);
	const [hasError, setHasError] = createSignal(false);
	const [carouselRef, api] = useEmblaCarousel(() => ({
		loop: true,
		watchDrag: !isZoomed(),
	}));
	const [currentIndex, setCurrentIndex] = createSignal(0);
	const [showUI, setShowUI] = createSignal(true);
	const [zoomOrigin, setZoomOrigin] = createSignal(DEFAULT_ZOOM_ORIGIN);
	const [isControlHovered, setIsControlHovered] = createSignal(false);
	const [panOffset, setPanOffset] = createSignal({ x: 0, y: 0 });
	const [isDraggingImage, setIsDraggingImage] = createSignal(false);

	let idleTimer: number | undefined;
	let lastWheelNavAt = 0;
	let activePanPointerId: number | null = null;
	let dragStartPointer = { x: 0, y: 0 };
	let dragStartPan = { x: 0, y: 0 };
	let suppressNextImageClick = false;

	const clearIdleTimer = () => {
		if (idleTimer !== undefined) {
			window.clearTimeout(idleTimer);
			idleTimer = undefined;
		}
	};

	const scheduleUIHide = () => {
		clearIdleTimer();
		idleTimer = window.setTimeout(() => {
			if (!isControlHovered()) {
				setShowUI(false);
			}
		}, UI_IDLE_TIMEOUT_MS);
	};

	const resetZoom = () => {
		setZoomOrigin(DEFAULT_ZOOM_ORIGIN);
		setPanOffset({ x: 0, y: 0 });
		setIsDraggingImage(false);
		activePanPointerId = null;
		suppressNextImageClick = false;
		setIsZoomed(false);
	};

	const revealUI = () => {
		setShowUI(true);
		if (isOpen()) {
			scheduleUIHide();
		}
	};

	const handleControlHoverStart = () => {
		setIsControlHovered(true);
		setShowUI(true);
		clearIdleTimer();
	};

	const handleControlHoverEnd = () => {
		setIsControlHovered(false);
		scheduleUIHide();
	};

	const handleControlBlur = (e: FocusEvent) => {
		const nextTarget = e.relatedTarget as Node | null;
		const container = e.currentTarget as HTMLElement;
		if (!nextTarget || !container.contains(nextTarget)) {
			handleControlHoverEnd();
		}
	};

	const handleKeyDown = (e: KeyboardEvent) => {
		revealUI();
		if (e.key === "Escape") {
			props.onClose();
			return;
		}

		if (imageList().length <= 1) {
			return;
		}

		if (e.key === "ArrowLeft") {
			e.preventDefault();
			api()?.scrollPrev();
			return;
		}

		if (e.key === "ArrowRight") {
			e.preventDefault();
			api()?.scrollNext();
		}
	};

	// Determine effective images list
	const imageList = createMemo(() => {
		if (props.images && props.images.length > 0) {
			return props.images;
		}
		if (props.src) {
			return [{ src: props.src, title: props.title || "", date: props.date }];
		}
		return [];
	});
	const isOpen = createMemo(() => !!props.src);
	const currentImage = createMemo(() => imageList()[currentIndex()]);

	// Sync currentIndex with carousel
	createEffect(() => {
		const emblaApi = api();
		if (!emblaApi) return;

		const onSelect = () => {
			setCurrentIndex(emblaApi.selectedScrollSnap());
			resetZoom();
			setHasError(false);
		};

		emblaApi.on("select", onSelect);
		onSelect();
		onCleanup(() => emblaApi.off("select", onSelect));
	});

	// Jump to clicked image if images list is provided
	createEffect(() => {
		const emblaApi = api();
		if (emblaApi && props.src && props.images) {
			const index = props.images.findIndex((img) => img.src === props.src);
			if (index !== -1 && emblaApi.selectedScrollSnap() !== index) {
				emblaApi.scrollTo(index);
			}
		}
	});

	createEffect(() => {
		if (isOpen()) {
			revealUI();
		}

		if (props.src || imageList().length > 0) {
			setHasError(false);
			resetZoom();
		}
	});

	createEffect(() => {
		if (!isOpen()) {
			clearIdleTimer();
			setIsControlHovered(false);
			setShowUI(true);
			return;
		}

		window.addEventListener("keydown", handleKeyDown);
		window.addEventListener("pointerdown", revealUI, true);

		onCleanup(() => {
			window.removeEventListener("keydown", handleKeyDown);
			window.removeEventListener("pointerdown", revealUI, true);
			clearIdleTimer();
		});
	});

	onCleanup(() => {
		clearIdleTimer();
	});

	const handleBackgroundClick = (index: number) => {
		revealUI();
		if (isZoomed() && currentIndex() === index) {
			resetZoom();
			return;
		}
		props.onClose();
	};

	const handleImageClick = (e: MouseEvent, index: number) => {
		e.stopPropagation();
		revealUI();

		if (suppressNextImageClick) {
			suppressNextImageClick = false;
			return;
		}

		if (isZoomed() && currentIndex() === index) {
			resetZoom();
			return;
		}

		const img = e.currentTarget as HTMLImageElement;
		const rect = img.getBoundingClientRect();
		if (rect.width > 0 && rect.height > 0) {
			const x = ((e.clientX - rect.left) / rect.width) * 100;
			const y = ((e.clientY - rect.top) / rect.height) * 100;
			setZoomOrigin({ x: `${x}%`, y: `${y}%` });
		}

		if (!isZoomed() || currentIndex() !== index) {
			setCurrentIndex(index);
			setPanOffset({ x: 0, y: 0 });
			setIsZoomed(true);
		}
	};

	const getPanBounds = (container: HTMLElement, img: HTMLImageElement) => {
		const imageScale = props.scale || 1;
		const zoomScale = imageScale * ZOOM_MULTIPLIER;
		const scaledWidth = img.clientWidth * zoomScale;
		const scaledHeight = img.clientHeight * zoomScale;
		return {
			maxPanX: Math.max(0, (scaledWidth - container.clientWidth) / 2),
			maxPanY: Math.max(0, (scaledHeight - container.clientHeight) / 2),
		};
	};

	const clampPan = (
		nextX: number,
		nextY: number,
		bounds: { maxPanX: number; maxPanY: number },
	) => ({
		x: Math.min(bounds.maxPanX, Math.max(-bounds.maxPanX, nextX)),
		y: Math.min(bounds.maxPanY, Math.max(-bounds.maxPanY, nextY)),
	});

	const handleImagePointerDown = (e: PointerEvent, index: number) => {
		e.stopPropagation();
		revealUI();

		if (!isZoomed() || currentIndex() !== index) {
			return;
		}

		const img = e.currentTarget as HTMLImageElement;
		activePanPointerId = e.pointerId;
		dragStartPointer = { x: e.clientX, y: e.clientY };
		dragStartPan = panOffset();
		suppressNextImageClick = false;
		setIsDraggingImage(true);
		img.setPointerCapture(e.pointerId);
		e.preventDefault();
	};

	const handleImagePointerMove = (e: PointerEvent, index: number) => {
		if (
			!isDraggingImage() ||
			activePanPointerId !== e.pointerId ||
			!isZoomed() ||
			currentIndex() !== index
		) {
			return;
		}

		e.stopPropagation();
		revealUI();

		const img = e.currentTarget as HTMLImageElement;
		const container = img.parentElement;
		if (!container) {
			return;
		}

		const deltaX = e.clientX - dragStartPointer.x;
		const deltaY = e.clientY - dragStartPointer.y;
		if (!suppressNextImageClick && (Math.abs(deltaX) > 3 || Math.abs(deltaY) > 3)) {
			suppressNextImageClick = true;
		}

		const bounds = getPanBounds(container, img);
		setPanOffset(
			clampPan(dragStartPan.x + deltaX, dragStartPan.y + deltaY, bounds),
		);
	};

	const handleImagePointerEnd = (e: PointerEvent) => {
		if (activePanPointerId !== e.pointerId) {
			return;
		}

		const img = e.currentTarget as HTMLImageElement;
		if (img.hasPointerCapture(e.pointerId)) {
			img.releasePointerCapture(e.pointerId);
		}

		activePanPointerId = null;
		setIsDraggingImage(false);
	};

	const normalizeWheelDelta = (
		delta: number,
		deltaMode: number,
		viewportSize: number,
	) => {
		let normalized = delta;
		if (deltaMode === 1) {
			normalized *= WHEEL_LINE_PX;
		} else if (deltaMode === 2) {
			normalized *= viewportSize;
		}

		if (normalized > MAX_WHEEL_PAN_STEP) {
			return MAX_WHEEL_PAN_STEP;
		}
		if (normalized < -MAX_WHEEL_PAN_STEP) {
			return -MAX_WHEEL_PAN_STEP;
		}

		return normalized;
	};

	const handleSlideWheel = (e: WheelEvent, index: number) => {
		revealUI();
		if (e.ctrlKey) {
			return;
		}

		if (isZoomed() && currentIndex() === index) {
			e.preventDefault();
			const container = e.currentTarget as HTMLElement;
			const img = container.querySelector("img");
			if (!img) {
				return;
			}

			const bounds = getPanBounds(container, img);

			const deltaX = normalizeWheelDelta(
				e.deltaX,
				e.deltaMode,
				container.clientWidth,
			);
			const deltaY = normalizeWheelDelta(
				e.deltaY,
				e.deltaMode,
				container.clientHeight,
			);

			setPanOffset((prev) => ({
				...clampPan(
					prev.x - deltaX * PAN_SENSITIVITY,
					prev.y - deltaY * PAN_SENSITIVITY,
					bounds,
				),
			}));
			return;
		}

		if (imageList().length <= 1) {
			return;
		}

		const horizontalDelta =
			Math.abs(e.deltaX) >= Math.abs(e.deltaY)
				? e.deltaX
				: e.shiftKey
					? e.deltaY
					: 0;

		if (Math.abs(horizontalDelta) < WHEEL_NAV_THRESHOLD) {
			return;
		}

		const now = Date.now();
		if (now - lastWheelNavAt < WHEEL_NAV_COOLDOWN_MS) {
			return;
		}

		e.preventDefault();
		lastWheelNavAt = now;

		if (horizontalDelta > 0) {
			api()?.scrollNext();
		} else {
			api()?.scrollPrev();
		}
	};

	return (
		<Dialog open={isOpen()} onOpenChange={(open) => !open && props.onClose()}>
			<DialogContent
				class={styles.content}
				hideCloseButton
				onPointerMove={revealUI}
				onMouseLeave={() => !isZoomed() && !isControlHovered() && setShowUI(false)}
			>
				<div
					class={styles.header}
					classList={{ [styles.hidden]: !showUI() }}
					onMouseEnter={handleControlHoverStart}
					onMouseLeave={handleControlHoverEnd}
					onFocusIn={handleControlHoverStart}
					onFocusOut={handleControlBlur}
				>
					<div class={styles.info}>
						<span class={styles.title}>
							{currentImage()?.title || props.title || "Image Viewer"}
						</span>
						<Show when={currentImage()?.date}>
							<span class={styles.date}>{currentImage()?.date}</span>
						</Show>
					</div>
					<div class={styles.actions}>
						<Show when={props.onCopy}>
							<Button
								variant="ghost"
								size="sm"
								onClick={(e) => {
									e.stopPropagation();
									const current = imageList()[currentIndex()];
									if (current) props.onCopy?.(current.src);
								}}
								tooltip_text="Copy"
							>
								<CopyIcon />
							</Button>
						</Show>
						<Show when={props.onDownload}>
							<Button
								variant="ghost"
								size="sm"
								onClick={(e) => {
									e.stopPropagation();
									const current = imageList()[currentIndex()];
									if (current) props.onDownload?.(current.src);
								}}
								tooltip_text="Download"
							>
								<DownloadIcon />
							</Button>
						</Show>
						<Show when={props.onOpenFolder}>
							<Button
								variant="ghost"
								size="sm"
								onClick={(e) => {
									e.stopPropagation();
									const current = imageList()[currentIndex()];
									if (current) props.onOpenFolder?.(current.src);
								}}
								tooltip_text="Open Folder"
							>
								<FolderIcon />
							</Button>
						</Show>
						<Show when={props.onDelete && props.showDelete !== false}>
							<Button
								variant="ghost"
								size="sm"
								color="destructive"
								onClick={(e) => {
									e.stopPropagation();
									const current = imageList()[currentIndex()];
									if (current) props.onDelete?.(current.src);
								}}
								tooltip_text="Delete"
							>
								<TrashIcon />
							</Button>
						</Show>
						<Button
							variant="ghost"
							size="sm"
							onClick={(e) => {
								e.stopPropagation();
								props.onClose();
							}}
							class={styles.closeBtn}
						>
							<CloseIcon />
						</Button>
					</div>
				</div>

				<div class={styles.viewport}>
					<div ref={carouselRef} class={styles.carousel}>
						<div class={styles.carouselContent}>
							<For each={imageList()}>
								{(image, index) => (
									<div class={styles.carouselItem}>
										<div
											class={styles.slideContent}
											onClick={() => handleBackgroundClick(index())}
											onWheel={(e) => handleSlideWheel(e, index())}
										>
											<Show
												when={!hasError() || currentIndex() !== index()}
												fallback={
													<div class={styles.errorContainer}>
														<svg
															xmlns="http://www.w3.org/2000/svg"
															width="48"
															height="48"
															viewBox="0 0 24 24"
															fill="none"
															stroke="currentColor"
															stroke-width="2"
															stroke-linecap="round"
															stroke-linejoin="round"
														>
															<circle cx="12" cy="12" r="10" />
															<line x1="12" y1="8" x2="12" y2="12" />
															<line x1="12" y1="16" x2="12.01" y2="16" />
														</svg>
														<p>Failed to load image</p>
														<span class={styles.errorPath}>{image.src}</span>
													</div>
												}
											>
												<div
													class={styles.imageContainer}
													classList={{
														[styles.zoomed]:
															isZoomed() && currentIndex() === index(),
																		[styles.panned]:
																			isZoomed() &&
																			currentIndex() === index() &&
																			(Math.abs(panOffset().x) > 1 || Math.abs(panOffset().y) > 1),
																		[styles.dragging]:
																			isZoomed() &&
																			currentIndex() === index() &&
																			isDraggingImage(),
													}}
												>
													<img
														src={image.src}
														alt={image.title}
																		onPointerDown={(e) => handleImagePointerDown(e, index())}
																		onPointerMove={(e) => handleImagePointerMove(e, index())}
																		onPointerUp={handleImagePointerEnd}
																		onPointerCancel={handleImagePointerEnd}
														onClick={(e) => handleImageClick(e, index())}
														classList={{
															[styles.zoomedImg]:
																isZoomed() && currentIndex() === index(),
														}}
														style={{
															"--image-scale": props.scale || 1,
																"--pan-x":
																	currentIndex() === index()
																		? `${panOffset().x}px`
																		: "0px",
																"--pan-y":
																	currentIndex() === index()
																		? `${panOffset().y}px`
																		: "0px",
															"--zoom-x":
																currentIndex() === index()
																	? zoomOrigin().x
																	: DEFAULT_ZOOM_ORIGIN.x,
															"--zoom-y":
																currentIndex() === index()
																	? zoomOrigin().y
																	: DEFAULT_ZOOM_ORIGIN.y,
															"image-rendering": props.pixelated
																? "pixelated"
																: "auto",
														}}
														draggable={false}
														onError={() =>
															currentIndex() === index() && setHasError(true)
														}
													/>
												</div>
											</Show>
										</div>
									</div>
								)}
							</For>
						</div>
						<Show when={imageList().length > 1}>
							<button
								type="button"
								aria-label="Previous image"
								class={`${styles.navBtn} ${styles.navBtnPrev} ${!showUI() ? styles.hidden : ""}`}
								onMouseEnter={handleControlHoverStart}
								onMouseLeave={handleControlHoverEnd}
								onFocus={handleControlHoverStart}
								onBlur={handleControlHoverEnd}
								onClick={(e) => {
									e.stopPropagation();
									revealUI();
									api()?.scrollPrev();
								}}
							>
								<svg
									xmlns="http://www.w3.org/2000/svg"
									viewBox="0 0 24 24"
									fill="none"
									stroke="currentColor"
									stroke-width="2"
									stroke-linecap="round"
									stroke-linejoin="round"
								>
									<path d="M15 18l-6-6 6-6" />
								</svg>
							</button>
							<button
								type="button"
								aria-label="Next image"
								class={`${styles.navBtn} ${styles.navBtnNext} ${!showUI() ? styles.hidden : ""}`}
								onMouseEnter={handleControlHoverStart}
								onMouseLeave={handleControlHoverEnd}
								onFocus={handleControlHoverStart}
								onBlur={handleControlHoverEnd}
								onClick={(e) => {
									e.stopPropagation();
									revealUI();
									api()?.scrollNext();
								}}
							>
								<svg
									xmlns="http://www.w3.org/2000/svg"
									viewBox="0 0 24 24"
									fill="none"
									stroke="currentColor"
									stroke-width="2"
									stroke-linecap="round"
									stroke-linejoin="round"
								>
									<path d="M9 18l6-6-6-6" />
								</svg>
							</button>
						</Show>
					</div>
				</div>

				<div
					class={styles.footer}
					classList={{ [styles.hidden]: !showUI() }}
					onMouseEnter={handleControlHoverStart}
					onMouseLeave={handleControlHoverEnd}
					onFocusIn={handleControlHoverStart}
					onFocusOut={handleControlBlur}
				>
					<Show when={imageList().length > 1}>
						<span class={styles.counter}>
							{currentIndex() + 1} / {imageList().length}
						</span>
					</Show>
					<span>Click to {isZoomed() ? "Reset" : "Zoom"}</span>
				</div>
			</DialogContent>
		</Dialog>
	);
}
