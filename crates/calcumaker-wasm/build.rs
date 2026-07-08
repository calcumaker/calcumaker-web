//! Link the wasi-sdk-built GMP + MPFR static archives into the final wasm.
//!
//! `gmp-mpfr-nostd`'s own build.rs links *system* libs on the host and *nothing*
//! on bare metal (`target_os == "none"`). For the wasm target (`target_os ==
//! "wasi"`) the archives are cross-built by `third_party/build-gmp-mpfr-wasi.sh`
//! into `vendor/wasi/lib/`, so we point the linker at them here — keeping the
//! shared core crate untouched.

fn main() {
    println!("cargo:rerun-if-changed=build.rs");

    let target_os = std::env::var("CARGO_CFG_TARGET_OS").unwrap_or_default();
    if target_os != "wasi" {
        return; // host builds (tests/tooling) use gmp-mpfr-nostd's own linking
    }

    // vendor/ lives at the repo root: crates/calcumaker-wasm/ -> ../../vendor
    let manifest = std::env::var("CARGO_MANIFEST_DIR").unwrap();
    let lib = format!("{manifest}/../../vendor/wasi/lib");
    println!("cargo:rustc-link-search=native={lib}");
    // mpfr depends on gmp -> list mpfr first.
    println!("cargo:rustc-link-lib=static=mpfr");
    println!("cargo:rustc-link-lib=static=gmp");
    // GMP's errno.o calls raise(SIGFPE) on divide-by-zero; provide it from
    // wasi's emulated-signal lib (vendored next to gmp/mpfr). The engine guards
    // against zero divisors before GMP, so this path is never actually taken.
    println!("cargo:rustc-link-lib=static=wasi-emulated-signal");
}
