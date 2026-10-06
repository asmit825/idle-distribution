//! Stacking and the cumulative top-load solver (SPEC-01 §2.3).

use crate::grid::{
    Placement, Rect, Rejection, Status, Validation, CEILING_IN, MAX_SOFT_OVERHANG_IN,
};

/// More than 3/10 of a base over air and the case tips off (SPEC-01 §2.3.3). Compared in exact
/// integer area, so a base exactly 30% unsupported is allowed.
const MAX_UNSUPPORTED: (i64, i64) = (3, 10);
/// Pro-rata shares carry float rounding; a load this close to capacity does not crush.
const LOAD_TOLERANCE_LBS: f64 = 1e-6;

pub type CaseId = u32;

#[derive(Clone, Debug, PartialEq)]
pub struct PlacedCase {
    pub id: CaseId,
    pub placement: Placement,
    pub footprint: Rect,
    pub elevation_in: i32,
    /// Cases this one rests on. Empty on the deck.
    pub supports: Vec<Support>,
    /// Cumulative top-load from everything resting on it, directly or indirectly.
    pub load_lbs: f64,
    pub crushed: bool,
}

impl PlacedCase {
    pub fn top_in(&self) -> i32 {
        self.elevation_in + self.placement.height()
    }

    /// Whether `load_lbs` exceeds this case's rated top-load capacity.
    fn crushes_under(&self, load_lbs: f64) -> bool {
        load_lbs > f64::from(self.placement.sku.top_load_capacity_lbs) + LOAD_TOLERANCE_LBS
    }
}

#[derive(Debug, Default)]
pub struct Pallet {
    cases: Vec<PlacedCase>,
    next_id: CaseId,
}

/// A case resting on another, and the share of its downward load that one carries.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Support {
    pub case: CaseId,
    pub share: f64,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum RemoveError {
    NotFound,
    /// Another case rests on it; remove that one first.
    Supporting,
}

impl Pallet {
    pub fn cases(&self) -> &[PlacedCase] {
        &self.cases
    }

    pub fn case(&self, id: CaseId) -> Option<&PlacedCase> {
        self.index_of(id).map(|index| &self.cases[index])
    }

    pub fn validate(&self, placement: &Placement) -> Validation {
        let footprint = placement.footprint();
        let elevation_in = self.settle(&footprint);
        let overhang_in = footprint.overhang();
        let supported_area: i64 = if elevation_in == 0 {
            footprint.overlap_area(&Rect::DECK)
        } else {
            self.cases
                .iter()
                .filter(|case| case.top_in() == elevation_in)
                .map(|case| case.footprint.overlap_area(&footprint))
                .sum()
        };
        let (area, unsupported_area) = (footprint.area(), footprint.area() - supported_area);
        let unsupported_fraction = unsupported_area as f64 / area as f64;
        let rejection = if elevation_in + placement.height() > CEILING_IN {
            Some(Rejection::AboveCeiling)
        } else if overhang_in > MAX_SOFT_OVERHANG_IN {
            Some(Rejection::ExcessOverhang)
        } else if unsupported_area * MAX_UNSUPPORTED.1 > area * MAX_UNSUPPORTED.0 {
            Some(Rejection::Unsupported)
        } else {
            None
        };
        let would_crush = if rejection.is_some() {
            0
        } else {
            self.would_crush(placement, &footprint, elevation_in)
        };
        let status = match rejection {
            Some(_) => Status::Invalid,
            None if overhang_in > 0 || would_crush > 0 => Status::Warning,
            None => Status::Valid,
        };
        Validation {
            status,
            rejection,
            elevation_in,
            overhang_in,
            unsupported_fraction,
            would_crush,
        }
    }

    pub fn commit(&mut self, placement: Placement) -> Result<CaseId, Rejection> {
        let check = self.validate(&placement);
        if let Some(rejection) = check.rejection {
            return Err(rejection);
        }
        let id = self.next_id;
        self.next_id += 1;
        let footprint = placement.footprint();
        let supports = self.supports(&footprint, check.elevation_in);
        self.cases.push(PlacedCase {
            id,
            placement,
            footprint,
            elevation_in: check.elevation_in,
            supports,
            load_lbs: 0.0,
            crushed: false,
        });
        self.solve_loads();
        Ok(id)
    }

    pub fn remove(&mut self, id: CaseId) -> Result<(), RemoveError> {
        let index = self.index_of(id).ok_or(RemoveError::NotFound)?;
        if self
            .cases
            .iter()
            .any(|case| case.supports.iter().any(|support| support.case == id))
        {
            return Err(RemoveError::Supporting);
        }
        self.cases.remove(index);
        self.solve_loads();
        Ok(())
    }

    /// The cases a base at `elevation` over `footprint` would rest on directly. None on the deck.
    pub fn beneath<'a>(
        &'a self,
        footprint: &'a Rect,
        elevation: i32,
    ) -> impl Iterator<Item = &'a PlacedCase> + 'a {
        self.cases.iter().filter(move |case| {
            elevation > 0
                && case.top_in() == elevation
                && case.footprint.overlap_area(footprint) > 0
        })
    }

    /// The cases beneath, each weighted by its share of the total contact area, so a partly
    /// overhanging case still sends its whole weight down.
    fn supports(&self, footprint: &Rect, elevation: i32) -> Vec<Support> {
        let contacts: Vec<(CaseId, i64)> = self
            .beneath(footprint, elevation)
            .map(|case| (case.id, case.footprint.overlap_area(footprint)))
            .collect();
        let total: i64 = contacts.iter().map(|&(_, area)| area).sum();
        contacts
            .into_iter()
            .map(|(case, area)| Support {
                case,
                share: area as f64 / total as f64,
            })
            .collect()
    }

    /// Intact cases whose capacity the candidate's weight would push past. The load model is
    /// linear, so only the candidate's own weight needs propagating.
    fn would_crush(&self, placement: &Placement, footprint: &Rect, elevation_in: i32) -> u32 {
        let mut added = vec![0.0; self.cases.len()];
        for support in self.supports(footprint, elevation_in) {
            added[self.index_of(support.case).unwrap()] +=
                f64::from(placement.sku.weight_lbs) * support.share;
        }
        self.propagate(&mut added, false);
        self.cases
            .iter()
            .zip(added)
            .filter(|(case, extra)| !case.crushed && case.crushes_under(case.load_lbs + extra))
            .count() as u32
    }

    /// Passes load down through the supports, top-down. Each case transmits what it receives,
    /// plus its own weight when `with_weight`. Supports always sit lower, so a case's total
    /// is final before it passes it on.
    fn propagate(&self, loads: &mut [f64], with_weight: bool) {
        let mut order: Vec<usize> = (0..self.cases.len()).collect();
        order.sort_by_key(|&index| std::cmp::Reverse(self.cases[index].elevation_in));
        for index in order {
            let case = &self.cases[index];
            let own = if with_weight {
                f64::from(case.placement.sku.weight_lbs)
            } else {
                0.0
            };
            let downward = own + loads[index];
            for support in &case.supports {
                loads[self.index_of(support.case).unwrap()] += downward * support.share;
            }
        }
    }

    /// Recomputes every case's cumulative top-load (SPEC-01 §2.3.1). Crushing is permanent.
    fn solve_loads(&mut self) {
        let mut loads = vec![0.0; self.cases.len()];
        self.propagate(&mut loads, true);
        for (case, load) in self.cases.iter_mut().zip(loads) {
            case.load_lbs = load;
            case.crushed |= case.crushes_under(load);
        }
    }

    /// Cases stay in id order, so lookup is a binary search.
    fn index_of(&self, id: CaseId) -> Option<usize> {
        self.cases.binary_search_by_key(&id, |case| case.id).ok()
    }

    /// The case drops until its base meets the highest top beneath its footprint, or the deck.
    fn settle(&self, footprint: &Rect) -> i32 {
        self.cases
            .iter()
            .filter(|case| case.footprint.overlap_area(footprint) > 0)
            .map(PlacedCase::top_in)
            .max()
            .unwrap_or(0)
    }
}
