import { createSignal, Show, onMount, onCleanup, createEffect, For } from "solid-js";
import { Dialog, DialogContent, DialogOverlay } from "@ui/dialog/dialog";
import Button from "@ui/button/button";
import { 
	Carousel, 
	CarouselContent, 
	CarouselItem, 
	CarouselNext, 
	CarouselPrevious,
	type CarouselApi
} from "@ui/carousel/carousel";
import styles from "./image-viewer.module.css";
import CloseIcon from "@assets/close.svg";
import CopyIcon from "@assets/clipboard.svg";
import FolderIcon from "@assets/folder.svg";
import ZoomInIcon from "@assets/search.svg";
import DownloadIcon from "@assets/open.svg";
import TrashIcon from "@assets/trash.svg";

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
}

export function ImageViewer(props: ImageViewerProps) {
	const [isZoomed, setIsZoomed] = createSignal(false);
	const [hasError, setHasError] = createSignal(false);
	const [api, setApi] = createSignal<CarouselApi>();
	const [currentIndex, setCurrentIndex] = createSignal(0);
	const [showUI, setShowUI] = createSignal(true);

	let idleTimer: number;

	const handleMouseMove = () => {
		setShowUI(true);
		window.clearTimeout(idleTimer);
		idleTimer = window.setTimeout(() => {
			setShowUI(false);
		}, 3000) as unknown as number;
	};

	const handleKeyDown = (e: KeyboardEvent) => {
		if (e.key === "Escape") {
			props.onClose();
		}
	};

	// Determine effective images list
	const imageList = () => {
		if (props.images && props.images.length > 0) {
			return props.images;
		}
		if (props.src) {
			return [{ src: props.src, title: props.title || "", date: props.date }];
		}
		return [];
	};

	// Sync currentIndex with carousel
	createEffect(() => {
		const embla = api()?.();
		if (!embla) return;

		const onSelect = () => {
			setCurrentIndex(embla.selectedScrollSnap());
		};

		embla.on("select", onSelect);
		onCleanup(() => embla.off("select", onSelect));
	});

	// Jump to clicked image if images list is provided
	createEffect(() => {
		if (props.src && props.images && api()) {
			const index = props.images.findIndex(img => img.src === props.src);
			if (index !== -1) {
				api()?.().scrollTo(index, true);
			}
		}
	});

	createEffect(() => {
		if (props.src || imageList().length > 0) {
			setHasError(false);
		}
	});

	onMount(() => {
		window.addEventListener("keydown", handleKeyDown);
	});

	onCleanup(() => {
		window.removeEventListener("keydown", handleKeyDown);
	});

	const toggleZoom = (e: MouseEvent) => {
		e.stopPropagation();
		if (!isZoomed()) {
			const target = e.currentTarget as HTMLElement;
			const img = target.querySelector("img");
			if (img) {
				const rect = img.getBoundingClientRect();
				// Calculate percentage relative to the image itself
				const x = ((e.clientX - rect.left) / rect.width) * 100;
				const y = ((e.clientY - rect.top) / rect.height) * 100;
				img.style.setProperty("--zoom-x", `${x}%`);
				img.style.setProperty("--zoom-y", `${y}%`);
			}
		}
		setIsZoomed(!isZoomed());
	};

	return (
		<Dialog open={!!props.src || (props.images && props.images.length > 0 && !!props.src)} onOpenChange={(open) => !open && props.onClose()}>
			<DialogContent 
				class={styles.content} 
				hideCloseButton
				onMouseMove={handleMouseMove}
				onMouseLeave={() => !isZoomed() && setShowUI(false)}
			>
				<div 
					class={styles.header}
					classList={{ [styles.hidden]: !showUI() }}
				>
					<div class={styles.info}>
						<span class={styles.title}>
							{imageList()[currentIndex()]?.title || props.title || "Image Viewer"}
						</span>
						<Show when={imageList()[currentIndex()]?.date}>
							<span class={styles.date}>{imageList()[currentIndex()]?.date}</span>
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
					<Carousel 
						setApi={setApi} 
						class={styles.carousel} 
						opts={{ 
							loop: true,
							watchDrag: !isZoomed()
						}}
					>
						<CarouselContent class={styles.carouselContent}>
							<For each={imageList()}>
								{(image, index) => (
									<CarouselItem class={styles.carouselItem}>
										<div 
											class={styles.slideContent}
											onClick={props.onClose}
										>
											<Show when={!hasError() || currentIndex() !== index()} fallback={
												<div class={styles.errorContainer}>
													<svg xmlns="http://www.w3.org/2000/svg" width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
														<circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/>
													</svg>
													<p>Failed to load image</p>
													<span class={styles.errorPath}>{image.src}</span>
												</div>
											}>
												<div
													class={styles.imageContainer}
													classList={{ [styles.zoomed]: isZoomed() && currentIndex() === index() }}
													onClick={(e) => toggleZoom(e)}
												>
													<img
														src={image.src}
														alt={image.title}
														classList={{ [styles.zoomedImg]: isZoomed() && currentIndex() === index() }}
														draggable={false}
														onError={() => currentIndex() === index() && setHasError(true)}
													/>
												</div>
											</Show>
										</div>
									</CarouselItem>
								)}
							</For>
						</CarouselContent>
						<Show when={imageList().length > 1}>
							<CarouselPrevious 
								class={`${styles.navBtn} ${styles.navBtnPrev} ${!showUI() ? styles.hidden : ""}`}
							/>
							<CarouselNext 
								class={`${styles.navBtn} ${styles.navBtnNext} ${!showUI() ? styles.hidden : ""}`}
							/>
						</Show>
					</Carousel>
				</div>

				<div 
					class={styles.footer}
					classList={{ [styles.hidden]: !showUI() }}
				>
					<Show when={imageList().length > 1}>
						<span class={styles.counter}>{currentIndex() + 1} / {imageList().length}</span>
					</Show>
					<span>Click to {isZoomed() ? "Reset" : "Zoom"}</span>
				</div>
			</DialogContent>
		</Dialog>
	);
}
