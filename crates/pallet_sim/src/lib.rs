use wasm_bindgen::prelude::*;

/// Main-thread entry point for the pallet simulation.
#[wasm_bindgen]
#[derive(Default)]
pub struct Engine {}

#[wasm_bindgen]
impl Engine {
    #[wasm_bindgen(constructor)]
    pub fn new() -> Engine {
        Engine::default()
    }

    pub fn ping(&self) -> String {
        format!("v{}", env!("CARGO_PKG_VERSION"))
    }
}
