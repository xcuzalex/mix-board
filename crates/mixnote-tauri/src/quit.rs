use std::sync::Mutex;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::mpsc::{self, Sender};
use std::time::Duration;

use tauri::{AppHandle, Emitter, ExitRequestApi, Manager, Runtime, State};

/// Asks the webview to write unsaved edits; it answers with `quit_flush_done`.
pub const FLUSH_EVENT_NAME: &str = "mixnote-flush-before-quit";
/// Quit anyway if the webview doesn't answer (crashed, still loading, stuck write).
/// It answers as soon as the write is done, so this only bounds a hang; it is
/// generous because a large board on a slow or synced disk can take seconds.
const FLUSH_TIMEOUT: Duration = Duration::from_secs(10);

#[derive(Default)]
pub struct QuitState {
    /// A flush is under way; further quit requests wait for it.
    flushing: AtomicBool,
    /// The flush finished (or timed out): the next exit request goes through.
    flushed: AtomicBool,
    done: Mutex<Option<Sender<()>>>,
}

/// Holds a programmatic exit (`app.exit`, used by the Quit menu item) until the
/// webview has flushed autosave, then exits with the same code.
pub fn on_exit_requested<R: Runtime>(app: &AppHandle<R>, code: Option<i32>, api: &ExitRequestApi) {
    // `None`: the last window was closed, and its close-requested handler already flushed.
    let Some(code) = code else { return };
    let state = app.state::<QuitState>();
    if state.flushed.load(Ordering::SeqCst) {
        return;
    }
    api.prevent_exit();
    if state.flushing.swap(true, Ordering::SeqCst) {
        return;
    }

    let (tx, rx) = mpsc::channel();
    *state.done.lock().unwrap() = Some(tx);
    let _ = app.emit(FLUSH_EVENT_NAME, ());

    let app = app.clone();
    std::thread::spawn(move || {
        let _ = rx.recv_timeout(FLUSH_TIMEOUT);
        app.state::<QuitState>().flushed.store(true, Ordering::SeqCst);
        app.exit(code);
    });
}

#[tauri::command]
pub fn quit_flush_done(state: State<'_, QuitState>) {
    if let Some(tx) = state.done.lock().unwrap().take() {
        let _ = tx.send(());
    }
}
