import { children, type JSX, mergeProps, splitProps } from "solid-js";
import styles from "../init.module.css";

interface StageCardProps {
	children: JSX.Element;
	class?: string;
	style?: JSX.CSSProperties | string;
	fullHeight?: boolean;
}

function StageCard(props: StageCardProps) {
	const merged = mergeProps({ fullHeight: false }, props);
	const [local, rest] = splitProps(merged, [
		"children",
		"class",
		"style",
		"fullHeight",
	]);
	const c = children(() => local.children);

	return (
		<div
			classList={{
				[styles["stage-card"]]: true,
				[styles["stage-card--full"]]: local.fullHeight,
				[local.class ?? ""]: !!local.class,
			}}
			style={
				typeof local.style === "string" ? local.style : (local.style as any)
			}
			{...rest}
		>
			<div class={styles["stage-card-content"]}>{c()}</div>
		</div>
	);
}

export default StageCard;
