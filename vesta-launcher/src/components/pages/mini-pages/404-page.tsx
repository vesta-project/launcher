import LauncherButton from "@ui/button/button";

export default function InvalidPage(props: { close?: () => void }) {
	return (
		<div
			style={{
				display: "flex",
				"flex-direction": "column",
				"align-items": "center",
				"justify-content": "center",
				height: "100%",
				gap: "1.5rem",
				background: "var(--bg-glass)",
				color: "var(--text-color)",
			}}
		>
			<h1 style={{ "font-size": "4rem", margin: 0, opacity: 0.2 }}>404</h1>
			<p style={{ "font-size": "1.25rem", opacity: 0.6 }}>
				This page doesn't exist.
			</p>
			<LauncherButton onClick={() => props.close?.()}>Close</LauncherButton>
		</div>
	);
}
