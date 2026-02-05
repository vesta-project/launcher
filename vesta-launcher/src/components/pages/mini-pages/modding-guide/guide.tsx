import { Component, For } from "solid-js";
import { HELP_CONTENT } from "../../../../utils/help-content";
import { Separator } from "@ui/separator/separator";
import styles from "./modding-guide.module.css";

export const ModdingGuideContent: Component = () => {
	const modloaders = [
		HELP_CONTENT.MODLOADER_EXPLAINED,
		HELP_CONTENT.MODLOADER_FORGE,
		HELP_CONTENT.MODLOADER_FABRIC,
		HELP_CONTENT.MODLOADER_NEOFORGE,
		HELP_CONTENT.MODLOADER_QUILT,
	];

	return (
		<div class={styles.container}>
			<section class={styles.section_visual}>
				<div class={styles.visual_text}>
					<h2 class={styles.section_title}>How Modding Works</h2>
					<p class={styles.section_subtitle}>
						Minecraft runs on a software called Java. Since the game wasn't
						originally designed to be modified, player-made additions (Mods)
						require a "Modloader" to help the game recognize and run them
						correctly.
					</p>
					<div class={styles.tech_list}>
						<div class={styles.tech_item}>
							<span class={styles.tech_dot}></span>
							<span>A Modloader connects player-made content to the game</span>
						</div>
						<div class={styles.tech_item}>
							<span class={styles.tech_dot}></span>
							<span>
								Vesta automatically installs the version of Java the game needs
							</span>
						</div>
					</div>
				</div>
				<div class={styles.visual_side}>
					<div class={styles.main_illustration}>
						<div class={styles.img_box_large}>
							<svg
								width="100%"
								height="100%"
								viewBox="0 0 400 240"
								preserveAspectRatio="xMidYMid meet"
								xmlns="http://www.w3.org/2000/svg"
							>
								{/* Connection Lines */}
								<path
									d="M200 60 V100"
									stroke="var(--primary)"
									stroke-width="2"
									stroke-dasharray="4"
									opacity="0.3"
								/>
								<path
									d="M100 60 V100"
									stroke="var(--primary)"
									stroke-width="2"
									stroke-dasharray="4"
									opacity="0.3"
								/>
								<path
									d="M300 60 V100"
									stroke="var(--primary)"
									stroke-width="2"
									stroke-dasharray="4"
									opacity="0.3"
								/>
								<path
									d="M200 150 V180"
									stroke="var(--primary)"
									stroke-width="2"
									opacity="0.5"
								/>

								{/* Top Layer: Mods */}
								<rect
									x="65"
									y="25"
									width="70"
									height="35"
									rx="4"
									fill="hsla(var(--accent-base) / 0.1)"
									stroke="var(--border-subtle)"
									stroke-width="1"
								/>
								<text
									x="100"
									y="47"
									font-family="Inter, sans-serif"
									font-size="10"
									font-weight="600"
									fill="var(--text-primary)"
									text-anchor="middle"
								>
									Mod A
								</text>

								<rect
									x="165"
									y="25"
									width="70"
									height="35"
									rx="4"
									fill="hsla(var(--accent-base) / 0.1)"
									stroke="var(--border-subtle)"
									stroke-width="1"
								/>
								<text
									x="200"
									y="47"
									font-family="Inter, sans-serif"
									font-size="10"
									font-weight="600"
									fill="var(--text-primary)"
									text-anchor="middle"
								>
									Mod B
								</text>

								<rect
									x="265"
									y="25"
									width="70"
									height="35"
									rx="4"
									fill="hsla(var(--accent-base) / 0.1)"
									stroke="var(--border-subtle)"
									stroke-width="1"
								/>
								<text
									x="300"
									y="47"
									font-family="Inter, sans-serif"
									font-size="10"
									font-weight="600"
									fill="var(--text-primary)"
									text-anchor="middle"
								>
									Mod C
								</text>

								{/* Middle Layer: Modloader */}
								<rect
									x="40"
									y="100"
									width="320"
									height="50"
									rx="6"
									fill="hsla(var(--accent-base) / 0.15)"
									stroke="var(--primary)"
									stroke-width="2"
								/>
								<text
									x="200"
									y="125"
									font-family="Inter, sans-serif"
									font-size="14"
									font-weight="700"
									fill="var(--primary)"
									text-anchor="middle"
								>
									Modloader
								</text>
								<text
									x="200"
									y="140"
									font-family="Inter, sans-serif"
									font-size="9"
									font-weight="500"
									fill="var(--primary)"
									text-anchor="middle"
									opacity="0.9"
								>
									(Connecting Software)
								</text>

								{/* Bottom Layer: Minecraft */}
								<rect
									x="60"
									y="180"
									width="280"
									height="40"
									rx="4"
									fill="hsla(var(--accent-base) / 0.05)"
									stroke="var(--border-subtle)"
									stroke-width="1"
								/>
								<text
									x="200"
									y="205"
									font-family="Inter, sans-serif"
									font-size="12"
									font-weight="600"
									fill="var(--text-primary)"
									text-anchor="middle"
									opacity="0.8"
								>
									Minecraft (Base Game)
								</text>
							</svg>
						</div>
					</div>
				</div>
			</section>

			<section class={styles.section}>
				<h2 class={styles.section_title}>
					{HELP_CONTENT.MODPACKS_CONCEPT.title}
				</h2>
				<p class={styles.section_subtitle}>
					{HELP_CONTENT.MODPACKS_CONCEPT.description}
				</p>
			</section>

			<section class={styles.section}>
				<h2 class={styles.section_title}>Available Modloaders</h2>
				<div class={styles.comparison_grid}>
					<For each={modloaders.slice(1)}>
						{(loader) => (
							<div class={styles.loader_card}>
								<div class={styles.loader_header}>
									<h3 class={styles.loader_name}>{loader.title}</h3>
								</div>
								<Separator />
								<div class={styles.loader_body}>
									<p class={styles.loader_description}>{loader.description}</p>
								</div>
							</div>
						)}
					</For>
				</div>
			</section>

			<section class={styles.section_visual_alt}>
				<div class={styles.visual_side}>
					<div class={styles.main_illustration}>
						<div class={styles.img_box_large}>
							<svg
								width="100%"
								height="100%"
								viewBox="0 0 400 240"
								preserveAspectRatio="xMidYMid meet"
								xmlns="http://www.w3.org/2000/svg"
							>
								{/* Grid lines */}
								<path
									d="M70 180 H360 M70 140 H360 M70 100 H360 M70 60 H360"
									stroke="var(--text-primary)"
									stroke-width="1"
									opacity="0.05"
								/>

								{/* X-Axis Labels (Mod Count) */}
								<text
									x="70"
									y="200"
									font-family="Inter, sans-serif"
									font-size="9"
									fill="var(--text-secondary)"
									text-anchor="middle"
								>
									0
								</text>
								<text
									x="142.5"
									y="200"
									font-family="Inter, sans-serif"
									font-size="9"
									fill="var(--text-secondary)"
									text-anchor="middle"
								>
									50
								</text>
								<text
									x="215"
									y="200"
									font-family="Inter, sans-serif"
									font-size="9"
									fill="var(--text-secondary)"
									text-anchor="middle"
								>
									100
								</text>
								<text
									x="287.5"
									y="200"
									font-family="Inter, sans-serif"
									font-size="9"
									fill="var(--text-secondary)"
									text-anchor="middle"
								>
									200
								</text>
								<text
									x="360"
									y="200"
									font-family="Inter, sans-serif"
									font-size="9"
									fill="var(--text-secondary)"
									text-anchor="middle"
								>
									300+
								</text>
								<text
									x="215"
									y="215"
									font-family="Inter, sans-serif"
									font-size="10"
									fill="var(--text-primary)"
									font-weight="600"
									text-anchor="middle"
								>
									Number of Mods
								</text>

								{/* Unoptimized Line (Steep) */}
								<path
									d="M70 180 Q 215 140, 360 40"
									fill="none"
									stroke="var(--primary)"
									stroke-width="2"
									opacity="0.3"
									stroke-dasharray="4 2"
								/>
								<text
									x="360"
									y="35"
									font-family="Inter, sans-serif"
									font-size="9"
									fill="var(--primary)"
									text-anchor="end"
									opacity="0.6"
								>
									Unoptimized
								</text>

								{/* Optimized Line (Flatter) */}
								<path
									d="M70 180 Q 215 160, 360 110"
									fill="none"
									stroke="var(--primary)"
									stroke-width="2.5"
								/>
								<text
									x="360"
									y="105"
									font-family="Inter, sans-serif"
									font-size="9"
									fill="var(--primary)"
									font-weight="700"
									text-anchor="end"
								>
									Vesta Optimized
								</text>

								{/* Legend/Y-Axis */}
								<path
									d="M70 180 V50"
									stroke="var(--text-secondary)"
									stroke-width="1"
									opacity="0.3"
								/>
								<text
									x="65"
									y="60"
									font-family="Inter, sans-serif"
									font-size="9"
									fill="var(--text-primary)"
									font-weight="600"
									text-anchor="end"
								>
									Workload
								</text>
							</svg>
						</div>
					</div>
				</div>
				<div class={styles.visual_text}>
					<h2 class={styles.section_title}>Performance & Smoothness</h2>
					<div class={styles.guide_info_list}>
						<div class={styles.guide_info_entry}>
							<h3>{HELP_CONTENT.JAVA_MANAGED.title}</h3>
							<p>{HELP_CONTENT.JAVA_MANAGED.description}</p>
						</div>
						<div class={styles.guide_info_entry}>
							<h3>{HELP_CONTENT.MEMORY_ALLOCATION.title}</h3>
							<p>{HELP_CONTENT.MEMORY_ALLOCATION.description}</p>
						</div>
					</div>
				</div>
			</section>
		</div>
	);
};

export const ModdingGuidePage: Component = () => {
	return (
		<div class={styles.page_wrapper}>
			<header class={styles.page_header}>
				<h1>{HELP_CONTENT.GUIDE_PAGE.title}</h1>
				<p>{HELP_CONTENT.GUIDE_PAGE.description}</p>
			</header>
			<Separator />
			<ModdingGuideContent />
		</div>
	);
};

