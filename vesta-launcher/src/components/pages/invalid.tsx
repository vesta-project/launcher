import TitleBar from "@components/page-root/titlebar/titlebar";
import {
	PageViewer,
	pageViewerOpen,
	setPageViewerOpen,
} from "@components/page-viewer/page-viewer";
import { useOs } from "@utils/os";

function InvalidPage() {
	const os = useOs();

	const page_path = window.location.pathname;

	return (
		<div>
			<TitleBar os={os()} />
			The location {page_path} is not valid
			<PageViewer
				open={pageViewerOpen()}
				viewChanged={() => setPageViewerOpen(false)}
			/>
		</div>
	);
}

export default InvalidPage;
