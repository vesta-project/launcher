# Server workspace: scheduled and event-driven workflows and their run history.

servers-tab-automation = Automation

server-automation-view = Show
server-automation-workflows = Workflows
server-automation-recent-runs = Recent runs
server-automation-runs = Runs
server-automation-edit = Edit
server-automation-view-details = View details
server-automation-new = New workflow
server-automation-new-title = New workflow
server-automation-back = Back to workflows
server-automation-duplicate = Duplicate
server-automation-delete = Delete
server-automation-copy-name = Copy of { $name }
server-automation-you = You
server-automation-someone-else = Someone else
server-automation-empty-title = No workflows yet
server-automation-empty-description = Workflows run steps on a schedule or when something happens, like a nightly backup followed by a restart.
server-automation-footnote = Workflows keep running on the server while this launcher is closed. Schedules use a fixed UTC offset, so daylight saving time changes aren't applied.

# Templates
server-automation-template-nightly = Nightly backup
server-automation-template-nightly-help = Warn players, back up, then restart
server-automation-template-restart = Restart every 6 hours
server-automation-template-restart-help = A one-minute warning, then a restart
server-automation-template-announce = Announce on first join
server-automation-template-announce-help = Say hello when the first player joins
server-automation-template-blank = Blank workflow
server-automation-template-blank-help = Start from a single step

# Workflow list
server-automation-enabled = Turn { $name } on or off
server-automation-turned-on = { $name } is on
server-automation-turned-off = { $name } is off
server-automation-run-now = Run now
server-automation-run-needs-enabled = Turn the workflow on to run it.
server-automation-run-started = { $name } started
server-automation-run-skipped = { $name } is already running, so this run was skipped
server-automation-last-run = Last ran { $time } ago
server-automation-never-ran = Hasn't run yet
server-automation-runs-as = Runs as { $name }
server-automation-step-count-short = { $count ->
    [one] 1 step
   *[other] { $count } steps
  }
server-automation-delete-title = Delete { $name }?
server-automation-delete-description = The workflow stops running. Its past runs stay in the history.
server-automation-deleted = Deleted { $name }

# Editor
server-automation-view-only = You can see these workflows, but your role can't change them.
server-automation-stale = Someone else saved this workflow while you were editing. Their version is loaded underneath and your edits are kept, so review them and save again.
server-automation-workflow = Workflow
server-automation-name = Name
server-automation-name-placeholder = Nightly backup
server-automation-run-as = Run as
server-automation-run-as-help = Steps run with this person's permissions. You can choose yourself or someone whose role ranks below yours.
server-automation-run-as-placeholder = Choose who runs it
server-automation-principal-option = { $name } · { $value }
server-automation-enable-on-create = Turn on after saving
server-automation-enable-on-create-help = Off keeps the workflow saved without running it.
server-automation-trigger = Trigger
server-automation-starts = Starts
server-automation-trigger-cron = On a schedule
server-automation-trigger-interval = Repeatedly
server-automation-trigger-manual = Only when run manually
server-automation-trigger-agent-startup = When the Vesta agent starts
server-automation-trigger-server-started = When the server starts
server-automation-trigger-server-stopped = When the server stops
server-automation-trigger-server-crashed = When the server crashes
server-automation-trigger-player-count-zero = When the last player leaves
server-automation-trigger-first-player-joined = When the first player joins
server-automation-trigger-update-available = When an update is available
server-automation-trigger-backup-completed = When a backup finishes
server-automation-trigger-backup-failed = When a backup fails
server-automation-repeat = Repeat
server-automation-daily = Daily
server-automation-weekly = Weekly
server-automation-custom = Custom
server-automation-time = Time
server-automation-days = Days
server-automation-cron = Cron expression
server-automation-cron-help = Minute, hour, day of month, month and day of week. Numbers, lists, ranges and steps; Sunday is 0 or 7.
server-automation-offset = UTC offset
server-automation-offset-help = A fixed offset; daylight saving time isn't applied. This computer is at { $value } now.
server-automation-every = Every
server-automation-every-help = Between 1 minute and 365 days.
server-automation-unit = Unit
server-automation-unit-minutes = Minutes
server-automation-unit-hours = Hours
server-automation-backup-profile = Backup profile
server-automation-any-profile = Any profile
server-automation-missed = Missed runs
server-automation-missed-help = What to do with runs that were due while the agent was offline.
server-automation-missed-skip = Skip them and notify
server-automation-missed-latest = Run the latest one
server-automation-missed-catch-up = Catch up, one after another
server-automation-catch-up-max = Most to catch up
server-automation-steps = Steps
server-automation-steps-help = Steps run in order. Each can retry, and can continue or jump ahead to a later step when it succeeds or fails.
server-automation-step-count = { $count } of { $max } steps
server-automation-add-step = Add step
server-automation-action = Action
server-automation-move-up = Move up
server-automation-move-down = Move down
server-automation-remove-step = Remove step
server-automation-step-id = Step ID
server-automation-step-id-help = Jumps from other steps use this ID. It follows the step type until you change it.
server-automation-timeout = Timeout (seconds)
server-automation-retries = Retries
server-automation-backoff = Wait between retries (seconds)
server-automation-on-success = When it succeeds
server-automation-on-failure = When it fails
server-automation-branch-next = Continue to the next step
server-automation-branch-end = Finish the workflow
server-automation-branch-fail = Stop the workflow as failed
server-automation-branch-continue = Continue anyway
server-automation-branch-goto = Jump to step { $count } · { $name }
server-automation-branch-goto-missing = Jump to { $name } (not a later step)
server-automation-branch-conditional = Depends on the output (kept as is)
server-automation-delay = Wait (seconds)
server-automation-console-line = Console command
server-automation-console-line-help = Sent to the server console exactly as typed, without a leading slash.
server-automation-severity = Importance
server-automation-severity-info = Information
server-automation-severity-warning = Warning
server-automation-severity-critical = Critical
server-automation-notify-title = Title
server-automation-notify-body = Message
server-automation-preset = Script preset
server-automation-preset-help = A preset the server owner approved on the agent.
server-automation-params = Parameters
server-automation-param-key = Name
server-automation-param-value = Value
server-automation-add-param = Add parameter
server-automation-remove-param = Remove parameter
server-automation-no-fields = Nothing else to set for this action.
server-automation-unsaved = Unsaved changes
server-automation-unsaved-new = Not saved yet
server-automation-problems = { $count ->
    [one] 1 problem to fix
   *[other] { $count } problems to fix
  }
server-automation-create = Create workflow
server-automation-created = Created { $name }
server-automation-saved = Workflow saved

# Actions
server-automation-action-console = Run a console command
server-automation-action-notify = Send a notification
server-automation-action-delay = Wait
server-automation-action-backup = Back up
server-automation-action-verify = Verify a backup
server-automation-action-restart = Restart the server
server-automation-action-start = Start the server
server-automation-action-stop = Stop the server
server-automation-action-clean-trash = Empty the file trash
server-automation-action-script = Run a script preset

# Step summaries
server-automation-step-delay = Wait { $time }
server-automation-step-backup = Back up with the { $name } profile
server-automation-step-verify = Verify the latest { $name } backup
server-automation-step-console = Run “{ $value }”
server-automation-step-notify-info = Notify: { $name }
server-automation-step-notify-warning = Warn: { $name }
server-automation-step-notify-critical = Critical alert: { $name }
server-automation-step-script = Run the { $name } preset ({ $count ->
    [one] 1 parameter
   *[other] { $count } parameters
  })
server-automation-step-start = Start the server
server-automation-step-stop = Stop the server
server-automation-step-restart = Restart the server
server-automation-step-clean-trash = Empty the file trash

# Trigger sentences
server-automation-sentence-manual = Run manually
server-automation-sentence-agent-startup = When the Vesta agent starts
server-automation-sentence-server-started = When the server starts
server-automation-sentence-server-stopped = When the server stops
server-automation-sentence-server-crashed = When the server crashes
server-automation-sentence-player-count-zero = When the last player leaves
server-automation-sentence-first-player-joined = When the first player joins
server-automation-sentence-update-available = When an update is available
server-automation-sentence-backup-completed = When any backup finishes
server-automation-sentence-backup-completed-profile = When a { $name } backup finishes
server-automation-sentence-backup-failed = When any backup fails
server-automation-sentence-backup-failed-profile = When a { $name } backup fails
server-automation-sentence-daily = Every day at { $time } ({ $value })
server-automation-sentence-weekdays = Weekdays at { $time } ({ $value })
server-automation-sentence-weekly = Every { $name } at { $time } ({ $value })
server-automation-sentence-cron = On the schedule { $name } ({ $value })
server-automation-sentence-every-days = { $count ->
    [one] Every day
   *[other] Every { $count } days
  }
server-automation-sentence-every-hours = { $count ->
    [one] Every hour
   *[other] Every { $count } hours
  }
server-automation-sentence-every-minutes = { $count ->
    [one] Every minute
   *[other] Every { $count } minutes
  }
server-automation-sentence-every-seconds = Every { $count } seconds

# Durations
server-automation-duration-days = { $count ->
    [one] 1 day
   *[other] { $count } days
  }
server-automation-duration-hours = { $count ->
    [one] 1 hour
   *[other] { $count } hours
  }
server-automation-duration-minutes = { $count ->
    [one] 1 minute
   *[other] { $count } minutes
  }
server-automation-duration-seconds = { $count ->
    [one] 1 second
   *[other] { $count } seconds
  }

# Validation
server-automation-problem-required = Required.
server-automation-problem-control = Can't contain control characters or line breaks.
server-automation-problem-too-long = Too long: at most { $max } bytes.
server-automation-problem-range = Must be a whole number from { $min } to { $max }.
server-automation-problem-step-count = A workflow has between { $min } and { $max } steps.
server-automation-problem-duplicate-id = Another step already uses this ID.
server-automation-problem-duplicate-key = Another parameter already uses this name.
server-automation-problem-param-count = At most { $max } parameters.
server-automation-problem-forward = Choose a later step. Steps can only jump forward.
server-automation-problem-delay-timeout = The timeout must be longer than the wait.
server-automation-problem-too-large = This workflow is too large to save. Remove some steps or shorten their text.
server-automation-problem-cron-fields = Use five fields: minute, hour, day of month, month and day of week.
server-automation-problem-cron-minute = The minute field must use numbers from 0 to 59.
server-automation-problem-cron-hour = The hour field must use numbers from 0 to 23.
server-automation-problem-cron-day = The day-of-month field must use numbers from 1 to 31.
server-automation-problem-cron-month = The month field must use numbers from 1 to 12.
server-automation-problem-cron-weekday = The day-of-week field must use numbers from 0 to 7.

# Runs
server-automation-runs-empty = No runs yet.
server-automation-deleted-workflow = Deleted workflow
server-automation-show-steps = Steps
server-automation-hide-steps = Hide steps
server-automation-took = Took { $time }
server-automation-wakes = Continues { $time }
server-automation-attempts = { $count } attempts
server-automation-operation = Task { $name }
server-automation-unknown-step = Step not in this run's definition
server-automation-run-trigger-manual = Started manually
server-automation-run-trigger-schedule = Scheduled for { $time }
server-automation-run-trigger-other = Started by the agent
server-automation-run-queued = Queued
server-automation-run-running = Running
server-automation-run-suspended = Needs attention
server-automation-run-succeeded = Succeeded
server-automation-run-failed = Failed
server-automation-run-unknown = Unknown
server-automation-step-state-waiting = Waiting
server-automation-step-state-submitting = Sending
server-automation-step-state-submitted = In progress
server-automation-step-state-succeeded = Succeeded
server-automation-step-state-failed = Failed
server-automation-step-state-timed-out = Timed out
server-automation-step-state-skipped = Skipped
server-automation-step-state-pending = Not reached
server-automation-outcome-completed = Completed
server-automation-outcome-timed-out = A step timed out
server-automation-outcome-uncertain = A step's result was uncertain
server-automation-outcome-discarded = Discarded
server-automation-outcome-workflow-deleted = The workflow was deleted
server-automation-outcome-authority-revoked = The person it runs as lost a permission it needs
server-automation-outcome-forbidden = Not allowed for the person it runs as
server-automation-suspended-note = This run is paused because the person it runs as can no longer do this step. Discarding ends the run; it doesn't cancel anything already started on the server.
server-automation-discard-run = Discard run
server-automation-discarded = Run discarded
server-automation-output-yes = Yes
server-automation-output-no = No

# Empty state
server-automation-templates = Start from a template
server-automation-empty-view-only = Workflows run steps on a schedule or when something happens on the server. Your role can see workflows but can't create them; the server owner or an administrator can set one up.
server-automation-start-scratch = Start from scratch
server-automation-template-clean-trash = Empty file trash weekly
server-automation-template-clean-trash-help = Clear deleted files every Sunday morning

# List
server-automation-on = On
server-automation-off = Off
server-automation-kept-new = You have a new workflow that isn't saved yet.
server-automation-keep-editing = Keep editing
server-automation-load-older = Load older runs

# Trigger editor
server-automation-edit-trigger = Change when it runs: { $name }
server-automation-group-schedule = Schedule
server-automation-group-interval = Interval
server-automation-group-event = Event
server-automation-group-manual = Manual
server-automation-when = When
server-automation-manual-help = Runs only when someone presses Run now. Turn the workflow on to allow that.
server-automation-done = Done

# Step canvas
server-automation-step = Step
server-automation-step-number = Step { $count }
server-automation-step-label = Step { $count }: { $name }
server-automation-step-of = Step { $count } of { $max }
server-automation-reorder = Reorder { $name }
server-automation-reorder-hint = Press Space to pick the step up, the arrow keys to move it and Space again to drop it. Escape puts it back. Alt with the arrow keys moves it straight away.
server-automation-picked-up = Moving { $name }. Release to drop it.
server-automation-picked-up-keyboard = Picked up { $name }. Use the arrow keys to move it.
server-automation-moved = Moved to position { $count } of { $max }
server-automation-dropped = Dropped at position { $count } of { $max }
server-automation-reorder-cancelled = Reorder cancelled
server-automation-add-step-at = Add a step at position { $count }
server-automation-problems-short = { $count ->
    [one] 1 problem
   *[other] { $count } problems
  }
server-automation-note-from = From step { $count }
server-automation-note-from-failure = If step { $count } fails
server-automation-note-then-finish = Then finishes
server-automation-note-then-goto = Then step { $count }
server-automation-note-conditional = Branches on its output
server-automation-note-retries = { $count ->
    [one] Retries once
   *[other] Retries { $count } times
  }
server-automation-note-failure-continue = Continues if it fails
server-automation-note-failure-goto = If it fails, step { $count }
server-automation-select-step = Choose a step to change what it does, how long it may take and what happens when it fails. Drag steps to reorder them.
server-automation-select-step-view = Choose a step to see what it does.
server-automation-timing-failure = Timing and failure
server-automation-timeout-after = Times out after { $time }
server-automation-advanced = Advanced
server-automation-remove-title = Remove “{ $name }”?
server-automation-remove-referenced = { $count ->
    [one] Step { $name } jumps to this step. After removing it, that jump goes back to its default: continue, or stop as failed.
   *[other] Steps { $name } jump to this step. After removing it, those jumps go back to their defaults: continue, or stop as failed.
  }
server-automation-leave-title = Save changes to { $name }?
server-automation-leave-description = You changed this workflow but haven't saved it. Changes you don't save are lost.
server-automation-leave-description-invalid = You changed this workflow but haven't saved it, and it has problems to fix before it can be saved. Changes you don't save are lost.
