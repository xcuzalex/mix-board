use serde::{Deserialize, Serialize};

use crate::element::Element;

#[derive(Serialize, Deserialize, Clone, Debug)]
pub enum Operation {
    AddElement(Element),
    RemoveElement(Element),
    ModifyElement {
        id: String,
        before: Element,
        after: Element,
    },
    MoveElements {
        ids: Vec<String>,
        dx: f64,
        dy: f64,
    },
    Group {
        element_ids: Vec<String>,
        group_id: String,
    },
    Ungroup {
        group_id: String,
        element_ids: Vec<String>,
    },
}

impl Operation {
    pub fn inverse(&self) -> Self {
        match self {
            Operation::AddElement(el) => Operation::RemoveElement(el.clone()),
            Operation::RemoveElement(el) => Operation::AddElement(el.clone()),
            Operation::ModifyElement { id, before, after } => Operation::ModifyElement {
                id: id.clone(),
                before: after.clone(),
                after: before.clone(),
            },
            Operation::MoveElements { ids, dx, dy } => Operation::MoveElements {
                ids: ids.clone(),
                dx: -dx,
                dy: -dy,
            },
            Operation::Group {
                element_ids,
                group_id,
            } => Operation::Ungroup {
                group_id: group_id.clone(),
                element_ids: element_ids.clone(),
            },
            Operation::Ungroup {
                group_id,
                element_ids,
            } => Operation::Group {
                element_ids: element_ids.clone(),
                group_id: group_id.clone(),
            },
        }
    }
}

pub struct History {
    undo_stack: Vec<Vec<Operation>>,
    redo_stack: Vec<Vec<Operation>>,
    max_history: usize,
}

impl History {
    pub fn new(max_history: usize) -> Self {
        Self {
            undo_stack: Vec::new(),
            redo_stack: Vec::new(),
            max_history,
        }
    }

    pub fn push(&mut self, operations: Vec<Operation>) {
        if operations.is_empty() {
            return;
        }
        self.undo_stack.push(operations);
        self.redo_stack.clear();
        if self.undo_stack.len() > self.max_history {
            self.undo_stack.remove(0);
        }
    }

    pub fn undo(&mut self) -> Option<Vec<Operation>> {
        if let Some(ops) = self.undo_stack.pop() {
            let inverse: Vec<Operation> = ops.iter().rev().map(|op| op.inverse()).collect();
            self.redo_stack.push(ops);
            Some(inverse)
        } else {
            None
        }
    }

    pub fn redo(&mut self) -> Option<Vec<Operation>> {
        if let Some(ops) = self.redo_stack.pop() {
            let result = ops.clone();
            self.undo_stack.push(ops);
            Some(result)
        } else {
            None
        }
    }

    pub fn can_undo(&self) -> bool {
        !self.undo_stack.is_empty()
    }

    pub fn can_redo(&self) -> bool {
        !self.redo_stack.is_empty()
    }

    pub fn clear(&mut self) {
        self.undo_stack.clear();
        self.redo_stack.clear();
    }
}

impl Default for History {
    fn default() -> Self {
        Self::new(100)
    }
}
