//! Pallet coordinates (SPEC-01 §2.1): X along the 48" length, Y along the 40" width,
//! Z up from the top deck. Cases anchor on the 2" grid; geometry is exact integer inches,
//! so footprints that are not whole cells (a flipped 15" side) still work.

use serde::Serialize;

use crate::sku::{self, SkuDef, CELL_IN};

pub const PALLET_LENGTH_IN: i32 = 48;
pub const PALLET_WIDTH_IN: i32 = 40;
pub const CEILING_IN: i32 = 60;
pub const MAX_SOFT_OVERHANG_IN: i32 = 2;

/// Axis-aligned rectangle in inches, half-open: `[x0, x1) × [y0, y1)`.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct Rect {
    pub x0: i32,
    pub y0: i32,
    pub x1: i32,
    pub y1: i32,
}

impl Rect {
    pub const DECK: Rect = Rect {
        x0: 0,
        y0: 0,
        x1: PALLET_LENGTH_IN,
        y1: PALLET_WIDTH_IN,
    };

    pub fn area(&self) -> i64 {
        i64::from(self.x1 - self.x0) * i64::from(self.y1 - self.y0)
    }

    pub fn overlap_area(&self, other: &Rect) -> i64 {
        let width = self.x1.min(other.x1) - self.x0.max(other.x0);
        let depth = self.y1.min(other.y1) - self.y0.max(other.y0);
        if width <= 0 || depth <= 0 {
            0
        } else {
            i64::from(width) * i64::from(depth)
        }
    }

    pub fn center(&self) -> (f64, f64) {
        (
            f64::from(self.x0 + self.x1) / 2.0,
            f64::from(self.y0 + self.y1) / 2.0,
        )
    }

    /// Furthest protrusion past the deck perimeter on any side.
    pub fn overhang(&self) -> i32 {
        [
            -self.x0,
            self.x1 - PALLET_LENGTH_IN,
            -self.y0,
            self.y1 - PALLET_WIDTH_IN,
            0,
        ]
        .into_iter()
        .max()
        .unwrap()
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum PlacementError {
    UnknownSku,
    /// Anchored so far off the deck no case could reach it.
    OffPallet,
    /// Yaw must be 0, 90, 180, or 270 degrees.
    InvalidYaw,
}

/// A candidate case position: SKU, min-corner grid cell, yaw, and flip.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct Placement {
    pub sku: &'static SkuDef,
    pub grid_x: i32,
    pub grid_y: i32,
    pub yaw_deg: u16,
    /// Rolled onto its side: the case's width becomes its height.
    pub flipped: bool,
}

impl Placement {
    pub fn new(
        sku_id: &str,
        grid_x: i32,
        grid_y: i32,
        yaw_deg: u16,
        flipped: bool,
    ) -> Result<Self, PlacementError> {
        let sku = sku::by_id(sku_id).ok_or(PlacementError::UnknownSku)?;
        let (cells_x, cells_y) = (
            PALLET_LENGTH_IN / CELL_IN as i32,
            PALLET_WIDTH_IN / CELL_IN as i32,
        );
        if !(-cells_x..=2 * cells_x).contains(&grid_x)
            || !(-cells_y..=2 * cells_y).contains(&grid_y)
        {
            return Err(PlacementError::OffPallet);
        }
        if !yaw_deg.is_multiple_of(90) || yaw_deg >= 360 {
            return Err(PlacementError::InvalidYaw);
        }
        Ok(Placement {
            sku,
            grid_x,
            grid_y,
            yaw_deg,
            flipped,
        })
    }

    pub fn footprint(&self) -> Rect {
        let (length, width) = (self.sku.length_in as i32, self.base_depth());
        let (dx, dy) = if self.yaw_deg.is_multiple_of(180) {
            (length, width)
        } else {
            (width, length)
        };
        let (x0, y0) = (self.grid_x * CELL_IN as i32, self.grid_y * CELL_IN as i32);
        Rect {
            x0,
            y0,
            x1: x0 + dx,
            y1: y0 + dy,
        }
    }

    pub fn height(&self) -> i32 {
        if self.flipped {
            self.sku.width_in as i32
        } else {
            self.sku.height_in as i32
        }
    }

    fn base_depth(&self) -> i32 {
        if self.flipped {
            self.sku.height_in as i32
        } else {
            self.sku.width_in as i32
        }
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum Status {
    /// Green: supported, inside the footprint, crushes nothing.
    Valid,
    /// Yellow: soft overhang (≤ 2") or the added load would crush a case below.
    Warning,
    /// Red: dropping here is rejected.
    Invalid,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum Rejection {
    AboveCeiling,
    ExcessOverhang,
    Unsupported,
    /// Mode 1: a heavy case resting directly on a light or fragile one.
    HeavyOnLight,
}

impl Rejection {
    /// The serialized name, for error messages.
    pub fn as_str(self) -> &'static str {
        match self {
            Rejection::AboveCeiling => "above_ceiling",
            Rejection::ExcessOverhang => "excess_overhang",
            Rejection::Unsupported => "unsupported",
            Rejection::HeavyOnLight => "heavy_on_light",
        }
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Serialize)]
pub struct Validation {
    pub status: Status,
    pub rejection: Option<Rejection>,
    /// Where the case's base would settle, in inches above the deck.
    pub elevation_in: i32,
    pub overhang_in: i32,
    /// Share of the base hanging over air, 0–1.
    pub unsupported_fraction: f64,
    /// Intact cases this placement would crush.
    pub would_crush: u32,
}
