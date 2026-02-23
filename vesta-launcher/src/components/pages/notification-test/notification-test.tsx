import { dialogStore } from "@stores/dialog-store";
import { invoke } from "@tauri-apps/api/core";
import Button from "@ui/button/button";
import {
	createNotification,
	PROGRESS_INDETERMINATE,
	showAlert,
} from "@utils/notifications";
import { createSignal } from "solid-js";
import styles from "./notification-test.module.css";

function NotificationTestPage() {
	const [loading, setLoading] = createSignal(false);

	const testEphemeralInfo = async () => {
		setLoading(true);
		try {
			await showAlert("info", "Test Info", "This is an ephemeral info toast");
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
				"Test Success",
				"This is an ephemeral success toast",
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
					title: "Test Warning",
					message: "This is a persistent warning notification.",
					severity: "warning",
					notification_type: "Patient",
					dismissible: true,
				}
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
					title: "Test Error",
					message: "This is a persistent error notification.",
					severity: "error",
					notification_type: "Patient",
					dismissible: true,
				}
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
					title: "Pulsing Task",
					message: "This task is doing something...",
					severity: "info",
					notification_type: "Progress",
					progress: -1,
				}
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
					title: "Progress Task",
					message: "Downloading data...",
					severity: "info",
					notification_type: "Progress",
					progress: 45,
				}
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
			await dialogStore.alert("Debug", "This debug command is currently disabled in the backend.");
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
			await dialogStore.alert("Debug", "This debug command is currently disabled in the backend.");
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
			await dialogStore.alert("Debug", "This debug command is currently disabled in the backend.");
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
			await dialogStore.alert("Backend Result", result);
		} catch (error) {
			console.error("Failed to test backend dialog:", error);
			await dialogStore.alert("Error", String(error), "error");
		} finally {
			setLoading(false);
		}
	};

	return (
		<div class={styles["notification-test-page"]}>
			<h1>Notification System Test Page</h1>

			<div class={styles["test-section"]}>
				<h2>Task System</h2>
				<div class={styles["button-group"]}>
					<Button onClick={submitCancellableTask} disabled={loading()}>
						Submit Cancellable Task (15s)
					</Button>
				</div>
			</div>

			<div class={styles["test-section"]}>
				<h2>Ephemeral Notifications (Toast Only)</h2>
				<div class={styles["button-group"]}>
					<Button onClick={testEphemeralInfo} disabled={loading()}>
						Info Toast
					</Button>
					<Button onClick={testEphemeralSuccess} disabled={loading()}>
						Success Toast
					</Button>
				</div>
			</div>

			<div class={styles["test-section"]}>
				<h2>Persistent Notifications (Sidebar + Toast)</h2>
				<div class={styles["button-group"]}>
					<Button onClick={testPersistentWarning} disabled={loading()}>
						Warning (Persistent)
					</Button>
					<Button onClick={testPersistentError} disabled={loading()}>
						Error (Persistent)
					</Button>
				</div>
			</div>

			<div class={styles["test-section"]}>
				<h2>Progress Notifications</h2>
				<div class={styles["button-group"]}>
					<Button onClick={testProgressPulsing} disabled={loading()}>
						Pulsing Progress (-1)
					</Button>
					<Button onClick={testProgressBar} disabled={loading()}>
						Progress Bar (0-100)
					</Button>
				</div>
			</div>

			<div class={styles["test-section"]}>
				<h2>Batch Operations</h2>
				<div class={styles["button-group"]}>
					<Button onClick={testMultipleNotifications} disabled={loading()}>
						Send Multiple Toasts
					</Button>
				</div>
			</div>

			<div class={styles["test-section"]}>
				<h2>Debug</h2>
				<div class={styles["button-group"]}>
					<Button onClick={checkTables} disabled={loading()}>
						Check Tables
					</Button>
					<Button onClick={rerunMigrations} disabled={loading()}>
						Rerun Migrations
					</Button>
					<Button onClick={testBackendDialog} disabled={loading()}>
						Test Backend Blocking Dialog
					</Button>
				</div>
			</div>

			<div class={styles["info-box"]}>
				<h3>How to Test:</h3>
				<ul>
					<li>
						<strong>Ephemeral:</strong> Appear as toasts only, disappear after
						5s
					</li>
					<li>
						<strong>Persistent:</strong> Appear in sidebar + toast, stay until
						dismissed
					</li>
					<li>
						<strong>Pulsing:</strong> Shows animated progress indicator
						(indeterminate)
					</li>
					<li>
						<strong>Progress Bar:</strong> Shows 0-100% with step counter
					</li>
					<li>
						<strong>Bell Icon:</strong> Shows spinner when tasks are active,
						badge when unread exist
					</li>
				</ul>
			</div>
		</div>
	);
}

export default NotificationTestPage;
