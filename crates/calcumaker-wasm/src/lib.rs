//! Thin WASI binding around `calcumaker_core::App`.
//!
//! This is the web equivalent of `calcumaker-emu`: it owns an `App`, forwards
//! matrix presses, and hands back the *real* TM1640 segment bytes + panel text.
//! No calculator logic lives here. The JS side (see `web/src/wasm/`) drives
//! these `extern "C"` exports and paints the results.
//!
//! Memory contract: strings and byte rows are written into caller-provided
//! buffers in the wasm linear memory; the caller passes a pointer + capacity and
//! gets back the number of bytes written (or the required length). The TS
//! `Calcumaker` wrapper hides all of this.

use calcumaker_core::keys::{COLS, PERSONALITIES, ROWS};
use calcumaker_core::seg7::{DIGITS_PER_ROW, DISPLAY_ROWS};
use calcumaker_core::{keydoc, App, Key};

/// A shared 256-byte scratch buffer in linear memory for JS↔wasm string / byte
/// transfers. Single-threaded and read-immediately, so one reused buffer is
/// enough (avoids exporting a full allocator). Capacity available to callers.
pub const SCRATCH_CAP: usize = 256;
static mut SCRATCH: [u8; SCRATCH_CAP] = [0; SCRATCH_CAP];

/// Pointer to the shared scratch buffer (see [`SCRATCH_CAP`]).
#[no_mangle]
pub extern "C" fn cm_scratch() -> *mut u8 {
    &raw mut SCRATCH as *mut u8
}

/// Capacity of the scratch buffer in bytes.
#[no_mangle]
pub extern "C" fn cm_scratch_cap() -> usize {
    SCRATCH_CAP
}

// Growable buffer for strings of unbounded length. The calculator is
// arbitrary-precision: `x_full()` on 500! is >1000 bytes, and 1000! is >2500.
// A fixed 256-byte buffer silently truncated those to the empty string, so the
// string getters write here and return the length; JS reads `cm_out_ptr()..len`.
//
// The pointer MUST be read *after* the writing call: the Vec may reallocate and
// wasm memory may grow, which detaches any previously-taken ArrayBuffer view.
thread_local! {
    static OUT: core::cell::RefCell<Vec<u8>> = const { core::cell::RefCell::new(Vec::new()) };
}

/// Replace the output buffer with `s`; returns its byte length.
fn put(s: &str) -> usize {
    OUT.with(|o| {
        let mut o = o.borrow_mut();
        o.clear();
        o.extend_from_slice(s.as_bytes());
        o.len()
    })
}

/// Pointer to the output buffer. Call only *after* the getter that filled it —
/// the Vec may have reallocated and wasm memory may have grown.
#[no_mangle]
pub extern "C" fn cm_out_ptr() -> *const u8 {
    OUT.with(|o| o.borrow().as_ptr())
}

/// Create an `App` at `prec` bits of working precision. Returns an opaque handle.
#[no_mangle]
pub extern "C" fn cm_new(prec: u32) -> *mut App {
    Box::into_raw(Box::new(App::new(prec)))
}

/// Free a handle from [`cm_new`].
///
/// # Safety
/// `app` must be a live handle returned by [`cm_new`] and not used afterwards.
#[no_mangle]
pub unsafe extern "C" fn cm_free(app: *mut App) {
    if !app.is_null() {
        drop(Box::from_raw(app));
    }
}

/// Press physical matrix cell `(row, col)`. Out-of-range cells are ignored.
///
/// # Safety
/// `app` must be a live handle from [`cm_new`].
#[no_mangle]
pub unsafe extern "C" fn cm_press(app: *mut App, row: usize, col: usize) {
    if let Some(app) = app.as_mut() {
        app.press(row, col);
    }
}

/// Press the `f` / `g` shift keys directly (they have no fixed matrix cell in
/// every personality). `which`: 0 = f, 1 = g.
///
/// # Safety
/// `app` must be a live handle from [`cm_new`].
#[no_mangle]
pub unsafe extern "C" fn cm_press_shift(app: *mut App, which: u32) {
    if let Some(app) = app.as_mut() {
        app.press_key(if which == 0 { Key::ShiftF } else { Key::ShiftG });
    }
}

/// Copy the 3×16 segment bytes into `out` (must hold `DISPLAY_ROWS *
/// DIGITS_PER_ROW` = 48 bytes). Row-major: row 0 first.
///
/// # Safety
/// `app` must be a live handle; `out` must point to at least 48 writable bytes.
#[no_mangle]
pub unsafe extern "C" fn cm_seg_rows(app: *mut App, out: *mut u8) {
    let Some(app) = app.as_mut() else { return };
    let rows = app.seg_rows();
    let mut i = 0;
    for row in rows.iter() {
        for &b in row.iter() {
            *out.add(i) = b;
            i += 1;
        }
    }
}

/// Current shift annunciator: 0 = none, 1 = f, 2 = g.
///
/// # Safety
/// `app` must be a live handle from [`cm_new`].
#[no_mangle]
pub unsafe extern "C" fn cm_shift(app: *mut App) -> u32 {
    match app.as_ref().and_then(|a| a.shift()) {
        Some('f') => 1,
        Some('g') => 2,
        _ => 0,
    }
}

/// Write the aux OLED line `idx` (0..4) into `out`/`cap` as UTF-8; returns the
/// full byte length (may exceed `cap`, in which case nothing is written).
///
/// # Safety
/// `app` must be a live handle from [`cm_new`]. Read the result via [`cm_out_ptr`].
#[no_mangle]
pub unsafe extern "C" fn cm_aux_line(app: *mut App, idx: usize) -> usize {
    let Some(app) = app.as_ref() else { return 0 };
    let lines = app.aux_lines();
    let Some(s) = lines.get(idx) else { return 0 };
    put(s)
}

/// Write display text row `idx` (0..DISPLAY_ROWS) into `out`/`cap` as ASCII;
/// returns the byte length. This is what the RGB dot-matrix module renders (via
/// its 5×7 font) — the alternate display feed, distinct from the 7-seg bytes.
///
/// # Safety
/// `app` must be a live handle from [`cm_new`]. Read the result via [`cm_out_ptr`].
#[no_mangle]
pub unsafe extern "C" fn cm_text_row(app: *mut App, idx: usize) -> usize {
    let Some(app) = app.as_ref() else { return 0 };
    let rows = app.text_rows();
    let Some(s) = rows.get(idx) else { return 0 };
    put(s)
}

/// Write the untruncated X register into `out`/`cap`; returns the byte length.
///
/// # Safety
/// `app` must be a live handle from [`cm_new`]. Read the result via [`cm_out_ptr`].
#[no_mangle]
pub unsafe extern "C" fn cm_x_full(app: *mut App) -> usize {
    let Some(app) = app.as_ref() else { return 0 };
    put(&app.x_full())
}

/// Write the status/error message (empty if none); returns the byte length.
///
/// # Safety
/// `app` must be a live handle from [`cm_new`]. Read the result via [`cm_out_ptr`].
#[no_mangle]
pub unsafe extern "C" fn cm_message(app: *mut App) -> usize {
    let Some(app) = app.as_ref() else { return 0 };
    put(app.message().unwrap_or(""))
}

/// Number of built-in personalities (16C / SCI / FIN). Indices into it are
/// valid for [`cm_set_keymap`].
#[no_mangle]
pub extern "C" fn cm_num_personalities() -> usize {
    PERSONALITIES.len()
}

/// Select personality by index (0-based; see [`cm_num_personalities`]).
/// Out-of-range is ignored. Applies that personality's display-mode defaults.
///
/// # Safety
/// `app` must be a live handle from [`cm_new`].
#[no_mangle]
pub unsafe extern "C" fn cm_set_keymap(app: *mut App, idx: usize) {
    if let (Some(app), Some(&km)) = (app.as_mut(), PERSONALITIES.get(idx)) {
        app.set_keymap(km);
    }
}

/// Write the current personality name (e.g. "16C") into `out`/`cap`; returns the
/// byte length.
///
/// # Safety
/// `app` must be a live handle from [`cm_new`]. Read the result via [`cm_out_ptr`].
#[no_mangle]
pub unsafe extern "C" fn cm_keymap_name(app: *mut App) -> usize {
    let Some(app) = app.as_ref() else { return 0 };
    put(app.keymap().name)
}

/// Write the printed legend for a key on the current personality into `out`/`cap`;
/// returns the byte length. `layer`: 0 = base face, 1 = f (gold), 2 = g (blue).
/// This is `keydoc::label` over the live keymap — the same source of truth the
/// firmware keycaps use, so the web faceplate can never drift from the engine.
///
/// # Safety
/// `app` must be a live handle from [`cm_new`]. Read the result via [`cm_out_ptr`].
#[no_mangle]
pub unsafe extern "C" fn cm_key_label(
    app: *mut App,
    layer: usize,
    row: usize,
    col: usize,
) -> usize {
    let Some(app) = app.as_ref() else { return 0 };
    if row >= ROWS || col >= COLS {
        return 0;
    }
    let km = app.keymap();
    let table = match layer {
        0 => &km.base,
        1 => &km.f,
        2 => &km.g,
        _ => return 0,
    };
    put(keydoc::label(table[row][col]))
}

/// Compile-time sanity: the JS side hard-codes 48; keep it honest.
const _: () = assert!(DISPLAY_ROWS * DIGITS_PER_ROW == 48);
