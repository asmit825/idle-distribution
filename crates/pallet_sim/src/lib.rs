use wasm_bindgen::prelude::*;

pub mod sku;

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

/// The SKU catalog as plain JS objects, for parity with `src/types/catalog.ts`.
#[wasm_bindgen]
pub fn sku_catalog() -> Result<JsValue, JsValue> {
    Ok(serde_wasm_bindgen::to_value(sku::catalog())?)
}
