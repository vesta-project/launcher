/*/*
This module is for tasks. Each action is considered a task.
For example, a task is installing a mod or deleting a file
 */

use anyhow::Error;

pub trait Task<T> {
    fn action(&self) -> Result<T, Error>;
}

pub struct TaskPlain<T> {
    action: fn() -> Result<T, Error>,
}

impl<T> Task<T> for TaskPlain<T> {
    fn action(&self) -> Result<T, Error> {
        (self.action)()
    }
}

pub fn create_task_plain<T>(action: fn() -> Result<T, Error>) -> TaskPlain<T> {
    TaskPlain { action }
}


/*
The TaskManager is a task that executes a group of tasks
 */

struct TaskManager {
    tasks: Vec<Box<dyn Task<()>>>,
    /// The maximum number of tasks that can be executed at once
    limit: Option<usize>,
    abort_on_error: bool,
}

impl Task<()> for TaskManager {
    fn action(&self) -> Result<(), Error> {
        for task in self.tasks {
            task.action()?;
        }
        Ok(())
    }
}*/