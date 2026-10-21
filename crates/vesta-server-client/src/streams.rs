use crate::model::ConsoleLine;
use std::collections::VecDeque;

#[derive(Default)]
pub struct ConsoleRing {
    lines: VecDeque<ConsoleLine>,
    bytes: usize,
    gap: bool,
}
impl ConsoleRing {
    pub fn push(&mut self, mut line: ConsoleLine) {
        if line.text.len() > 32 * 1024 {
            let mut end = 32 * 1024;
            while !line.text.is_char_boundary(end) {
                end -= 1;
            }
            line.text.truncate(end);
            line.truncated = true;
        }
        self.bytes += line.text.len() + line.cursor.len();
        self.lines.push_back(line);
        while self.lines.len() > 5000 || self.bytes > 2 * 1024 * 1024 {
            if let Some(line) = self.lines.pop_front() {
                self.bytes -= line.text.len() + line.cursor.len();
                self.gap = true;
            }
        }
    }
    pub fn take_gap(&mut self) -> bool {
        std::mem::take(&mut self.gap)
    }
    pub fn lines(&self) -> &VecDeque<ConsoleLine> {
        &self.lines
    }
    pub fn bytes(&self) -> usize {
        self.bytes
    }
}
