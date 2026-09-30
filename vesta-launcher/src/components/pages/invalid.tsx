import TitleBar from "@components/page-root/titlebar/titlebar";
import {
	PageViewer,
	pageViewerOpen,
	setPageViewerOpen,
} from "@components/page-viewer/page-viewer";
import { useOs } from "@utils/os";
import { t } from "~/localization";

function InvalidPage() {
	const os = useOs();

	const page_path = window.location.pathname;

	return (
		<div>
			<TitleBar os={os()} />
			{t("secondary-invalid-location", { path: page_path })}
			<PageViewer
				open={pageViewerOpen()}
				viewChanged={() => setPageViewerOpen(false)}
			/>
		</div>
	);
}

export default InvalidPage;
