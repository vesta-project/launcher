import { dialogStore } from "@stores/dialog-store";
import { invoke } from "@tauri-apps/api/core";
import Button from "@ui/button/button";
import { showAlert } from "@utils/notifications";
import { createSignal } from "solid-js";
import { t } from "~/localization";
import styles from "./notification-test.module.css";

function NotificationTestPage() {
	const [loading, setLoading] = createSignal(false);

	const testEphemeralInfo = async () => {
		setLoading(true);
		try {
			await showAlert(
				"info",
				t("secondary-notification-test-info-title"),
				t("secondary-notification-test-info-message"),
			);
		} catch (error) {
			console.error("Failed to create notification:", error);
		} finally {
			setLoading(false);
		}
	};

	const testEphemeralSuccess = async () => {
		setLoading(true);
		try {
			await showAlert(
				"success",
				t("secondary-notification-test-success-title"),
				t("secondary-notification-test-success-message"),
			);
		} catch (error) {
			console.error("Failed to create notification:", error);
		} finally {
			setLoading(false);
		}
	};

	const testPersistentWarning = async () => {
		setLoading(true);
		try {
			await invoke("create_notification", {
				payload: {
					title: t("secondary-notification-test-warning-title"),
					message: t("secondary-notification-test-warning-message"),
					severity: "warning",
					notification_type: "Patient",
					dismissible: true,
				},
			});
		} catch (error) {
			console.error("Failed to create notification:", error);
		} finally {
			setLoading(false);
		}
	};

	const testPersistentError = async () => {
		setLoading(true);
		try {
			await invoke("create_notification", {
				payload: {
					title: t("secondary-notification-test-error-title"),
					message: t("secondary-notification-test-error-message"),
					severity: "error",
					notification_type: "Patient",
					dismissible: true,
				},
			});
		} catch (error) {
			console.error("Failed to create notification:", error);
		} finally {
			setLoading(false);
		}
	};

	const testProgressPulsing = async () => {
		setLoading(true);
		try {
			await invoke("create_notification", {
				payload: {
					title: t("secondary-notification-test-pulsing-title"),
					message: t("secondary-notification-test-pulsing-message"),
					severity: "info",
					notification_type: "Progress",
					progress: -1,
				},
			});
		} catch (error) {
			console.error("Failed to create notification:", error);
		} finally {
			setLoading(false);
		}
	};

	const testProgressBar = async () => {
		setLoading(true);
		try {
			await invoke("create_notification", {
				payload: {
					title: t("secondary-notification-test-progress-title"),
					message: t("secondary-notification-test-progress-message"),
					severity: "info",
					notification_type: "Progress",
					progress: 45,
				},
			});
		} catch (error) {
			console.error("Failed to create notification:", error);
		} finally {
			setLoading(false);
		}
	};

	const testMultipleNotifications = async () => {
		setLoading(true);
		try {
			await Promise.all([
				testPersistentWarning(),
				testPersistentError(),
				testProgressBar(),
			]);
		} catch (error) {
			console.error("Failed to create notifications:", error);
		} finally {
			setLoading(false);
		}
	};

	const checkTables = async () => {
		setLoading(true);
		try {
			console.log("checkTables command is currently disabled in backend");
			await dialogStore.alert(
				t("secondary-notification-test-debug-title"),
				t("secondary-notification-test-debug-disabled"),
			);
		} catch (error) {
			console.error("Failed to check tables:", error);
		} finally {
			setLoading(false);
		}
	};

	const rerunMigrations = async () => {
		setLoading(true);
		try {
			console.log("rerunMigrations command is currently disabled in backend");
			await dialogStore.alert(
				t("secondary-notification-test-debug-title"),
				t("secondary-notification-test-debug-disabled"),
			);
		} catch (error) {
			console.error("Failed to rerun migrations:", error);
		} finally {
			setLoading(false);
		}
	};

	const submitCancellableTask = async () => {
		setLoading(true);
		try {
			console.log("submit_test_task command is currently disabled in backend");
			await dialogStore.alert(
				t("secondary-notification-test-debug-title"),
				t("secondary-notification-test-debug-disabled"),
			);
		} catch (error) {
			console.error("Failed to submit task:", error);
		} finally {
			setLoading(false);
		}
	};

	const testBackendDialog = async () => {
		setLoading(true);
		try {
			const result = await invoke<string>("test_blocking_dialog");
			console.log("Backend dialog result:", result);
			await dialogStore.alert(
				t("secondary-notification-test-backend-result-title"),
				result,
			);
		} catch (error) {
			console.error("Failed to test backend dialog:", error);
			await dialogStore.alert(t("common-error"), String(error), "error");
		} finally {
			setLoading(false);
		}
	};

	return (
		<div class={styles["notification-test-page"]}>
			<h1>{t("secondary-notification-test-page-title")}</h1>

			<div class={styles["test-section"]}>
				<h2>{t("secondary-notification-test-task-system")}</h2>
				<div class={styles["button-group"]}>
					<Button onClick={submitCancellableTask} disabled={loading()}>
						{t("secondary-notification-test-submit-cancellable-task")}
					</Button>
				</div>
			</div>

			<div class={styles["test-section"]}>
				<h2>{t("secondary-notification-test-ephemeral-section")}</h2>
				<div class={styles["button-group"]}>
					<Button onClick={testEphemeralInfo} disabled={loading()}>
						{t("secondary-notification-test-info-toast")}
					</Button>
					<Button onClick={testEphemeralSuccess} disabled={loading()}>
						{t("secondary-notification-test-success-toast")}
					</Button>
				</div>
			</div>

			<div class={styles["test-section"]}>
				<h2>{t("secondary-notification-test-persistent-section")}</h2>
				<div class={styles["button-group"]}>
					<Button onClick={testPersistentWarning} disabled={loading()}>
						{t("secondary-notification-test-warning-persistent")}
					</Button>
					<Button onClick={testPersistentError} disabled={loading()}>
						{t("secondary-notification-test-error-persistent")}
					</Button>
				</div>
			</div>

			<div class={styles["test-section"]}>
				<h2>{t("secondary-notification-test-progress-section")}</h2>
				<div class={styles["button-group"]}>
					<Button onClick={testProgressPulsing} disabled={loading()}>
						{t("secondary-notification-test-pulsing-progress")}
					</Button>
					<Button onClick={testProgressBar} disabled={loading()}>
						{t("secondary-notification-test-progress-bar")}
					</Button>
				</div>
			</div>

			<div class={styles["test-section"]}>
				<h2>{t("secondary-notification-test-batch-section")}</h2>
				<div class={styles["button-group"]}>
					<Button onClick={testMultipleNotifications} disabled={loading()}>
						{t("secondary-notification-test-send-multiple-toasts")}
					</Button>
				</div>
			</div>

			<div class={styles["test-section"]}>
				<h2>{t("secondary-notification-test-debug-section")}</h2>
				<div class={styles["button-group"]}>
					<Button onClick={checkTables} disabled={loading()}>
						{t("secondary-notification-test-check-tables")}
					</Button>
					<Button onClick={rerunMigrations} disabled={loading()}>
						{t("secondary-notification-test-rerun-migrations")}
					</Button>
					<Button onClick={testBackendDialog} disabled={loading()}>
						{t("secondary-notification-test-backend-dialog")}
					</Button>
				</div>
			</div>

			<div class={styles["info-box"]}>
				<h3>{t("secondary-notification-test-how-to-test")}</h3>
				<ul>
					<li>
						<strong>
							{t("secondary-notification-test-help-ephemeral-label")}
						</strong>{" "}
						{t("secondary-notification-test-help-ephemeral-description")}
					</li>
					<li>
						<strong>
							{t("secondary-notification-test-help-persistent-label")}
						</strong>{" "}
						{t("secondary-notification-test-help-persistent-description")}
					</li>
					<li>
						<strong>
							{t("secondary-notification-test-help-pulsing-label")}
						</strong>{" "}
						{t("secondary-notification-test-help-pulsing-description")}
					</li>
					<li>
						<strong>
							{t("secondary-notification-test-help-progress-bar-label")}
						</strong>{" "}
						{t("secondary-notification-test-help-progress-bar-description")}
					</li>
					<li>
						<strong>
							{t("secondary-notification-test-help-bell-icon-label")}
						</strong>{" "}
						{t("secondary-notification-test-help-bell-icon-description")}
					</li>
				</ul>
			</div>
		</div>
	);
}

export default NotificationTestPage;
