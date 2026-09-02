// Team liveries. Colours are *inspired by* the 2026 grid — approximate identity only,
// no logos, no sponsor marks. Purely cosmetic: see car.js / physics — every car
// shares identical performance parameters.

export const TEAMS = [
  { id: 'mclaren',   name: 'McLaren',      short: 'MCL', body: 0xff7a1a, accent: 0x1e5fd8, trim: 0x14161a, drivers: ['L. NORRIS', 'O. PIASTRI'] },
  { id: 'mercedes',  name: 'Mercedes',     short: 'MER', body: 0x14161a, accent: 0x2fd6b8, trim: 0xc8ccd2, drivers: ['G. RUSSELL', 'A. ANTONELLI'] },
  { id: 'redbull',   name: 'Red Bull',     short: 'RBR', body: 0x111c3d, accent: 0xd8232a, trim: 0xf2c500, drivers: ['M. VERSTAPPEN', 'I. HADJAR'] },
  { id: 'ferrari',   name: 'Ferrari',      short: 'FER', body: 0xd80f16, accent: 0x14161a, trim: 0xf2e6c8, drivers: ['C. LECLERC', 'L. HAMILTON'] },
  { id: 'williams',  name: 'Williams',     short: 'WIL', body: 0x1747c8, accent: 0xffffff, trim: 0x6fc6ff, drivers: ['A. ALBON', 'C. SAINZ'] },
  { id: 'racingbulls', name: 'Racing Bulls', short: 'RB', body: 0x1b2a6b, accent: 0xffffff, trim: 0xd8232a, drivers: ['L. LAWSON', 'A. LINDBLAD'] },
  { id: 'aston',     name: 'Aston Martin', short: 'AST', body: 0x0d5c40, accent: 0xc9e34a, trim: 0x0a3b2a, drivers: ['F. ALONSO', 'L. STROLL'] },
  { id: 'haas',      name: 'Haas',         short: 'HAA', body: 0xf2f2f2, accent: 0xd8232a, trim: 0x14161a, drivers: ['E. OCON', 'O. BEARMAN'] },
  { id: 'audi',      name: 'Audi',         short: 'AUD', body: 0x14161a, accent: 0xd8232a, trim: 0x8a8f96, drivers: ['N. HULKENBERG', 'G. BORTOLETO'] },
  { id: 'alpine',    name: 'Alpine',       short: 'ALP', body: 0x1a5ee0, accent: 0xff59a8, trim: 0x0e2f70, drivers: ['P. GASLY', 'F. COLAPINTO'] },
  { id: 'cadillac',  name: 'Cadillac',     short: 'CAD', body: 0x10141f, accent: 0xd0a94a, trim: 0xa8232a, drivers: ['S. PEREZ', 'V. BOTTAS'] },
];

export const teamById = (id) => TEAMS.find(t => t.id === id) || TEAMS[0];
