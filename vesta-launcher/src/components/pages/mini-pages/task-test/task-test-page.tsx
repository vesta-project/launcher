import { invoke } from "@tauri-apps/api/core";
import LauncherButton from "@ui/button/button";
import {
	Slider,
	SliderFill,
	SliderLabel,
	SliderThumb,
	SliderTrack,
	SliderValueLabel,
} from "@ui/slider/slider";
import { createSignal } from "solid-js";
import "./task-test-page.css";

function TaskTestPage() {
	const [title, setTitle] = createSignal("Test Task");
	const [duration, setDuration] = createSignal(5);
	const [workerLimit, setWorkerLimit] = createSignal(2);

	const handleSubmit = async () => {
		try {
			await invoke("submit_test_task", {
				title: title(),
				durationSecs: duration(),
			});
			console.log("Task submitted");
		} catch (error) {
			console.error("Failed to submit task:", error);
		}
	};

	const handleLimitChange = async (value: number[]) => {
		const limit = value[0];
		setWorkerLimit(limit);
		try {
			await invoke("set_worker_limit", { limit });
			console.log("Worker limit updated:", limit);
		} catch (error) {
			console.error("Failed to update worker limit:", error);
		}
	};

	return (
		<div class="task-test-page">
			<h1>Task System Test</h1>

			<section class="task-section">
				<h2>Submit Task</h2>
				<div class="input-group">
					<label>
						Task Title:
						<input
							type="text"
							value={title()}
							onInput={(e) => setTitle(e.currentTarget.value)}
							class="task-input"
						/>
					</label>
				</div>
				<div class="input-group">
					<label>
						Duration (seconds):
						<input
							type="number"
							value={duration()}
							onInput={(e) => setDuration(parseInt(e.currentTarget.value))}
							class="task-input"
						/>
					</label>
				</div>
				<LauncherButton onClick={handleSubmit}>Submit Task</LauncherButton>
			</section>

			<section class="task-section">
				<h2>Worker Configuration</h2>
				<div class="slider-container">
					<Slider
						value={[workerLimit()]}
						onChange={handleLimitChange}
						minValue={1}
						maxValue={10}
						step={1}
					>
						<div class="slider__header">
							<SliderLabel>Worker Limit</SliderLabel>
							<SliderValueLabel />
						</div>
						<SliderTrack>
							<SliderFill />
							<SliderThumb />
						</SliderTrack>
					</Slider>
				</div>
				<p class="description">Controls how many tasks can run concurrently.</p>
			</section>
		</div>
	);
}

export default TaskTestPage;
