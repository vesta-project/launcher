/// TODO: Error doesnt show up

import TitleBar from "@components/page-root/titlebar/titlebar";
import { useNavigate } from "@solidjs/router";
import { listen } from "@tauri-apps/api/event";
import Button from "@ui/button/button";
import { createSignal } from "solid-js";
import { getOsType } from "../../../utils/os";
import "./fatal-page.css";

const os = getOsType() ?? "windows";

const [fatalInfo, setFatalInfo] = createSignal<{
	title: string;
	description: string;
}>({
	title: "Fatal Error",
	description: "unknown",
});

function FatalPage() {
	const navigate = useNavigate();

	return (
		<div id={"fatal-page__root"}>
			<TitleBar os={os} />

			<div id={"fatal-page__wrapper"}>
				<h1>{fatalInfo().title}</h1>
				<p>{fatalInfo().description}</p>
				<Button onClick={() => navigate("/", { replace: true })}>Back</Button>
			</div>
		</div>
	);
}

export { FatalPage, setFatalInfo };
