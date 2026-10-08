//! Stacking and the cumulative top-load solver (SPEC-01 §2.3).

use crate::grid::{
    Placement, Rect, Rejection, Status, Validation, CEILING_IN, MAX_SOFT_OVERHANG_IN,
};

/// Pro-rata shares carry float rounding; a load this close to capacity does not crush.
const LOAD_TOLERANCE_LBS: f64 = 1e-6;
/// A load bearing down this close to the edge of its support balances on a knife edge, and tips.
const TIP_TOLERANCE_IN: f64 = 1e-9;

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
    /// The heaviest top-load it has ever carried. Damage is permanent, so this never drops.
    pub peak_load_lbs: f64,
    pub crushed: bool,
}

impl PlacedCase {
    pub fn top_in(&self) -> i32 {
        self.elevation_in + self.placement.height()
    }

    /// How far its peak load went past its rating, as a fraction of the rating. 0 if it never did.
    pub fn overload(&self) -> f64 {
        let capacity = f64::from(self.placement.sku.top_load_capacity_lbs);
        ((self.peak_load_lbs - capacity) / capacity).max(0.0)
    }

    /// Whether `load_lbs` exceeds this case's rated top-load capacity.
    fn crushes_under(&self, load_lbs: f64) -> bool {
        load_lbs > f64::from(self.placement.sku.top_load_capacity_lbs) + LOAD_TOLERANCE_LBS
    }
}

#[derive(Clone, Debug, Default)]
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

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum MoveError {
    NotFound,
    /// Another case rests on it; only exposed cases move.
    Supporting,
    Rejected(Rejection),
}

impl From<RemoveError> for MoveError {
    fn from(error: RemoveError) -> MoveError {
        match error {
            RemoveError::NotFound => MoveError::NotFound,
            RemoveError::Supporting => MoveError::Supporting,
        }
    }
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
        let supported_area: i64 = self
            .contacts(&footprint, elevation_in)
            .iter()
            .map(Rect::area)
            .sum();
        let area = footprint.area();
        let unsupported_fraction = (area - supported_area) as f64 / area as f64;
        let mut rejection = if elevation_in + placement.height() > CEILING_IN {
            Some(Rejection::AboveCeiling)
        } else if overhang_in > MAX_SOFT_OVERHANG_IN {
            Some(Rejection::ExcessOverhang)
        } else {
            None
        };
        let mut would_crush = 0;
        if rejection.is_none() {
            // Judge the stack with the case in it. The new id is the highest, so it lands last.
            let mut trial = self.clone();
            trial.insert(self.next_id, *placement, elevation_in, 0.0);
            if !trial.is_stable() {
                rejection = Some(Rejection::Unsupported);
            } else {
                would_crush = trial
                    .cases
                    .iter()
                    .zip(&self.cases)
                    .filter(|(after, before)| after.crushed && !before.crushed)
                    .count() as u32;
            }
        }
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
        self.insert(id, placement, check.elevation_in, 0.0);
        Ok(id)
    }

    /// The pallet with exposed case `id` lifted off, as it would be mid-move.
    pub fn without(&self, id: CaseId) -> Result<Pallet, RemoveError> {
        let mut pallet = self.clone();
        pallet.remove(id)?;
        Ok(pallet)
    }

    /// Where exposed case `id` would settle at `placement`, judged as if it were already lifted.
    pub fn validate_move(
        &self,
        id: CaseId,
        placement: &Placement,
    ) -> Result<Validation, RemoveError> {
        Ok(self.without(id)?.validate(placement))
    }

    /// Moves exposed case `id` to `placement`. It keeps its id, and any crush damage it took.
    pub fn relocate(&mut self, id: CaseId, placement: Placement) -> Result<(), MoveError> {
        let peak_load_lbs = self.case(id).ok_or(MoveError::NotFound)?.peak_load_lbs;
        let mut lifted = self.without(id)?;
        let check = lifted.validate(&placement);
        if let Some(rejection) = check.rejection {
            return Err(MoveError::Rejected(rejection));
        }
        lifted.insert(id, placement, check.elevation_in, peak_load_lbs);
        *self = lifted;
        Ok(())
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

    /// Adds a case at its id-ordered position, then re-solves every load.
    fn insert(&mut self, id: CaseId, placement: Placement, elevation_in: i32, peak_load_lbs: f64) {
        let footprint = placement.footprint();
        let supports = self.supports(&footprint, elevation_in);
        let index = self.cases.partition_point(|case| case.id < id);
        self.cases.insert(
            index,
            PlacedCase {
                id,
                placement,
                footprint,
                elevation_in,
                supports,
                load_lbs: 0.0,
                peak_load_lbs,
                crushed: false,
            },
        );
        self.solve_loads();
    }

    /// Whether every case stays put (SPEC-01 §2.3.3). Each case bears down at the balance point
    /// of its own weight and everything it carries. That point must sit strictly inside the
    /// outline of what holds it up, the convex hull of its contact patches, or the case tips.
    /// A case may hang well past the one beneath it, so long as it balances, but weight piled
    /// on an overhanging end can tip the case under it.
    pub fn is_stable(&self) -> bool {
        // Downward force carried from above, and its moment about the origin.
        let mut carried = vec![(0.0, 0.0, 0.0); self.cases.len()];
        for index in self.top_down() {
            let case = &self.cases[index];
            let weight = f64::from(case.placement.sku.weight_lbs);
            let (cx, cy) = case.footprint.center();
            let (load, moment_x, moment_y) = carried[index];
            let force = weight + load;
            let balance = (
                (weight * cx + moment_x) / force,
                (weight * cy + moment_y) / force,
            );
            if !hull_contains(&self.contacts(&case.footprint, case.elevation_in), balance) {
                return false;
            }
            // Each support takes its pro-rata share at the point of its patch nearest the
            // balance point: exactly the balance point when the case rests on one support.
            for support in &case.supports {
                let below = self.index_of(support.case).unwrap();
                let patch = self.cases[below]
                    .footprint
                    .intersection(&case.footprint)
                    .unwrap();
                let (x, y) = patch.clamp(balance);
                let share = force * support.share;
                let entry = &mut carried[below];
                *entry = (entry.0 + share, entry.1 + share * x, entry.2 + share * y);
            }
        }
        true
    }

    /// Where a base over `footprint` at `elevation` touches the deck or the tops beneath it.
    fn contacts(&self, footprint: &Rect, elevation: i32) -> Vec<Rect> {
        if elevation == 0 {
            footprint.intersection(&Rect::DECK).into_iter().collect()
        } else {
            self.beneath(footprint, elevation)
                .filter_map(|case| case.footprint.intersection(footprint))
                .collect()
        }
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

    /// Case indices from the highest base down. Supports always sit lower, so a case's carried
    /// load is final before it passes it on.
    fn top_down(&self) -> Vec<usize> {
        let mut order: Vec<usize> = (0..self.cases.len()).collect();
        order.sort_by_key(|&index| std::cmp::Reverse(self.cases[index].elevation_in));
        order
    }

    /// Recomputes every case's cumulative top-load (SPEC-01 §2.3.1): each passes its weight
    /// plus what it carries down through its supports. Crushing is permanent.
    fn solve_loads(&mut self) {
        let mut loads = vec![0.0; self.cases.len()];
        for index in self.top_down() {
            let case = &self.cases[index];
            let downward = f64::from(case.placement.sku.weight_lbs) + loads[index];
            for support in &case.supports {
                loads[self.index_of(support.case).unwrap()] += downward * support.share;
            }
        }
        for (case, load) in self.cases.iter_mut().zip(loads) {
            case.load_lbs = load;
            case.peak_load_lbs = case.peak_load_lbs.max(load);
            case.crushed = case.crushes_under(case.peak_load_lbs);
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

/// Whether `point` lies strictly inside the convex hull of `patches`.
fn hull_contains(patches: &[Rect], (px, py): (f64, f64)) -> bool {
    let mut corners: Vec<(i64, i64)> = patches
        .iter()
        .flat_map(Rect::corners)
        .map(|(x, y)| (i64::from(x), i64::from(y)))
        .collect();
    corners.sort_unstable();
    corners.dedup();
    let cross = |o: (i64, i64), a: (i64, i64), b: (i64, i64)| {
        (a.0 - o.0) * (b.1 - o.1) - (a.1 - o.1) * (b.0 - o.0)
    };
    // Andrew's monotone chain: the lower half, then the upper, counter-clockwise.
    let mut hull: Vec<(i64, i64)> = Vec::with_capacity(corners.len() + 1);
    for half in [corners.clone(), corners.into_iter().rev().collect()] {
        let start = hull.len();
        for point in half {
            while hull.len() >= start + 2
                && cross(hull[hull.len() - 2], hull[hull.len() - 1], point) <= 0
            {
                hull.pop();
            }
            hull.push(point);
        }
        // Each half ends where the other begins.
        hull.pop();
    }
    (0..hull.len()).all(|i| {
        let (a, b) = (hull[i], hull[(i + 1) % hull.len()]);
        let (ax, ay) = (a.0 as f64, a.1 as f64);
        (b.0 as f64 - ax) * (py - ay) - (b.1 as f64 - ay) * (px - ax) > TIP_TOLERANCE_IN
    })
}
