import TitleBar from "@components/page-root/titlebar/titlebar";
import { getOsType } from "../../../utils/os";

const os = getOsType() ?? "windows";

function InvalidPage() {
	const page_path = window.location.pathname;

	return (
		<div>
			<TitleBar os={os} />
			The location {page_path} is not valid
		</div>
	);
}

export default InvalidPage;
