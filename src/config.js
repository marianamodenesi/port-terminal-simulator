// Level 1 parameters. Every number here comes from the Decisions log in the
// project tracker (thesis-calibrated). Times are in HOURS, money in US$.

// Effective loading rates = 69% of rated capacity (thesis: 39.5 h real
// operation vs 27.2 h nominal). A berth with no rate for a class can't take it.
export const LEVEL_1 = {
  name: 'Level 1',
  horizon: 720,              // 30 days
  meanInterarrival: 14.5,    // exponential arrivals, ~75% berth utilization
  lineupWindow: 72,          // the player sees ships due in the next 72 h
  overheadHours: 5,          // berthing + unberthing (thesis T2 + T4)
  laytimeRate: 7400,         // t/h used in the charter party
  laytimeTurnTime: 6,        // h of grace after Notice of Readiness
  demurragePerHour: 750,     // US$18,000/day
  despatchPerHour: 375,      // 50% of demurrage
  shipClasses: [
    { cls: 'Chinamax', share: 0.2, tonnes: 390000 },
    { cls: 'Capesize', share: 0.6, tonnes: 180000 },
    { cls: 'Panamax',  share: 0.2, tonnes: 80000 },
  ],
  berths: [
    { id: 'B1', rates: { Chinamax: 11040, Capesize: 8280, Panamax: 8280 } },
    { id: 'B2', rates: { Capesize: 5520, Panamax: 5520 } },
    { id: 'B3', rates: { Capesize: 5520, Panamax: 5520 } },
  ],
};
