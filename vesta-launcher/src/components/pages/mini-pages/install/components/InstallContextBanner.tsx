import { Separator } from "@ui/separator/separator";
import { Show } from "solid-js";
import styles from "../install-page.module.css";

interface InstallContextBannerProps {
	title: string;
	label: string;
	iconUrl?: string | null;
	minecraftVersion?: string;
	modloader?: string;
	analyzing?: boolean;
	backLabel: string;
	onBack: () => void;
}

export function InstallContextBanner(props: InstallContextBannerProps) {
	return (
		<div class={styles["install-resource-context"]}>
			<button class={styles["back-link"]} onClick={props.onBack}>
				{props.backLabel}
			</button>
			<Separator orientation="vertical" style={{ height: "24px" }} />
			<div class={styles["resource-pill"]}>
				<Show when={props.iconUrl}>
					<img src={props.iconUrl ?? undefined} alt="" />
				</Show>
				<div class={styles["resource-info"]}>
					<span class={styles["resource-label"]}>{props.label}</span>
					<div class={styles["resource-name-row"]}>
						<span
							class={styles["resource-name"]}
							classList={{ [styles["is-analyzing"]]: !!props.analyzing }}
						>
							{props.title}
						</span>
						<Show when={props.minecraftVersion || props.modloader}>
							<div class={styles["resource-meta"]}>
								<Show when={props.minecraftVersion}>
									<span class={styles["meta-tag"]}>{props.minecraftVersion}</span>
								</Show>
								<Show when={props.modloader}>
									<span class={`${styles["meta-tag"]} ${styles.capitalize}`}>{props.modloader}</span>
								</Show>
							</div>
						</Show>
					</div>
				</div>
			</div>
		</div>
	);
}
